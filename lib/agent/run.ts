// One bounded agent per claim: four tools, a step budget, a trace, and a
// ClaimPacket at the end. The model client is an interface so the loop can be
// tested with a scripted model; the real client is the Anthropic SDK.
//
// Two phases: a tool loop (the model gathers), then one structured-output call
// over the same conversation (the model describes, in a fixed format). The
// rules run afterwards, in code.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import type { LoadedClaim } from "../claim/load.ts";
import { ROUTE_ORDER, type ClaimPacket } from "../claim/schema.ts";
import { containsName } from "../privacy/mask.ts";
import { decide, type Decision } from "../rules/engine.ts";
import { DEFAULT_SETTINGS, type Settings } from "../rules/protocol.ts";
import { assemblePacket, packetView } from "./assemble.ts";
import { makeClient } from "./client.ts";
import { apiKeyConfigured, costUsd, modelFromEnv, type Usage } from "./models.ts";
import { agentOutputSchema, type AgentOutput } from "./output.ts";
import { AGENT_VERSION, ASSEMBLE_INSTRUCTION, PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt.ts";
import { newToolContext, runTool, TOOL_DEFS, type ToolContext, type VisionReader } from "./tools.ts";
import { anthropicVision } from "./vision.ts";

export type Msg = Anthropic.Beta.BetaMessageParam;

export interface StepResult {
  content: Anthropic.Beta.BetaContentBlock[];
  stopReason: string | null;
  usage: Usage;
  model: string;
}

export interface FinishResult {
  output: AgentOutput | null;
  usage: Usage;
  model: string;
  problem: string | null;
}

/** The two calls the loop makes. Real implementation below; tests script one. */
export interface ModelClient {
  step(messages: Msg[]): Promise<StepResult>;
  finish(messages: Msg[]): Promise<FinishResult>;
}

export const MAX_ITERATIONS = 10;

export function anthropicModelClient(model: string, client: Anthropic = makeClient()): ModelClient {
  const base = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: TOOL_DEFS,
    betas: ["server-side-fallback-2026-07-01"] as const,
    fallbacks: "default" as const,
  };
  return {
    async step(messages) {
      const r = await client.beta.messages.create({ ...base, betas: [...base.betas], messages });
      return { content: r.content, stopReason: r.stop_reason, usage: r.usage, model: r.model };
    },
    async finish(messages) {
      const r = await client.beta.messages.parse({
        ...base,
        betas: [...base.betas],
        messages,
        tool_choice: { type: "none" },
        output_config: { format: zodOutputFormat(agentOutputSchema) },
      });
      const problem = r.stop_reason === "refusal" ? "The model declined to produce the packet." : r.stop_reason === "max_tokens" ? "The packet was cut off before it finished." : r.parsed_output ? null : "The model's packet did not match the required format.";
      return { output: r.parsed_output ?? null, usage: r.usage, model: r.model, problem };
    },
  };
}

export type FailureKind = "no_api_key" | "api_error" | "timeout" | "refused" | "invalid_output" | "budget";

export class AgentFailure extends Error {
  kind: FailureKind;
  constructor(kind: FailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface RunOptions {
  settings?: Settings;
  model?: string;
  client?: ModelClient;
  vision?: VisionReader | null;
  images?: boolean;
  root?: string;
}

export interface RunResult {
  packet: ClaimPacket;
  decision: Decision;
  snapshot: string[];
  usage: { calls: number; inputTokens: number; outputTokens: number; costUsd: number; durationMs: number };
  ok: boolean;
  failure: string | null;
}

export async function runAgent(claim: LoadedClaim, opts: RunOptions = {}): Promise<RunResult> {
  const settings = opts.settings ?? DEFAULT_SETTINGS;
  const model = opts.model ?? modelFromEnv();
  const t0 = Date.now();
  let client = opts.client;
  let vision = opts.vision;
  if (!client) {
    if (!apiKeyConfigured()) {
      const ctx = newToolContext(claim, settings, { images: false, vision: null, root: opts.root });
      return finish(ctx, null, { modelRequested: model, modelServed: null }, "No API key. The agent did not run.", [], t0);
    }
    const sdk = makeClient();
    client = anthropicModelClient(model, sdk);
    vision = vision === undefined ? anthropicVision(sdk, model) : vision;
  }
  const ctx = newToolContext(claim, settings, { images: opts.images ?? true, vision: vision ?? null, root: opts.root });

  // Residency: the agent does not run on Canadian policyholder data at all.
  if (claim.header.country === "CA") {
    return finish(ctx, null, { modelRequested: model, modelServed: null }, "Canadian policyholder: residency constraints keep this claim out of the AI's scope. Not sent to the model.", [], t0);
  }

  const usages: { model: string; usage: Usage }[] = [];
  const messages: Msg[] = [{ role: "user", content: `Assemble the readiness packet for claim ${claim.header.claimId}. Start with get_structured.` }];
  let served: string | null = null;
  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const r = await client.step(messages);
      usages.push({ model: r.model, usage: r.usage });
      served = r.model;
      messages.push({ role: "assistant", content: r.content });
      if (r.stopReason === "refusal") throw new AgentFailure("refused", "The model declined to work on this claim.");
      const toolUses = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (r.stopReason !== "tool_use" || toolUses.length === 0) break;
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const t of toolUses) {
        const out = await runTool(ctx, t.name, t.input);
        results.push({ type: "tool_result", tool_use_id: t.id, content: out.content, is_error: out.isError || undefined });
      }
      messages.push({ role: "user", content: results });
      if (ctx.budgetExhausted) {
        messages.push({ role: "user", content: "The step budget is exhausted. Do not call any more tools; summarise what you found." });
        const last = await client.step(messages);
        usages.push({ model: last.model, usage: last.usage });
        messages.push({ role: "assistant", content: last.content.filter((b) => b.type !== "tool_use") });
        break;
      }
    }
    // Last check before anything leaves for the assemble call: no real name in what the model saw.
    const leaked = containsName(ctx.snapshot.join("\n"), claim.names);
    if (leaked) throw new AgentFailure("invalid_output", `A policyholder name reached the model input (${leaked.length} characters). Stopped.`);

