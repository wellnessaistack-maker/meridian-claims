// Builds the ClaimPacket from what the tools returned and what the model
// described. Code owns every measured number: field confidence, completeness,
// the cross-checks. The model's part is the descriptions: fields it read from
// text, the timeline, contradictions, indicators, its route and the rationale.

import type { LoadedClaim } from "../claim/load.ts";
import { hashInputs } from "../claim/load.ts";
import { claimPacketSchema, type ClaimPacket, type Contradiction, type DenialIndicator, type Provenance, type Source, type SourcedField, type TimelineEvent } from "../claim/schema.ts";
import { checkCompleteness } from "../rules/checklist.ts";
import type { PacketView } from "../rules/protocol.ts";
import type { AgentOutput } from "./output.ts";
import type { ToolContext } from "./tools.ts";

export interface AssembleMeta {
  modelRequested: string;
  modelServed: string | null;
  promptVersion: string;
  agentVersion: string;
  provenance: Provenance;
}

const sourceFor = (c: LoadedClaim, document: string): Source => {
  if (/^(intake|status_history)\.md$/.test(document)) return "claimspro";
  if (document.includes("policy")) return "snowflake";
  return "databricks";
};

export function assemblePacket(ctx: ToolContext, output: AgentOutput | null, meta: AssembleMeta, failure: string | null): ClaimPacket {
  const c = ctx.claim;
  const h = c.header;
  const completeness = ctx.completeness ?? checkCompleteness(c);

  const fields: SourcedField[] = [];
  const add = (f: Omit<SourcedField, "reread"> & { reread?: SourcedField["reread"] }) => fields.push({ reread: null, ...f });
  const dbField = "structured database field; no confidence concept";
  add({ key: "claim_amount", label: "Claim amount", value: h.amountUsd === null ? null : h.amountUsd.toFixed(2), source: "claimspro", document: "intake.md", page: null, confidence: null, basis: dbField });
  add({ key: "claim_type", label: "Claim type", value: h.claimType, source: "claimspro", document: "intake.md", page: null, confidence: null, basis: dbField });
  add({ key: "loss_state", label: "Loss state", value: h.state, source: "claimspro", document: "intake.md", page: null, confidence: null, basis: dbField });
  add({ key: "intake_channel", label: "Intake channel", value: h.channel, source: "claimspro", document: "intake.md", page: null, confidence: null, basis: dbField });
  add({ key: "filed_date", label: "Filed date", value: h.filedDate, source: "claimspro", document: "intake.md", page: null, confidence: null, basis: dbField });
  const dolFromIntake = c.claimsPro.get("Date of loss");
  add({ key: "date_of_loss", label: "Date of loss", value: h.dateOfLoss, source: dolFromIntake ? "claimspro" : c.edi?.dateOfLoss ? "databricks" : "claimspro", document: dolFromIntake ? "intake.md" : c.edi?.dateOfLoss ? "edi_record.txt" : "intake.md", page: null, confidence: null, basis: dolFromIntake ? dbField : c.edi?.dateOfLoss ? "Not on the intake record; taken from the EDI accident date (DTP*439) in code" : "Not on the intake record" });
  add({ key: "policy_number", label: "Policy number", value: h.policyNumber, source: "snowflake", document: "intake.md (policy fields)", page: null, confidence: null, basis: "policy record" });
  add({ key: "vehicle", label: "Insured vehicle", value: h.vehicle, source: "snowflake", document: "intake.md (policy fields)", page: null, confidence: null, basis: "policy record" });
  add({ key: "regulatory_flag", label: "Requires human by regulation", value: h.regulatoryReviewRequired === null ? null : h.regulatoryReviewRequired ? "Yes" : "No", source: "claimspro", document: "status_history.md", page: null, confidence: null, basis: h.regulatoryReviewRequired === null ? "Not on file; the rules treat unknown as required" : dbField });
  if (c.edi) {
    if (c.edi.claimAmount !== null) add({ key: "edi_claim_amount", label: "Claim amount (EDI)", value: c.edi.claimAmount.toFixed(2), source: "databricks", document: "edi_record.txt", page: null, confidence: null, basis: "Parsed from the EDI 837 CLM segment in code" });
    if (c.edi.estimateRef) add({ key: "edi_estimate_ref", label: "Estimate reference (EDI)", value: c.edi.estimateRef, source: "databricks", document: "edi_record.txt", page: null, confidence: null, basis: "Parsed from the EDI REF*D9 segment in code" });
  }
  if (c.ocr) {
    for (const f of c.ocr.fields) {
      const reread = ctx.rereads.get(f.key) ?? null;
      let confidence = f.confidence;
      let basis = f.basis;
      let value = f.value;
      if (reread) {
        if (reread.agreed === true && reread.visionValue !== null) {
          confidence = 0.95;
          value = reread.visionValue;
          basis = `${f.basis} Vision re-read "${reread.visionValue}" agrees${reread.codeCheck ? " and the arithmetic check gives the same figure" : ""}; two independent reads.`;
        } else if (reread.agreed === true) {
          basis = `${f.basis} Vision re-read confirms the field is not on the page.`;
        } else if (reread.agreed === false) {
          confidence = Math.min(confidence, 0.3);
          basis = `${f.basis} Vision re-read "${reread.visionValue}" disagrees with the OCR; a person checks the page.`;
        } else {
          basis = `${f.basis} Vision could not read the field either.`;
        }
      }
      add({ key: f.key, label: f.label, value, source: "databricks", document: c.ocr.document, page: f.page, confidence, basis, reread });
    }
  }
  for (const f of output?.fields_read ?? []) {
    const doc = c.databricks.documents.find((d) => d.name === f.document);
    const engine = doc?.engineConfidence ?? null;
    add({
      key: `model_${f.key.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      label: f.label,
      value: f.value,
      source: sourceFor(c, f.document),
      document: f.document,
      page: null,
      confidence: engine,
      basis: `Read by the model from ${f.document}${engine !== null ? ` (engine confidence ${engine} for the document)` : " (no engine confidence; a person can check the quote)"}. Quote: "${f.quote}"`,
    });
  }

  // Timeline: the status history in code, plus what the model dated.
  const timeline: TimelineEvent[] = c.claimsPro.statusHistory.map((e) => ({ at: e.at.replace(" ", "T"), event: `${e.status}: ${e.note}`, source: "claimspro", document: "status_history.md" }));
  if (h.dateOfLoss) timeline.push({ at: h.dateOfLoss, event: "Date of loss", source: dolFromIntake ? "claimspro" : "databricks", document: dolFromIntake ? "intake.md" : "edi_record.txt" });
  const est = c.ocr?.fields.find((f) => f.key === "ocr_estimate_written")?.value;
  if (est) timeline.push({ at: est, event: "Repair estimate written (per the faxed estimate)", source: "databricks", document: c.ocr!.document });
  for (const e of output?.timeline ?? []) {
    if (timeline.some((t) => t.at.slice(0, 10) === e.at.slice(0, 10) && t.event.toLowerCase().includes(e.event.toLowerCase().slice(0, 20)))) continue;
    timeline.push({ at: e.at, event: e.event, source: sourceFor(c, e.document), document: e.document });
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  // Contradictions: the model's, plus the ones code can see for itself.
  const contradictions: Contradiction[] = (output?.contradictions ?? []).map((x) => ({
    topic: x.topic,
    a: { source: sourceFor(c, x.a.document), document: x.a.document, quote: x.a.quote },
    b: { source: sourceFor(c, x.b.document), document: x.b.document, quote: x.b.quote },
    material: x.material,
    note: x.note,
  }));
  if (est && h.dateOfLoss && est < h.dateOfLoss && !contradictions.some((x) => /estimate/i.test(x.topic) && /loss|accident/i.test(x.topic))) {
    contradictions.push({
      topic: "Estimate dated before the date of loss",
      a: { source: "databricks", document: c.ocr!.document, quote: `Written ${est}` },
      b: { source: dolFromIntake ? "claimspro" : "databricks", document: dolFromIntake ? "intake.md" : "edi_record.txt", quote: `Date of loss ${h.dateOfLoss}` },
      material: true,
      note: "A repair estimate written before the reported loss date needs explaining before the claim can be decided. Found by code: date comparison.",
    });
  }
  if (c.edi?.claimAmount !== null && c.edi?.claimAmount !== undefined && h.amountUsd !== null && Math.abs(c.edi.claimAmount - h.amountUsd) > 0.01) {
    contradictions.push({ topic: "Claim amount differs between intake and EDI", a: { source: "claimspro", document: "intake.md", quote: `Claim amount $${h.amountUsd.toFixed(2)}` }, b: { source: "databricks", document: "edi_record.txt", quote: `CLM02 ${c.edi.claimAmount.toFixed(2)}` }, material: true, note: "Found by code: amount comparison." });
  }

  const denialIndicators: DenialIndicator[] = (output?.denial_indicators ?? []).map((d) => ({ kind: d.kind, evidence: d.evidence, source: sourceFor(c, d.document), document: d.document }));
  if (c.snowflake.policyStatus === "lapsed" && !denialIndicators.some((d) => d.kind === "policy_lapse")) {
    denialIndicators.push({ kind: "policy_lapse", evidence: c.snowflake.policyStatusBasis, source: "snowflake", document: "intake.md (policy fields)" });
  }

  const assembled = output !== null && failure === null;
  const packet: ClaimPacket = {
    claimId: h.claimId,
    provenance: meta.provenance,
    status: assembled ? "assembled" : "not_assembled",
    notAssembledReason: assembled ? null : failure ?? "The model returned no packet.",
    generatedAt: new Date().toISOString(),
    model: { requested: meta.modelRequested, served: meta.modelServed, promptVersion: meta.promptVersion, agentVersion: meta.agentVersion },
    header: h,
    evidence: completeness.items,
    completeness: completeness.completeness,
    fields,
    timeline,
    contradictions,
    missing: completeness.missing,
    denialIndicators,
    agentRoute: output?.route ?? null,
    rationale: output?.rationale ?? "",
    trace: ctx.trace,
    inputHash: hashInputs(ctx.snapshot),
    settingsUsed: { ocrRereadThreshold: ctx.settings.ocrRereadThreshold },
  };
  return claimPacketSchema.parse(packet);
}

/** The slice of a packet the rules look at. */
export function packetView(p: ClaimPacket): PacketView {
  return {
    assembled: p.status === "assembled",
    notAssembledReason: p.notAssembledReason,
    agentRoute: p.agentRoute,
    completeness: p.completeness,
    missing: p.missing.map((m) => ({ id: m.id, label: m.label, from: m.from })),
    fields: p.fields.map((f) => ({ key: f.key, label: f.label, confidence: f.confidence, reread: f.reread ? { agreed: f.reread.agreed } : null })),
    contradictions: p.contradictions.map((x) => ({ topic: x.topic, material: x.material })),
    denialIndicators: p.denialIndicators.map((d) => ({ kind: d.kind, evidence: d.evidence })),
    rationale: p.rationale,
  };
}
