// The agent's four tools. Each is a typed function over a ToolContext; the model
// chooses when to call them, the code decides what they return. Only
// reread_field involves a model (vision), and only on a field the OCR read
// weakly or left blank. Every call is logged into the packet's trace.

import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import type { LoadedClaim } from "../claim/load.ts";
import type { OcrField } from "../claim/ocr-fields.ts";
import { AGENT_TOOLS, type AgentTool, type Reread, type TraceEntry } from "../claim/schema.ts";
import { maskText } from "../privacy/mask.ts";
import { checkCompleteness, type CompletenessResult } from "../rules/checklist.ts";
import type { Settings } from "../rules/protocol.ts";
import type { VisionRead } from "./output.ts";
import { STEP_BUDGET } from "./prompt.ts";

export type ToolContent = Array<Anthropic.Beta.Messages.BetaToolResultContentBlockParam>;

/** Reads one field from one page image. Injected so the loop can be tested without an API key. */
export type VisionReader = (args: { image: Buffer; mediaType: "image/jpeg" | "image/png"; field: OcrField; page: number; claimId: string }) => Promise<{ read: VisionRead; modelServed: string | null; usage: { input_tokens: number; output_tokens: number } | null }>;

export interface ToolContext {
  claim: LoadedClaim;
  settings: Settings;
  trace: TraceEntry[];
  calls: number;
  budget: number;
  budgetExhausted: boolean;
  rereads: Map<string, Reread>;
  completeness: CompletenessResult | null;
  /** Whether get_documents attaches photos and page images (off in tests). */
  images: boolean;
  vision: VisionReader | null;
  /** Everything the model was shown, in order, for the audit snapshot. */
  snapshot: string[];
  /** Names of documents the model has been shown, so output document references can be checked. */
  documentsShown: Set<string>;
  visionUsage: { input_tokens: number; output_tokens: number }[];
  root: string;
}

export function newToolContext(claim: LoadedClaim, settings: Settings, opts: Partial<Pick<ToolContext, "images" | "vision" | "root" | "budget">> = {}): ToolContext {
  return {
    claim,
    settings,
    trace: [],
    calls: 0,
    budget: opts.budget ?? STEP_BUDGET,
    budgetExhausted: false,
    rereads: new Map(),
    completeness: null,
    images: opts.images ?? true,
    vision: opts.vision ?? null,
    snapshot: [],
    documentsShown: new Set(),
    visionUsage: [],
    root: opts.root ?? process.cwd(),
  };
}

const strictObject = (properties: Record<string, unknown>, required: string[]) => ({ type: "object" as const, properties, required, additionalProperties: false });

export const TOOL_DEFS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_structured",
    description: "The claim header, policy, amount, state, channel, regulatory flag and prior claims on the policyholder, from ClaimsPro (REST) and Snowflake. No model. Call this first.",
    strict: true,
    input_schema: strictObject({ claim_id: { type: "string" } }, ["claim_id"]),
  },
  {
    name: "get_documents",
    description: "The claim's documents from Databricks: adjuster notes, call transcript, fax OCR text with per-field confidence, EDI record, PDF pages (as images where there is no OCR text) and photos. No model, no search: for one claim its documents are already known.",
    strict: true,
    input_schema: strictObject({ claim_id: { type: "string" } }, ["claim_id"]),
  },
  {
    name: "reread_field",
    description: "Sends one page image to vision and asks for one specific OCR field. Allowed only when the field's OCR confidence is below the threshold or the field is blank; refused otherwise. Returns what vision read, whether it agrees with the OCR, and any code cross-check.",
    strict: true,
    input_schema: strictObject({ document: { type: "string", description: "The OCR document name, as returned by get_documents" }, field_key: { type: "string", description: "The OCR field key, for example ocr_line_1" }, page: { type: "integer", description: "The page the field is on, as returned by get_documents" } }, ["document", "field_key", "page"]),
  },
  {
    name: "check_completeness",
    description: "Compares what is on file against the evidence checklist for this claim type. No model. Returns each item, whether it is present and where, and the completeness fraction. Call before finishing.",
    strict: true,
    input_schema: strictObject({ claim_id: { type: "string" } }, ["claim_id"]),
  },
];