    messages.push({ role: "user", content: ASSEMBLE_INSTRUCTION });
    let fin = await client.finish(messages);
    usages.push({ model: fin.model, usage: fin.usage });
    if (!fin.output && fin.problem && !/declined/.test(fin.problem)) {
      messages.push({ role: "user", content: `${fin.problem} Return the packet again, in the required format.` });
      fin = await client.finish(messages);
      usages.push({ model: fin.model, usage: fin.usage });
    }
    served = fin.model;
    if (!fin.output) throw new AgentFailure("invalid_output", fin.problem ?? "No packet.");
    return finish(ctx, fin.output, { modelRequested: model, modelServed: served }, null, usages, t0);
  } catch (err) {
    const message = describeFailure(err);
    console.error(`[agent] ${claim.header.claimId}: ${message}`);
    return finish(ctx, null, { modelRequested: model, modelServed: served }, message, usages, t0);
  }
}

function finish(ctx: ToolContext, output: AgentOutput | null, m: { modelRequested: string; modelServed: string | null }, failure: string | null, usages: { model: string; usage: Usage }[], t0: number): RunResult {
  const packet = assemblePacket(ctx, output, { ...m, promptVersion: PROMPT_VERSION, agentVersion: AGENT_VERSION, provenance: ctx.claim.folder.provenance }, failure);
  const decision = decideFor(packet, ctx.settings);
  const inputTokens = usages.reduce((a, u) => a + u.usage.input_tokens, 0) + ctx.visionUsage.reduce((a, u) => a + u.input_tokens, 0);
  const outputTokens = usages.reduce((a, u) => a + u.usage.output_tokens, 0) + ctx.visionUsage.reduce((a, u) => a + u.output_tokens, 0);
  const cost = usages.reduce((a, u) => a + costUsd(u.model, u.usage), 0) + ctx.visionUsage.reduce((a, u) => a + costUsd(m.modelRequested, u), 0);
  return {
    packet,
    decision,
    snapshot: ctx.snapshot,
    usage: { calls: usages.length + ctx.visionUsage.length, inputTokens, outputTokens, costUsd: Math.round(cost * 10000) / 10000, durationMs: Date.now() - t0 },
    ok: failure === null,
    failure,
  };
}

/** The rules over a packet. Pure; the screen calls this with draft settings too. */
export function decideFor(packet: ClaimPacket, settings: Settings = DEFAULT_SETTINGS): Decision {
  return decide(
    {
      claimId: packet.claimId,
      claimType: packet.header.claimType,
      state: packet.header.state,
      country: packet.header.country,
      amountUsd: packet.header.amountUsd,
      regulatoryReviewRequired: packet.header.regulatoryReviewRequired,
      policyStatus: packet.header.policyStatus,
      packet: packetView(packet),
    },
    settings,
  );
}

export function describeFailure(err: unknown): string {
  if (err instanceof AgentFailure) return err.message;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "The AI service did not respond in time.";
  if (err instanceof Anthropic.RateLimitError) return "The AI service is busy (rate limited).";
  if (err instanceof Anthropic.AuthenticationError) return "The server's API key was rejected.";
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (HTTP ${err.status ?? "?"}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** True when the rules moved the route; used in summaries. */
export const escalated = (d: Decision) => d.agentRoute !== null && ROUTE_ORDER[d.route] > ROUTE_ORDER[d.agentRoute];
