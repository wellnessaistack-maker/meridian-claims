// The agent loop with a scripted model: no API key, no network. These test the
// mechanics (budget, the re-read guard, the trace, masking, the packet contract),
// not the model's judgment. The model's judgment is what the packet evaluation
// measures, with a key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadClaimById } from "../claim/load.ts";
import { claimPacketSchema } from "../claim/schema.ts";
import { containsName } from "../privacy/mask.ts";
import { DEFAULT_SETTINGS } from "../rules/protocol.ts";
import { appendAudit, confirmAudit, readAudit, recordFor } from "../audit/record.ts";
import { readPacket, writePacket } from "./cache.ts";
import type { AgentOutput } from "./output.ts";
import { runAgent, type FinishResult, type ModelClient, type Msg, type StepResult } from "./run.ts";
import { compareReads, newToolContext, runTool, TOOL_DEFS, type VisionReader } from "./tools.ts";
import { STEP_BUDGET } from "./prompt.ts";

type ToolCall = { name: string; input: Record<string, unknown> };

/** A model that calls the listed tools turn by turn, then returns a fixed packet. */
function scripted(turns: ToolCall[][], output: AgentOutput): ModelClient & { seen: Msg[][] } {
  let i = 0;
  const usage = { input_tokens: 100, output_tokens: 10 };
  const seen: Msg[][] = [];
  return {
    seen,
    async step(messages): Promise<StepResult> {
      seen.push([...messages]);
      const calls = turns[i++];
      if (!calls) return { content: [{ type: "text", text: "Done gathering.", citations: null }], stopReason: "end_turn", usage, model: "scripted" };
      return { content: calls.map((c, k) => ({ type: "tool_use" as const, id: `tu_${i}_${k}`, name: c.name, input: c.input })) as StepResult["content"], stopReason: "tool_use", usage, model: "scripted" };
    },
    async finish(): Promise<FinishResult> {
      return { output, usage, model: "scripted", problem: null };
    },
  };
}

const output = (over: Partial<AgentOutput> = {}): AgentOutput => ({
  summary: "s",
  fields_read: [],
  timeline: [],
  contradictions: [],
  denial_indicators: [],
  route: "ready_to_decide",
  rationale: "The packet is complete and consistent. A person confirms in ClaimsPro.",
  photo_observations: [],
  ...over,
});

const fakeVision: VisionReader = async ({ field }) => {
  if (field.key === "ocr_line_1") return { read: { value: "1,800.00", legible: true, note: "Clear on the page." }, modelServed: "fake", usage: { input_tokens: 50, output_tokens: 5 } };
  return { read: { value: null, legible: false, note: "The claimant block is not on this page; the fax is cut off at the edge." }, modelServed: "fake", usage: { input_tokens: 50, output_tokens: 5 } };
};

const id300 = "IS-CLM-2025000300";
const id2993 = "IS-CLM-2025002993";

test("the tool definitions are exactly the four, strict, with a budget of 8", () => {
  assert.deepEqual(TOOL_DEFS.map((t) => t.name), ["get_structured", "get_documents", "reread_field", "check_completeness"]);
  assert.ok(TOOL_DEFS.every((t) => t.strict === true));
  assert.equal(STEP_BUDGET, 8);
});

test("300: a portal claim run with tools 1 and 4 only yields a complete, ready packet that the rules leave alone", async () => {
  const claim = loadClaimById(id300)!;
  const client = scripted([[{ name: "get_structured", input: { claim_id: id300 } }], [{ name: "check_completeness", input: { claim_id: id300 } }]], output());
  const r = await runAgent(claim, { client, vision: null, images: false });
  assert.equal(r.ok, true);
  assert.equal(r.packet.status, "assembled");
  assert.deepEqual(r.packet.trace.map((t) => t.tool), ["get_structured", "check_completeness"]);
  assert.equal(r.packet.completeness, 1);
  assert.equal(r.packet.agentRoute, "ready_to_decide");
  assert.equal(r.decision.route, "ready_to_decide");
  assert.equal(r.decision.segment, "ready");
  assert.ok(r.packet.trace.every((t) => t.durationMs >= 0 && t.startedAt));
  assert.equal(r.usage.calls, 4, "two tool turns, one final turn, one assemble call");
  claimPacketSchema.parse(r.packet);
});