export function isAgentTool(name: string): name is AgentTool {
  return (AGENT_TOOLS as readonly string[]).includes(name);
}

const summarize = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 3) + "..." : s);

/** Runs one tool call, logs it, and returns the content for the tool_result block. */
export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<{ content: ToolContent; isError: boolean }> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const args = JSON.stringify(input ?? {});
  const mask = (s: string) => maskText(s, ctx.claim.names).text;
  // Every text block goes through the mask here, whatever tool built it, so a
  // name copied into a checklist note or an error message cannot reach the model.
  const done = (tool: AgentTool, result: string, rawContent: ToolContent, isError = false) => {
    const content: ToolContent = rawContent.map((c) => (c.type === "text" ? { ...c, text: mask(c.text) } : c));
    ctx.trace.push({ step: ctx.trace.length + 1, tool, args: summarize(args), result: summarize(mask(result)), durationMs: Date.now() - t0, startedAt });
    for (const c of content) if (c.type === "text") ctx.snapshot.push(`[${tool} ${args}]\n${c.text}`);
    return { content, isError };
  };
  if (!isAgentTool(name)) {
    return { content: [{ type: "text", text: `Unknown tool ${name}. The four tools are ${AGENT_TOOLS.join(", ")}.` }], isError: true };
  }
  ctx.calls += 1;
  if (ctx.calls > ctx.budget) {
    ctx.budgetExhausted = true;
    return done(name, "refused: step budget exhausted", [{ type: "text", text: `Step budget of ${ctx.budget} tool calls exhausted. Finish with what you have.` }], true);
  }
  const id = ctx.claim.header.claimId;
  const checkId = (i: unknown): string | null => {
    const given = (i as { claim_id?: string })?.claim_id;
    return given && given !== id ? `This agent only has access to claim ${id}; ${given} is not available.` : null;
  };

  if (name === "get_structured") {
    const bad = checkId(input);
    if (bad) return done(name, bad, [{ type: "text", text: bad }], true);
    const c = ctx.claim;
    const out = {
      header: c.header,
      policy: { ...c.snowflake.policy, policyholder: c.snowflake.policy.policyholder ? "[POLICYHOLDER]" : null, claimant: c.snowflake.policy.claimant ? "[CLAIMANT]" : null },
      policy_status: { status: c.snowflake.policyStatus, basis: c.snowflake.policyStatusBasis },
      prior_claims: { count: c.snowflake.priorClaimsOnPolicy, ids: c.snowflake.priorClaimIds, basis: c.snowflake.priorClaimsBasis },
      extract_row: c.snowflake.rowFrom ? { from: c.snowflake.rowFrom, flagged_for_human_review_today: c.snowflake.row?.flaggedForHumanReview, complexity: c.snowflake.row?.complexity, document_count: c.snowflake.row?.documentCount } : null,
      queue: { received_at: c.claimsPro.receivedAt, first_touch_at: c.claimsPro.firstTouchAt, closed_at: c.claimsPro.closedAt, queue_wait_hours: c.claimsPro.queueWaitHours },
      fields: c.structuredFields.map((f) => ({ label: f.label, value: mask(f.value), source: f.source, document: f.document })),
      status_history: c.claimsPro.statusHistory.map((e) => ({ ...e, note: mask(e.note) })),
      intake_package: c.claimsPro.intakePackage.map(mask),
    };
    ctx.documentsShown.add("intake.md");
    ctx.documentsShown.add("status_history.md");
    const text = JSON.stringify(out, null, 1);
    return done(name, `${c.header.claimType} ${c.header.state} ${c.header.channel} $${c.header.amountUsd}; ${out.fields.length} fields`, [{ type: "text", text }]);
  }

  if (name === "get_documents") {
    const bad = checkId(input);
    if (bad) return done(name, bad, [{ type: "text", text: bad }], true);
    const c = ctx.claim;
    const docs = c.databricks.documents
      .filter((d) => d.kind !== "photo")
      .map((d) => {
        ctx.documentsShown.add(d.name);
        return {
          name: d.name,
          kind: d.kind,
          engine_confidence: d.engineConfidence,
          confidence_basis: d.confidenceBasis,
          pages: d.pages.length || null,
          text: d.kind === "ocr_text" && c.ocr ? mask(c.ocr.cleanedText) : d.text ? mask(d.text) : null,
          note: d.kind === "ocr_text" ? "Glyph twins (O/0, l/1, I/1) normalised in code; letters in numeric fields left as read." : d.kind === "pdf" && !c.ocr ? "Page images follow." : d.kind === "pdf" ? "Page images are available to reread_field." : null,
        };
      });
    const ocrFields = c.ocr?.fields.map((f) => ({ key: f.key, label: f.label, value: f.value, raw: f.raw, confidence: f.confidence, issue: f.issue, basis: f.basis, page: f.page, threshold: ctx.settings.ocrRereadThreshold })) ?? [];
    const content: ToolContent = [
      {
        type: "text",
        text: JSON.stringify(
          {
            document_index_from_claimspro: c.claimsPro.documentsOnFile,
            documents: docs,
            ocr_fields: ocrFields,
            ocr_code_checks: c.ocr?.codeChecks ?? [],
            edi: c.edi ? { fields: c.edi.fields.map((f) => ({ label: f.label, value: mask(f.value) })), empty_segments: c.edi.emptySegments } : null,
            photos: c.databricks.photos.map((p) => p.name),
            reread_rule: `reread_field is allowed only for an OCR field with confidence below ${ctx.settings.ocrRereadThreshold} or a blank value.`,
          },
          null,
          1,
        ),
      },
    ];
    if (ctx.images) {
      for (const p of c.databricks.photos) {
        content.push({ type: "text", text: `Photo ${p.name}:` });
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await toJpeg(path.join(ctx.root, p.path), 1024)).toString("base64") } });
        ctx.documentsShown.add(p.name);
      }
      if (!c.ocr) {
        for (const pdf of c.databricks.pdfs) {
          for (const pg of pdf.pages) {
            content.push({ type: "text", text: `${pdf.name} page ${pg.page} of ${pdf.pages.length}:` });
            content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await toJpeg(path.join(ctx.root, pg.image), 1000)).toString("base64") } });
          }
        }
      }
    }
    const weak = ocrFields.filter((f) => f.confidence < ctx.settings.ocrRereadThreshold).map((f) => f.key);
    return done(name, `${docs.length} documents, ${ocrFields.length} OCR fields (${weak.length} weak: ${weak.join(", ") || "none"}), ${c.databricks.photos.length} photos`, content);
  }

  if (name === "reread_field") {
    const { document, field_key, page } = (input ?? {}) as { document?: string; field_key?: string; page?: number };
    const c = ctx.claim;
    const field = c.ocr?.fields.find((f) => f.key === field_key);
    if (!c.ocr || !field) {
      const msg = `Refused: no OCR field ${field_key} on this claim.`;
      return done(name, msg, [{ type: "text", text: msg }], true);
    }
    const blank = field.value === null;
    if (!blank && field.confidence >= ctx.settings.ocrRereadThreshold) {
      const msg = `Refused: ${field.key} was read at confidence ${field.confidence}, at or above the ${ctx.settings.ocrRereadThreshold} threshold. Re-reads are only allowed for weak or blank fields.`;
      return done(name, msg, [{ type: "text", text: msg }], true);
    }
    const pdf = c.databricks.pdfs.find((d) => d.pages.length) ?? null;
    const pageImage = pdf?.pages.find((p) => p.page === field.page) ?? null;
    if (!pdf || !pageImage) {
      const msg = `Refused: no page image for page ${field.page} of the faxed document.`;
      return done(name, msg, [{ type: "text", text: msg }], true);
    }
    if (page !== field.page) {
      // The code knows which page the field is on; correct the model rather than read the wrong page.
      ctx.snapshot.push(`[reread_field] requested page ${page}, field is on page ${field.page}`);
    }
    if (!ctx.vision) {
      const msg = "Refused: vision is not available (no API key).";
      return done(name, msg, [{ type: "text", text: msg }], true);
    }
    const jpeg = await toJpeg(path.join(ctx.root, pageImage.image), 1100);
    const v = await ctx.vision({ image: jpeg, mediaType: "image/jpeg", field, page: field.page, claimId: c.header.claimId });
    if (v.usage) ctx.visionUsage.push(v.usage);
    const codeCheck = c.ocr.codeChecks.find((k) => k.field === field.key) ?? null;
    const agreed = compareReads(field, v.read, codeCheck?.candidate ?? null);
    const reread: Reread = {
      ocrText: field.raw,
      visionValue: v.read.legible ? v.read.value : null,
      agreed,
      codeCheck: codeCheck ? codeCheck.check : null,
      pageImage: pageImage.image,
      page: field.page,
      region: field.region,
    };
    ctx.rereads.set(field.key, reread);
    const out = { field: field.key, label: field.label, ocr_read: field.raw, ocr_confidence: field.confidence, vision_read: reread.visionValue, vision_note: v.read.note, legible: v.read.legible, agreed, code_check: codeCheck?.check ?? null, code_candidate: codeCheck?.candidate ?? null, page: field.page, document: document ?? c.ocr.document };
    return done(name, `${field.key}: OCR "${field.raw}" vision "${reread.visionValue}" agreed=${agreed}`, [{ type: "text", text: JSON.stringify(out, null, 1) }]);
  }

  // check_completeness
  const bad = checkId(input);
  if (bad) return done(name, bad, [{ type: "text", text: bad }], true);
  const r = checkCompleteness(ctx.claim);
  ctx.completeness = r;
  const out = { claim_type: ctx.claim.header.claimType, present: r.present, required: r.required, completeness: Math.round(r.completeness * 100) / 100, items: r.items, missing: r.missing };
  return done(name, `${r.present} of ${r.required} on file; missing: ${r.missing.map((m) => m.id).join(", ") || "none"}`, [{ type: "text", text: JSON.stringify(out, null, 1) }]);
}

