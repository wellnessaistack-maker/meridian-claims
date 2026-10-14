// The five-field audit record, plus the rationale. One append-only file per
// claim under data/audit/. A record is never edited: confirming or changing a
// route appends a new record with human_reviewed true.
//
//   1. input snapshot   what the model saw (masked), stored, with its SHA-256
//   2. model version    model, prompt, agent and protocol versions
//   3. output           the final route, the agent's route and the rules that fired
//   4. confidence       the three measured numbers
//   5. human_reviewed   false until an adjuster confirms in the UI; then who and when

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type { ClaimPacket, FinalRoute } from "../claim/schema.ts";
import { fieldConfidence, routeConfidence, type FieldConfidenceSummary, type RouteConfidence } from "../confidence.ts";
import type { Decision } from "../rules/engine.ts";

export interface AuditRecord {
  id: string;
  claimId: string;
  createdAt: string;
  input: { hash: string; snapshot: string[]; documents: string[] };
  modelVersion: { model: string; modelServed: string | null; promptVersion: string; agentVersion: string; protocolVersion: string };
  output: { route: FinalRoute; agentRoute: string | null; rulesFired: string[]; segment: string };
  confidence: { fieldExtraction: FieldConfidenceSummary; evidenceCompleteness: number | null; route: RouteConfidence };
  humanReviewed: boolean;
  reviewer: string | null;
  reviewedAt: string | null;
  reviewerRoute: FinalRoute | null;
  reviewerReason: string | null;
  rationale: string;
  retentionYears: 7;
}

const DIR = path.join("data", "audit");
const memory = new Map<string, AuditRecord[]>();

const fileFor = (claimId: string, root: string) => path.join(root, DIR, `${claimId}.json`);

export function readAudit(claimId: string, root = process.cwd()): AuditRecord[] {
  const mem = memory.get(claimId);
  if (mem) return mem;
  const p = fileFor(claimId, root);
  if (!existsSync(p)) return [];
  return (JSON.parse(readFileSync(p, "utf8")) as { records: AuditRecord[] }).records;
}

function save(claimId: string, records: AuditRecord[], root: string) {
  memory.set(claimId, records);
  try {
    mkdirSync(path.join(root, DIR), { recursive: true });
    writeFileSync(fileFor(claimId, root), JSON.stringify({ appendOnly: true, records }, null, 2) + "\n");
  } catch {
    // read-only filesystem: memory only
  }
}

export function recordFor(packet: ClaimPacket, decision: Decision, snapshot: string[], root = process.cwd()): AuditRecord {
  const createdAt = new Date().toISOString();
  return {
    id: "aud_" + createHash("sha256").update(`${packet.claimId}|${packet.inputHash}|${createdAt}`).digest("hex").slice(0, 12),
    claimId: packet.claimId,
    createdAt,
    input: { hash: packet.inputHash, snapshot, documents: packet.evidence.filter((e) => e.present && e.document).map((e) => e.document!) },
    modelVersion: { model: packet.model.requested, modelServed: packet.model.served, promptVersion: packet.model.promptVersion, agentVersion: packet.model.agentVersion, protocolVersion: decision.protocolVersion },
    output: { route: decision.route, agentRoute: decision.agentRoute, rulesFired: decision.reasons.map((r) => r.id), segment: decision.segment },
    confidence: { fieldExtraction: fieldConfidence(packet), evidenceCompleteness: packet.completeness, route: routeConfidence(decision.segment, root) },
    humanReviewed: false,
    reviewer: null,
    reviewedAt: null,
    reviewerRoute: null,
    reviewerReason: null,
    rationale: packet.rationale,
    retentionYears: 7,
  };
}

/** Appends a new record. Returns the full history. */
export function appendAudit(record: AuditRecord, root = process.cwd()): AuditRecord[] {
  const records = [...readAudit(record.claimId, root), record];
  save(record.claimId, records, root);
  return records;
}

/** The adjuster confirms the route, or changes it with a reason. A new record is appended; the old one stays. */
export function confirmAudit(claimId: string, reviewer: string, change: { route?: FinalRoute; reason?: string } = {}, root = process.cwd()): AuditRecord {
  const history = readAudit(claimId, root);
  const last = history[history.length - 1];
  if (!last) throw new Error(`No audit record for ${claimId} to confirm.`);
  if (change.route && change.route !== last.output.route && !change.reason?.trim()) throw new Error("Changing the route needs a reason.");
  const at = new Date().toISOString();
  const rec: AuditRecord = {
    ...last,
    id: "aud_" + createHash("sha256").update(`${claimId}|${last.id}|${at}`).digest("hex").slice(0, 12),
    createdAt: at,
    humanReviewed: true,
    reviewer,
    reviewedAt: at,
    reviewerRoute: change.route ?? last.output.route,
    reviewerReason: change.reason ?? null,
  };
  save(claimId, [...history, rec], root);
  return rec;
}
