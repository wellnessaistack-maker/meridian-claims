// Evaluation: the rules-only numbers on the extract (computed live from the
// CSV, the same code the test pins) and the packet evaluation results file
// when it exists. No pass/fail thresholds: the numbers are reported as they are.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadExtract } from "@/lib/extract/csv.ts";
import { pct, scoreRulesOnly, type FlagScore } from "@/lib/eval/rules-only.ts";
import { SEGMENT_LABELS, type Segment } from "@/lib/rules/engine.ts";

export const dynamic = "force-dynamic";

interface PacketEval {
  runAt: string;
  model: string;
  promptVersion: string;
  protocolVersion: string;
  cases: { caseId: string; claimId: string; provenance: string; expectedRoute: string; route: string; agentRoute: string | null; acceptable: boolean; mustEscalate: boolean; missedEscalation: boolean; overEscalated: boolean; fieldChecks: { field: string; expected: string; got: string | null; ok: boolean }[]; ok: boolean; failure: string | null; costUsd: number; durationMs: number }[];
  summary: { escalation: { caught: number; of: number; missedIds: string[] }; agreement: { exact: number; acceptable: number; of: number }; overEscalated: { count: number; of: number }; fields: { right: number; of: number }; byProvenance: Record<string, { exact: number; acceptable: number; of: number }>; cost: { total: number } };
  bySegment: Record<string, { agreed: number; of: number }>;
}

