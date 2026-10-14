// A transcript of one agent run: every model turn, every vision read and the
// final structured output, exactly as the API returned them. Recording one on
// the deployment and replaying it here produces the same packet from the same
// claim folder, because the four tools are deterministic code. The transcript
// is small (the model's words, not the documents), so it fits in a few log
// lines, and the packet it replays to is checked against the hashes the
// deployment computed. Timing fields are carried over, not recomputed.

import { createHash } from "node:crypto";

import type { ClaimPacket } from "../claim/schema.ts";
import type { Usage } from "./models.ts";
import type { FinishResult, ModelClient, RunResult, StepResult } from "./run.ts";
import type { VisionReader } from "./tools.ts";

export interface VisionRecord {
  fieldKey: string;
  page: number;
  read: Awaited<ReturnType<VisionReader>>["read"];
  modelServed: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
}

export interface Transcript {
  version: 1;
  claimId: string;
  model: string;
  startedAt: string;
  steps: StepResult[];
  finishes: FinishResult[];
  vision: VisionRecord[];
  /** Filled in when the run completes; the replay checks itself against these. */
  result?: {
    inputHash: string;
    packetHash: string;
    generatedAt: string;
    trace: { durationMs: number; startedAt: string }[];
    usage: RunResult["usage"];
    ok: boolean;
    failure: string | null;
  };
}

export function newTranscript(claimId: string, model: string): Transcript {
  return { version: 1, claimId, model, startedAt: new Date().toISOString(), steps: [], finishes: [], vision: [] };
}

export function recordingClient(inner: ModelClient, t: Transcript): ModelClient {
  return {
    async step(messages) {
      const r = await inner.step(messages);
      t.steps.push({ content: r.content, stopReason: r.stopReason, usage: r.usage, model: r.model });
      return r;
    },
    async finish(messages) {
      const r = await inner.finish(messages);
      t.finishes.push({ output: r.output, usage: r.usage, model: r.model, problem: r.problem });
      return r;
    },
  };
}

export function recordingVision(inner: VisionReader, t: Transcript): VisionReader {
  return async (req) => {
    const r = await inner(req);
    t.vision.push({ fieldKey: req.field.key, page: req.page, read: r.read, modelServed: r.modelServed, usage: r.usage ?? null });
    return r;
  };
}

/** Plays the recorded turns back in order. Running out of turns is an error, not a guess. */
export function replayClient(t: Transcript): ModelClient {
  let s = 0;
  let f = 0;
  return {
    async step() {
      const r = t.steps[s++];
      if (!r) throw new Error(`Transcript has no step ${s}.`);
      return r;
    },
    async finish() {
      const r = t.finishes[f++];
      if (!r) throw new Error(`Transcript has no finish ${f}.`);
      return r;
    },
  };
}

export function replayVision(t: Transcript): VisionReader {
  let i = 0;
  return async (req) => {
    const r = t.vision[i++];
    if (!r) throw new Error(`Transcript has no vision read ${i} (asked for ${req.field.key}).`);
    if (r.fieldKey !== req.field.key) throw new Error(`Transcript vision read ${i} is for ${r.fieldKey}, the replay asked for ${req.field.key}.`);
    return { read: r.read, modelServed: r.modelServed, usage: r.usage };
  };
}

/** SHA-256 of the packet with the timing fields blanked, so a replay can be compared with the original. */
export function packetHash(packet: ClaimPacket): string {
  const canon = { ...packet, generatedAt: "", trace: packet.trace.map((e) => ({ ...e, durationMs: 0, startedAt: "" })) };
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

export function completeTranscript(t: Transcript, r: RunResult): Transcript {
  t.result = {
    inputHash: r.packet.inputHash,
    packetHash: packetHash(r.packet),
    generatedAt: r.packet.generatedAt,
    trace: r.packet.trace.map((e) => ({ durationMs: e.durationMs, startedAt: e.startedAt })),
    usage: r.usage,
    ok: r.ok,
    failure: r.failure,
  };
  return t;
}

/** Carries the recorded timings into a replayed result so the cached packet reads as the original run. */
export function applyRecordedTimings(t: Transcript, r: RunResult): RunResult {
  if (!t.result) return r;
  const trace = r.packet.trace.map((e, i) => ({ ...e, durationMs: t.result!.trace[i]?.durationMs ?? e.durationMs, startedAt: t.result!.trace[i]?.startedAt ?? e.startedAt }));
  return { ...r, packet: { ...r.packet, generatedAt: t.result.generatedAt, trace }, usage: t.result.usage };
}

export type { Usage };