test("2993: the fax claim run with all four tools re-reads the three weak fields and the rules escalate to full review", async () => {
  const claim = loadClaimById(id2993)!;
  const client = scripted(
    [
      [{ name: "get_structured", input: { claim_id: id2993 } }],
      [{ name: "get_documents", input: { claim_id: id2993 } }],
      [
        { name: "reread_field", input: { document: "ocr_output.txt", field_key: "ocr_line_1", page: 4 } },
        { name: "reread_field", input: { document: "ocr_output.txt", field_key: "ocr_claimant_contact", page: 1 } },
        { name: "reread_field", input: { document: "ocr_output.txt", field_key: "ocr_date_of_loss", page: 1 } },
        { name: "reread_field", input: { document: "ocr_output.txt", field_key: "ocr_vehicle_total", page: 7 } },
      ],
      [{ name: "check_completeness", input: { claim_id: id2993 } }],
    ],
    output({
      route: "verify_documents",
      denial_indicators: [{ kind: "pre_existing_damage", evidence: "The estimate notes corrosion and prior paint edges on the rear quarter; the photos show rust under flaking paint.", document: "ocr_output.txt" }],
      contradictions: [{ topic: "Estimate written before the accident date", a: { document: "ocr_output.txt", quote: "Written 2025-09-05" }, b: { document: "edi_record.txt", quote: "DTP*439*D8*20250908" }, material: true, note: "" }],
      rationale: "The faxed estimate was read at 0.69 by the OCR engine. The bumper line was re-read from the page as 1,800.00. The claimant contact is missing. A denial indicator was found; a person decides.",
    }),
  );
  const r = await runAgent(claim, { client, vision: fakeVision, images: false });
  assert.equal(r.ok, true, r.failure ?? "");
  assert.deepEqual(r.packet.trace.map((t) => t.tool), ["get_structured", "get_documents", "reread_field", "reread_field", "reread_field", "reread_field", "check_completeness"]);
  const refused = r.packet.trace[5];
  assert.match(refused.result, /Refused.*0\.88/);
  const line1 = r.packet.fields.find((f) => f.key === "ocr_line_1")!;
  assert.equal(line1.value, "1,800.00");
  assert.equal(line1.confidence, 0.95);
  assert.equal(line1.reread?.agreed, true);
  assert.match(line1.reread?.codeCheck ?? "", /2848\.50/);
  assert.equal(line1.reread?.page, 4);
  const contact = r.packet.fields.find((f) => f.key === "ocr_claimant_contact")!;
  assert.equal(contact.value, null);
  assert.equal(contact.reread?.agreed, true, "blank in OCR and not on the page: both reads agree");
  const dol = r.packet.fields.find((f) => f.key === "ocr_date_of_loss")!;
  assert.equal(dol.reread?.agreed, true, "cut off in OCR and cut off on the page: both reads agree");
  assert.ok(dol.confidence! < 0.8, "agreement that a field is unreadable does not make it trusted");
  assert.equal(r.packet.fields.find((f) => f.key === "date_of_loss")!.value, "2025-09-08", "the date of loss itself comes from the EDI record");
  assert.deepEqual(r.packet.missing.map((m) => m.id), ["claimant_contact", "claimant_account"]);
  assert.equal(r.packet.contradictions.length, 1, "the model's contradiction; code does not add a duplicate of the same date conflict");
  assert.equal(r.packet.denialIndicators[0].kind, "pre_existing_damage");
  assert.equal(r.decision.route, "full_review");
  assert.deepEqual(r.decision.reasons.map((x) => x.id).sort(), ["C1", "C2", "D1", "E2", "R1"]);
  assert.equal(r.decision.segment, "regulatory");
  assert.ok(r.decision.escalatedByRules);
  // Nothing the model saw carried a real name.
  for (const msgs of client.seen) {
    for (const m of msgs) {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      assert.equal(containsName(text, claim.names), null);
    }
  }
  assert.equal(containsName(r.snapshot.join("\n"), claim.names), null);
  assert.match(r.snapshot.join(" "), /\[CLAIMANT\]/);
});

