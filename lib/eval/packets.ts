// The packet evaluation: the cached packets against the draft labels in
// eval/cases.csv. No pass/fail thresholds; the numbers are reported as they are.
// Labels are drafts by one person and say so on the page.

import { readFileSync } from "node:fs";
import path from "node:path";

import { ROUTE_ORDER, type FinalRoute } from "../claim/schema.ts";
import { PROTOCOL_VERSION } from "../rules/protocol.ts";
import type { ClaimRow } from "../ui/workspace-data.ts";

export interface EvalCase {
  caseId: string;
  claimId: string;
  provenance: "provided" | "variant" | "mock";
  expectedRoute: FinalRoute;
  acceptableRoutes: FinalRoute[];
  /** field key → expected value, checked against the packet's fields. */
  fieldChecks: { field: string; expected: string }[];
  note: string;
}

export interface CaseResult {
  caseId: string;
  claimId: string;
  provenance: string;
  expectedRoute: string;
  route: string;
  agentRoute: string | null;
  segment: string;
  acceptable: boolean;
  exact: boolean;
  mustEscalate: boolean;
  missedEscalation: boolean;
  overEscalated: boolean;
  fieldChecks: { field: string; expected: string; got: string | null; ok: boolean }[];
  ok: boolean;
  failure: string | null;
  costUsd: number;
  durationMs: number;
  note: string;
}

export interface PacketEval {
  runAt: string;
  model: string;
  promptVersion: string;
  protocolVersion: string;
  source: "cached packets";
  cases: CaseResult[];
  summary: {
    escalation: { caught: number; of: number; missedIds: string[] };
    agreement: { exact: number; acceptable: number; of: number };
    overEscalated: { count: number; of: number; ids: string[] };
    fields: { right: number; of: number };
    byProvenance: Record<string, { exact: number; acceptable: number; of: number }>;
    cost: { total: number };
  };
  /** Per segment, how many evaluated claims got exactly the labelled route. Read by routeConfidence(). */
  bySegment: Record<string, { agreed: number; of: number }>;
}

/** A route that takes the claim to a senior or a full adjudication. */
const ESCALATES = (r: FinalRoute) => ROUTE_ORDER[r] >= ROUTE_ORDER.specialist_review;

export function loadCases(root = process.cwd()): EvalCase[] {
  const text = readFileSync(path.join(root, "eval", "cases.csv"), "utf8");
  const [head, ...lines] = text.trim().split("\n");
  const cols = head.split(",");
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(",");
    // The note is the last column and may contain commas.
    const row = Object.fromEntries(cols.map((c, i) => [c, i === cols.length - 1 ? cells.slice(i).join(",") : (cells[i] ?? "")])) as Record<string, string>;
    return {
      caseId: row.case_id,
      claimId: row.claim_id,
      provenance: row.provenance as EvalCase["provenance"],
      expectedRoute: row.expected_route as FinalRoute,
      acceptableRoutes: row.acceptable_routes ? (row.acceptable_routes.split("|") as FinalRoute[]) : [],
      fieldChecks: row.field_checks ? row.field_checks.split("|").map((fc) => ({ field: fc.slice(0, fc.indexOf("=")), expected: fc.slice(fc.indexOf("=") + 1) })) : [],
      note: row.note.replace(/;/g, ","),
    };
  });
}

export function scorePackets(cases: EvalCase[], rows: ClaimRow[], model: string): PacketEval {
  const byId = new Map(rows.map((r) => [r.claimId, r]));
  const results: CaseResult[] = cases.map((c) => {
    const row = byId.get(c.claimId);
    const packet = row?.packet ?? null;
    const needsPacket = c.expectedRoute !== "out_of_scope";
    const failure = !row ? "no claim folder" : needsPacket && !packet ? "no cached packet" : null;
    const route = row?.decision.route ?? c.expectedRoute;
    const mustEscalate = ESCALATES(c.expectedRoute);
    const exact = !failure && route === c.expectedRoute;
    const acceptable = !failure && (exact || c.acceptableRoutes.includes(route));
    const fieldChecks = c.fieldChecks.map((fc) => {
      const f = packet?.packet.fields.find((x) => x.key === fc.field);
      const got = f?.value == null ? null : String(f.value);
      // Amounts compare without thousands separators (the CSV cannot hold a comma in a cell).
      const norm = (v: string) => v.replace(/,/g, "").trim();
      return { ...fc, got, ok: got !== null && norm(got) === norm(fc.expected) };
    });
    return {
      caseId: c.caseId,
      claimId: c.claimId,
      provenance: c.provenance,
      expectedRoute: c.expectedRoute,
      route,
      agentRoute: row?.decision.agentRoute ?? null,
      segment: row?.decision.segment ?? "regulatory",
      acceptable,
      exact,
      mustEscalate,
      missedEscalation: !failure && mustEscalate && !ESCALATES(route),
      overEscalated: !failure && !mustEscalate && ESCALATES(route),
      fieldChecks,
      ok: !failure,
      failure,
      costUsd: packet?.usage.costUsd ?? 0,
      durationMs: packet?.usage.durationMs ?? 0,
      note: c.note,
    };
  });
  const must = results.filter((r) => r.mustEscalate);
  const need = results.filter((r) => !r.mustEscalate);
  const byProvenance: PacketEval["summary"]["byProvenance"] = {};
  const bySegment: PacketEval["bySegment"] = {};
  for (const r of results) {
    const p = (byProvenance[r.provenance] ??= { exact: 0, acceptable: 0, of: 0 });
    p.of++;
    if (r.exact) p.exact++;
    if (r.acceptable) p.acceptable++;
    const s = (bySegment[r.segment] ??= { agreed: 0, of: 0 });
    s.of++;
    if (r.exact) s.agreed++;
  }
  const allFields = results.flatMap((r) => r.fieldChecks);
  const promptVersion = [...new Set(results.map((r) => byId.get(r.claimId)?.packet?.packet.model.promptVersion).filter(Boolean))].join(", ") || "unknown";
  return {
    runAt: new Date().toISOString(),
    model,
    promptVersion,
    protocolVersion: PROTOCOL_VERSION,
    source: "cached packets",
    cases: results,
    summary: {
      escalation: { caught: must.filter((r) => !r.missedEscalation && r.ok).length, of: must.length, missedIds: must.filter((r) => r.missedEscalation || !r.ok).map((r) => r.caseId) },
      agreement: { exact: results.filter((r) => r.exact).length, acceptable: results.filter((r) => r.acceptable).length, of: results.length },
      overEscalated: { count: need.filter((r) => r.overEscalated).length, of: need.length, ids: need.filter((r) => r.overEscalated).map((r) => r.caseId) },
      fields: { right: allFields.filter((f) => f.ok).length, of: allFields.length },
      byProvenance,
      cost: { total: Math.round(results.reduce((s, r) => s + r.costUsd, 0) * 100) / 100 },
    },
    bySegment,
  };
}
