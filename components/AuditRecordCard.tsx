"use client";

// The audit record, in the packet pane rather than a drawer: the five fields
// the compliance floor asks for, the rationale and the append-only history.
// Download as JSON or print. Confirming happens in the action bar, not here.

import type { AuditRecord } from "@/lib/audit/record.ts";
import { ROUTE_LABELS, type FinalRoute } from "@/lib/claim/schema.ts";
import type { ClaimRow } from "@/lib/ui/workspace-data.ts";
import { RoutePill, pct, when } from "./ui";

export function AuditRecordCard({ row, open, onToggle }: { row: ClaimRow; open: boolean; onToggle: (open: boolean) => void }) {
  const history: AuditRecord[] = row.audit;
  const last = history[history.length - 1] ?? null;
  const download = () => {
    const blob = new Blob([JSON.stringify({ claimId: row.claimId, appendOnly: true, records: history }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${row.claimId}-audit.json`;
    a.click();
  };
  return (
    <details id="audit-record" className="card fold-card" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="card-head">
        <h3>Audit record{history.length > 1 && <span className="n">{history.length}</span>}</h3>
        <span className="sub">The five fields the compliance floor asks for. Append-only; kept 7 years in production.</span>
      </summary>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {!last ? (
          <div className="failure">No audit record yet: the agent has not produced a packet for this claim. {row.documentCount === 0 ? "An extract row has no documents to read." : "Run the agent to create one."}</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-sm" onClick={download}>Download JSON</button>
              <button className="btn btn-sm" onClick={() => window.print()}>Print</button>
              <span className="hint" style={{ alignSelf: "center" }}>Record {last.id}, {when(last.createdAt)}</span>
            </div>
            <section>
              <div className="section-label">1. Input snapshot</div>
              <dl className="kv">
                <dt>SHA-256</dt><dd className="mono">{last.input.hash}</dd>
                <dt>Documents</dt><dd>{[...new Set(last.input.documents)].join(", ") || "none"}</dd>
                <dt>Shown to the model</dt><dd>{last.input.snapshot.length} items, masked</dd>
              </dl>
              <details className="fold" style={{ marginTop: 6 }}>
                <summary>Show what the model saw</summary>
                <pre className="json" style={{ marginTop: 6 }}>{last.input.snapshot.join("\n\n")}</pre>
              </details>
            </section>
            <section>
              <div className="section-label">2. Model version</div>
              <dl className="kv">
                <dt>Model</dt><dd className="mono">{last.modelVersion.modelServed ?? last.modelVersion.model}</dd>
                <dt>Prompt · agent</dt><dd className="mono">{last.modelVersion.promptVersion} · {last.modelVersion.agentVersion}</dd>
                <dt>Protocol</dt><dd className="mono">{last.modelVersion.protocolVersion}</dd>
              </dl>
            </section>
            <section>
              <div className="section-label">3. Output</div>
              <dl className="kv">
                <dt>Route</dt><dd><RoutePill route={last.output.route} /> <span style={{ color: "var(--text-3)" }}>segment: {last.output.segment}</span></dd>
                <dt>Agent said</dt><dd>{last.output.agentRoute ? ROUTE_LABELS[last.output.agentRoute as FinalRoute] : "nothing (not assembled)"}</dd>
                <dt>Rules fired</dt><dd className="mono">{last.output.rulesFired.join(", ") || "none"}</dd>
              </dl>
            </section>
            <section>
              <div className="section-label">4. Confidence (three measured numbers)</div>
              <dl className="kv">
                <dt>Per-field extraction</dt>
                <dd>{last.confidence.fieldExtraction.mean === null ? "n/a (no OCR or ASR fields)" : `${pct(last.confidence.fieldExtraction.mean)} over ${last.confidence.fieldExtraction.measured} fields`}{last.confidence.fieldExtraction.weakest ? `; weakest ${last.confidence.fieldExtraction.weakest.label} ${pct(last.confidence.fieldExtraction.weakest.confidence)}` : ""}{last.confidence.fieldExtraction.rereads ? `; re-reads ${last.confidence.fieldExtraction.rereadsAgreed} of ${last.confidence.fieldExtraction.rereads} agreed` : ""}</dd>
                <dt>Evidence completeness</dt><dd>{pct(last.confidence.evidenceCompleteness)}</dd>
                <dt>Route</dt><dd>{last.confidence.route.value === null ? "Not yet measured" : pct(last.confidence.route.value)} · {last.confidence.route.basis}</dd>
              </dl>
            </section>
            <section>
              <div className="section-label">5. Human reviewed</div>
              {last.humanReviewed ? (
                <div>
                  Yes: <b>{last.reviewer}</b> at {when(last.reviewedAt ?? "")}, route <RoutePill route={last.reviewerRoute ?? last.output.route} small />
                  {last.reviewerReason ? <span style={{ color: "var(--text-2)" }}> — “{last.reviewerReason}”</span> : null}
                </div>
              ) : (
                <div style={{ color: "var(--text-2)" }}>Not yet. Confirming below fills this field with the signed-in adjuster.</div>
              )}
            </section>
            <section>
              <div className="section-label">Rationale</div>
              <p style={{ margin: 0, lineHeight: 1.55 }}>{last.rationale}</p>
            </section>
            {history.length > 1 && (
              <section>
                <div className="section-label">History ({history.length} records, append-only)</div>
                <ul className="timeline">
                  {history.map((h) => (
                    <li key={h.id}><span className="at">{when(h.createdAt)}</span><span className="mono">{h.id}</span><span>{ROUTE_LABELS[h.output.route]}{h.humanReviewed ? ` · reviewed by ${h.reviewer}${h.reviewerRoute && h.reviewerRoute !== h.output.route ? ` → ${ROUTE_LABELS[h.reviewerRoute]}` : ""}` : " · machine"}</span></li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </details>
  );
}