test("code adds the estimate-before-loss contradiction itself when the model misses it", async () => {
  const claim = loadClaimById(id2993)!;
  const client = scripted([[{ name: "get_structured", input: { claim_id: id2993 } }], [{ name: "get_documents", input: { claim_id: id2993 } }]], output({ route: "verify_documents" }));
  const r = await runAgent(claim, { client, vision: fakeVision, images: false });
  const dated = r.packet.contradictions.find((c) => /before the date of loss/i.test(c.topic))!;
  assert.ok(dated);
  assert.equal(dated.material, true);
  assert.match(dated.a.quote, /2025-09-05/);
  assert.match(dated.b.quote, /2025-09-08/);
  // Weak fields not re-read: C3 fires.
  assert.ok(r.decision.reasons.some((x) => x.id === "C3"));
});

test("the step budget stops the loop at 8 tool calls and the run still completes", async () => {
  const claim = loadClaimById(id2993)!;
  const spam = Array.from({ length: 6 }, () => [{ name: "check_completeness", input: { claim_id: id2993 } }, { name: "get_structured", input: { claim_id: id2993 } }]);
  const client = scripted(spam, output({ route: "verify_documents" }));
  const r = await runAgent(claim, { client, vision: null, images: false });
  assert.equal(r.ok, true);
  const served = r.packet.trace.filter((t) => !/budget/.test(t.result));
  assert.equal(served.length, STEP_BUDGET);
  assert.ok(r.packet.trace.some((t) => /budget exhausted/.test(t.result)));
  assert.ok(r.packet.trace.length <= STEP_BUDGET + 2, "at most the refused calls of the turn that crossed the line");
});

test("the re-read guard refuses a field that is not weak, a field that does not exist, and runs without vision only as a refusal", async () => {
  const claim = loadClaimById(id2993)!;
  const ctx = newToolContext(claim, DEFAULT_SETTINGS, { images: false, vision: null });
  const strong = await runTool(ctx, "reread_field", { document: "ocr_output.txt", field_key: "ocr_vehicle_total", page: 7 });
  assert.equal(strong.isError, true);
  const missing = await runTool(ctx, "reread_field", { document: "ocr_output.txt", field_key: "ocr_nothing", page: 1 });
  assert.equal(missing.isError, true);
  const noVision = await runTool(ctx, "reread_field", { document: "ocr_output.txt", field_key: "ocr_line_1", page: 4 });
  assert.equal(noVision.isError, true);
  assert.match(JSON.stringify(noVision.content), /no API key/);
  assert.equal(ctx.trace.length, 3, "refusals are still logged");
});

test("the agent only answers for its own claim", async () => {
  const claim = loadClaimById(id300)!;
  const ctx = newToolContext(claim, DEFAULT_SETTINGS, { images: false });
  const r = await runTool(ctx, "get_structured", { claim_id: "IS-CLM-2025002993" });
  assert.equal(r.isError, true);
  const u = await runTool(ctx, "nonsense", {});
  assert.equal(u.isError, true);
});

test("comparing reads: same value, a glyph apart, the arithmetic candidate, or both blank count as agreement", () => {
  const claim = loadClaimById(id2993)!;
  const line1 = claim.ocr!.fields.find((f) => f.key === "ocr_line_1")!;
  assert.equal(compareReads(line1, { value: "1,800.00", legible: true, note: "" }, "1,800.00"), true);
  assert.equal(compareReads(line1, { value: "$1800.00", legible: true, note: "" }, null), true);
  assert.equal(compareReads(line1, { value: "1,300.00", legible: true, note: "" }, "1,800.00"), false);
  assert.equal(compareReads(line1, { value: null, legible: false, note: "" }, null), null);
  const contact = claim.ocr!.fields.find((f) => f.key === "ocr_claimant_contact")!;
  assert.equal(compareReads(contact, { value: null, legible: false, note: "" }, null), true);
  assert.equal(compareReads(contact, { value: "(909) 555-0100", legible: true, note: "" }, null), false);
});