/**
 * Whether the vision read agrees with the OCR, after normalisation. For a blank
 * OCR field, agreement means vision also found nothing. A code candidate (for
 * example the arithmetic repair of a garbled line) counts as agreement when the
 * vision read matches it.
 */
export function compareReads(field: OcrField, read: VisionRead, candidate: string | null): boolean | null {
  const norm = (s: string | null) => (s ?? "").replace(/[\s$,_]/g, "").toLowerCase();
  const vision = read.legible ? read.value : null;
  // Blank or cut off in the OCR: agreement means vision found nothing either,
  // or read a full value that starts with whatever the OCR could see.
  if (field.value === null || field.issue === "partial") {
    if (vision === null || norm(vision) === "") return true;
    const prefix = norm(field.value);
    return prefix.length > 0 && norm(vision).startsWith(prefix);
  }
  if (vision === null) return null;
  if (norm(vision) === norm(field.value)) return true;
  // With an arithmetic candidate, vision has to agree with the arithmetic: two independent reads.
  if (candidate !== null) return norm(vision) === norm(candidate);
  // Without one, a read that differs from the OCR only at the garbled glyph counts.
  const a = norm(field.value);
  const b = norm(vision);
  if (a.length === b.length && [...a].filter((ch, i) => ch !== b[i]).length === 1 && /[a-z]/.test(a)) return true;
  return false;
}

export async function toJpeg(file: string, maxWidth: number): Promise<Buffer> {
  return sharp(readFileSync(file)).rotate().resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}