export default function EvaluationPage() {
  const report = scoreRulesOnly(loadExtract());
  const f = path.join(process.cwd(), "eval", "results", "latest.json");
  const packetEval = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as PacketEval) : null;
  return (
    <main className="mx-auto max-w-4xl px-6 py-6 text-sm">
      <a href="/" className="text-xs text-blue-700 underline">← Worklist</a>
      <h1 className="mt-2 text-lg font-semibold">Evaluation</h1>

      <section className="mt-4">
        <h2 className="text-base font-semibold">1. Rules only, on the extract</h2>
        <p className="mt-1 text-slate-700">
          The structured rules (state, amount, regulatory flag) over all 5,000 rows of the extract, scored on the 500 rows with a <code>requires_human_review</code> label. Today's flag is ClaimsPro's own <code>flagged_for_human_review</code>. The label is set after the fact, so it tracks the final complexity of the claim; a rule that runs at intake cannot see that. The regulatory floor is exact by construction.
        </p>
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-3"></th>
              <th className="py-1 pr-3">Flagged (of 5,000)</th>
              <th className="py-1 pr-3">Missed (needed review, not flagged)</th>
              <th className="py-1 pr-3">Unnecessary (flagged, not needed, not regulatory)</th>
              <th className="py-1">Regulatory misses</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Today's flag" s={report.today} />
            <Row label={`Protocol ${report.protocolVersion}, default settings`} s={report.rules} />
            <Row label="Regulatory floor only (R1, R2, R3)" s={report.regulatoryOnly} />
          </tbody>
        </table>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Simple-claim ceiling sweep</h3>
        <table className="mt-1 text-xs">
          <thead>
            <tr className="text-left text-slate-500"><th className="py-0.5 pr-4">Ceiling</th><th className="py-0.5 pr-4">Flag rate</th><th className="py-0.5 pr-4">Missed</th><th className="py-0.5">Unnecessary</th></tr>
          </thead>
          <tbody>
            {report.ceilingSweep.map((c) => (
              <tr key={c.ceilingUsd} className={c.ceilingUsd === report.settings.simpleClaimCeilingUsd ? "font-semibold" : ""}>
                <td className="py-0.5 pr-4">${c.ceilingUsd.toLocaleString()}</td><td className="py-0.5 pr-4">{pct(c.flagRate)}</td><td className="py-0.5 pr-4">{c.missed}</td><td className="py-0.5">{c.unnecessary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Where the rules put the 5,000 rows</h3>
        <ul className="mt-1 text-xs">
          {Object.entries(report.bySegment).map(([s, n]) => (
            <li key={s}>
              {SEGMENT_LABELS[s as Segment] ?? s}: {n.toLocaleString()}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">2. Packets, on the labelled cases</h2>
        {!packetEval ? (
          <p className="mt-1 text-slate-700">Not yet run. <code>npm run eval</code> scores the cached packets against <code>eval/cases.csv</code> and writes eval/results/latest.json; route confidence on the audit record reads from it and until then says “not yet measured”.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-slate-500">
              Scored {packetEval.runAt} from the cached packets · {packetEval.model} · prompt {packetEval.promptVersion} · protocol {packetEval.protocolVersion} · {packetEval.cases.length} cases · ${packetEval.summary.cost.total.toFixed(2)} of model spend recorded on the packets
            </p>
            <ul className="mt-2 text-sm">
              <li>Escalation recall: {packetEval.summary.escalation.caught} of {packetEval.summary.escalation.of} claims that must reach a person did{packetEval.summary.escalation.missedIds.length ? ` (missed: ${packetEval.summary.escalation.missedIds.join(", ")})` : ""}.</li>
              <li>Route agreement: {packetEval.summary.agreement.exact} exact, {packetEval.summary.agreement.acceptable} acceptable, of {packetEval.summary.agreement.of}.</li>
              <li>Unnecessary escalations: {packetEval.summary.overEscalated.count} of {packetEval.summary.overEscalated.of} claims that did not need a person.</li>
              <li>Re-read field accuracy: {packetEval.summary.fields.right} of {packetEval.summary.fields.of} checked fields.</li>
            </ul>
            <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">By provenance</h3>
            <table className="mt-1 text-xs">
              <tbody>
                {Object.entries(packetEval.summary.byProvenance).map(([k, v]) => (
                  <tr key={k}><td className="pr-4">{k}</td><td className="pr-4">{v.exact} exact</td><td className="pr-4">{v.acceptable} acceptable</td><td>of {v.of}</td></tr>
                ))}
              </tbody>
            </table>
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500"><th className="py-1 pr-2">Case</th><th className="py-1 pr-2">Provenance</th><th className="py-1 pr-2">Expected</th><th className="py-1 pr-2">Got</th><th className="py-1 pr-2">Agent</th><th className="py-1">Fields</th></tr>
              </thead>
              <tbody>
                {packetEval.cases.map((c) => (
                  <tr key={c.caseId} className={`border-t border-slate-100 ${c.acceptable ? "" : "bg-red-50"}`}>
                    <td className="py-1 pr-2 font-mono">{c.caseId}</td><td className="py-1 pr-2">{c.provenance}</td><td className="py-1 pr-2">{c.expectedRoute}</td><td className="py-1 pr-2">{c.ok ? c.route : `failed: ${c.failure}`}</td><td className="py-1 pr-2">{c.agentRoute ?? "—"}</td>
                    <td className="py-1">{c.fieldChecks.length ? c.fieldChecks.map((f) => `${f.field} ${f.ok ? "✓" : `✗ (${f.got ?? "blank"} ≠ ${f.expected})`}`).join("; ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-500">Labels are drafts by one person; two adjusters labelling independently, with disagreements resolved, is the next step before any number here is quoted.</p>
          </>
        )}
      </section>
    </main>
  );
}

function Row({ label, s }: { label: string; s: FlagScore }) {
  return (
    <tr className="border-t border-slate-200">
      <td className="py-1 pr-3 font-medium">{label}</td>
      <td className="py-1 pr-3">{s.flagged.toLocaleString()} ({pct(s.flagRate)})</td>
      <td className="py-1 pr-3">{s.missed} of {s.needed}</td>
      <td className="py-1 pr-3">{s.unnecessary}</td>
      <td className="py-1">{s.missedRegulatory} of {s.regulatoryLabelled}</td>
    </tr>
  );
}