test("without a key, the agent does not run and says so: the packet is not assembled and the rules route it as today", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const r = await runAgent(loadClaimById(id300)!, { images: false });
    assert.equal(r.ok, false);
    assert.equal(r.packet.status, "not_assembled");
    assert.match(r.packet.notAssembledReason!, /No API key/);
    assert.equal(r.decision.route, "verify_documents");
    assert.ok(r.decision.reasons.some((x) => x.id === "E1"));
    assert.equal(r.usage.calls, 0);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("a model failure lands in manual triage rather than a guess", async () => {
  const claim = loadClaimById(id300)!;
  const client: ModelClient = {
    async step() {
      throw new Error("socket hang up");
    },
    async finish() {
      throw new Error("unreachable");
    },
  };
  const r = await runAgent(claim, { client, vision: null, images: false });
  assert.equal(r.ok, false);
  assert.match(r.failure!, /socket hang up/);
  assert.equal(r.packet.status, "not_assembled");
  assert.equal(r.decision.route, "verify_documents");
});

test("a Canadian policyholder never reaches the model", async () => {
  const claim = loadClaimById(id300)!;
  claim.header.country = "CA";
  let called = 0;
  const client: ModelClient = {
    async step() {
      called += 1;
      throw new Error("must not be called");
    },
    async finish() {
      throw new Error("must not be called");
    },
  };
  const r = await runAgent(claim, { client, vision: null, images: false });
  assert.equal(called, 0);
  assert.equal(r.decision.route, "out_of_scope");
  assert.match(r.packet.notAssembledReason!, /residency/);
});

test("the input hash is stable across runs with the same inputs", async () => {
  const claim = loadClaimById(id300)!;
  const mk = () => scripted([[{ name: "get_structured", input: { claim_id: id300 } }], [{ name: "check_completeness", input: { claim_id: id300 } }]], output());
  const a = await runAgent(claim, { client: mk(), vision: null, images: false });
  const b = await runAgent(claim, { client: mk(), vision: null, images: false });
  assert.equal(a.packet.inputHash, b.packet.inputHash);
  assert.match(a.packet.inputHash, /^[0-9a-f]{64}$/);
});

test("cache and audit: a packet round-trips, the audit record has the five fields, and confirming appends rather than edits", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "mer-"));
  const claim = loadClaimById(id300)!;
  const client = scripted([[{ name: "get_structured", input: { claim_id: id300 } }], [{ name: "check_completeness", input: { claim_id: id300 } }]], output());
  const r = await runAgent(claim, { client, vision: null, images: false });
  writePacket({ packet: r.packet, decision: r.decision, usage: r.usage, savedAt: "now" }, root);
  assert.equal(readPacket(id300, root)!.packet.inputHash, r.packet.inputHash);

  const rec = recordFor(r.packet, r.decision, r.snapshot, root);
  assert.equal(rec.input.hash, r.packet.inputHash);
  assert.ok(rec.input.snapshot.length > 0);
  assert.equal(rec.modelVersion.model, r.packet.model.requested);
  assert.equal(rec.output.route, "ready_to_decide");
  assert.equal(rec.confidence.evidenceCompleteness, 1);
  assert.equal(rec.confidence.route.value, null);
  assert.match(rec.confidence.route.basis, /Not yet measured/);
  assert.equal(rec.humanReviewed, false);
  assert.equal(rec.retentionYears, 7);
  appendAudit(rec, root);
  assert.throws(() => confirmAudit(id300, "ADJ-110", { route: "specialist_review" }, root), /needs a reason/);
  const c = confirmAudit(id300, "ADJ-110", { route: "specialist_review", reason: "Shop estimate looks high for the market." }, root);
  assert.equal(c.humanReviewed, true);
  assert.equal(c.reviewer, "ADJ-110");
  assert.equal(c.reviewerRoute, "specialist_review");
  const history = readAudit(id300, root);
  assert.equal(history.length, 2);
  assert.equal(history[0].humanReviewed, false, "the original record is untouched");
});

test("a recorded run replays to the same packet: same input hash, same packet hash, timings carried over", async () => {
  const { applyRecordedTimings, completeTranscript, newTranscript, packetHash, replayClient, replayVision } = await import("./transcript.ts");
  const claim = loadClaimById(id2993)!;
  const turns: ToolCall[][] = [
    [{ name: "get_structured", input: { claim_id: id2993 } }],
    [{ name: "get_documents", input: { claim_id: id2993 } }],
    [
      { name: "reread_field", input: { document: "ocr_output.txt", field_key: "ocr_line_1", page: 4 } },
      { name: "reread_field", input: { document: "ocr_output.txt", field_key: "ocr_claimant_contact", page: 1 } },
      { name: "reread_field", input: { document: "ocr_output.txt", field_key: "ocr_date_of_loss", page: 1 } },
    ],
    [{ name: "check_completeness", input: { claim_id: id2993 } }],
  ];
  const t = newTranscript(id2993, "scripted");
  const original = await runAgent(claim, { client: scripted(turns, output({ route: "verify_documents" })), vision: fakeVision, images: false, transcript: t });
  assert.equal(original.ok, true, original.failure ?? "");
  completeTranscript(t, original);
  assert.equal(t.steps.length, 5);
  assert.equal(t.finishes.length, 1);
  assert.equal(t.vision.length, 3);
  assert.deepEqual(t.vision.map((v) => v.fieldKey), ["ocr_line_1", "ocr_claimant_contact", "ocr_date_of_loss"]);

  // Through JSON, as it travels through the logs.
  const copy = JSON.parse(JSON.stringify(t)) as typeof t;
  const replayed = applyRecordedTimings(copy, await runAgent(claim, { client: replayClient(copy), vision: replayVision(copy), images: false }));
  assert.equal(replayed.ok, true, replayed.failure ?? "");
  assert.equal(replayed.packet.inputHash, original.packet.inputHash);
  assert.equal(packetHash(replayed.packet), packetHash(original.packet));
  assert.equal(replayed.packet.generatedAt, original.packet.generatedAt);
  assert.deepEqual(replayed.packet.trace, original.packet.trace);
  assert.deepEqual(replayed.usage, original.usage);
  assert.deepEqual(replayed.snapshot, original.snapshot);
  assert.deepEqual(replayed.decision, original.decision);

  // A transcript for a different sequence of tool calls does not silently fit.
  const other = newTranscript(id2993, "scripted");
  await runAgent(claim, { client: scripted(turns.slice(0, 2), output()), vision: null, images: false, transcript: other });
  const wrong = await runAgent(claim, { client: replayClient(other), vision: replayVision(other), images: false });
  assert.notEqual(packetHash(wrong.packet), packetHash(original.packet));
});

test("a real name in the model's output is masked before it becomes a packet", async () => {
  const claim = loadClaimById(id300)!;
  const name = claim.names[0].value;
  const client = scripted([[{ name: "get_structured", input: { claim_id: id300 } }]], output({ summary: `The estimate is addressed to ${name}.`, photo_observations: [{ photo: "IMG_0071.jpg", observation: `Sticker reads ${name}` }] }));
  const r = await runAgent(claim, { client, vision: null, images: false });
  assert.equal(r.ok, true);
  assert.equal(containsName(JSON.stringify(r.packet), claim.names), null);
  assert.match(r.packet.rationale + JSON.stringify(r.packet), /\[POLICYHOLDER\]/);
});

test("a third party named in a checklist note is masked on the way out: the completeness tool leaks nothing", async () => {
  const claim = loadClaimById("IS-CLM-2025900002")!;
  assert.ok(claim.names.length >= 2);
  const client = scripted([[{ name: "get_structured", input: { claim_id: claim.header.claimId } }], [{ name: "get_documents", input: { claim_id: claim.header.claimId } }], [{ name: "check_completeness", input: { claim_id: claim.header.claimId } }]], output({ route: "specialist_review" }));
  const r = await runAgent(claim, { client, vision: null, images: false });
  assert.equal(r.ok, true, r.failure ?? "");
  assert.equal(containsName(r.snapshot.join("\n"), claim.names), null);
  // The claimant and the third party are the same company here, so the first token wins.
  assert.match(r.snapshot.join("\n"), /\[CLAIMANT\]|\[THIRD_PARTY\]/);
});
