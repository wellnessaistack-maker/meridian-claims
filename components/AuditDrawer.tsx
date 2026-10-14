"use client";

// The audit drawer: the five-field record plus the rationale, and the place
// where a person confirms the route or changes it with a reason. Both append
// a record; the old one stays. Download as JSON or print.

import { useState } from "react";

import type { AuditRecord } from "@/lib/audit/record.ts";
import { ROUTES, ROUTE_LABELS, type FinalRoute, type Route } from "@/lib/claim/schema.ts";
import type { ClaimRow } from "@/lib/ui/workspace-data.ts";
import { RoutePill, pct, when } from "./ui";

export type DrawerMode = "view" | "confirm" | "change";

export function AuditDrawer({ row, mode, onClose, onConfirmed }: { row: ClaimRow; mode: DrawerMode; onClose: () => void; onConfirmed: (rec: AuditRecord) => void }) {
  const history = row.audit;
  const last = history[history.length - 1] ?? null;
  const [reviewer, setReviewer] = useState("");
  const [route, setRoute] = useState<FinalRoute>(last?.output.route ?? row.decision.route);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = last ? route !== last.output.route : false;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/audit/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimId: row.claimId, reviewer, route: changed ? route : undefined, reason: changed ? reason : undefined }) });
    const j = (await res.json()) as { ok: boolean; record?: AuditRecord; error?: string };
    setBusy(false);
    if (!j.ok || !j.record) return setError(j.error ?? "Could not confirm.");
    onConfirmed(j.record);
  };
  const download = () => {
    const blob = new Blob([JSON.stringify({ claimId: row.claimId, appendOnly: true, records: history }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${row.claimId}-audit.json`;
    a.click();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>Audit record</h2>
            <div className="sub">{row.claimId}. The five fields the compliance floor asks for, plus the rationale. Append-only; kept 7 years in production.</div>
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={download} disabled={!history.length}>Download JSON</button>
          <button className="btn btn-sm" onClick={() => window.print()} disabled={!history.length}>Print</button>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          {!last ? (
            <div className="failure">No audit record yet: the agent has not produced a packet for this claim. {row.documentCount === 0 ? "An extract row has no documents to read." : "Run the agent to create one."}</div>
          ) : (
            <>
              {(mode === "confirm" || mode === "change" || !last.humanReviewed) && (
                <section className="inline-form">
                  <div className="section-label">{mode === "change" ? "Change the route, with a reason" : "Confirm the route"}</div>
                  <div className="row">
                    <label>
                      Reviewer
                      <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Name or adjuster ID" />
                    </label>
                    <label>
                      Route
                      <select value={route} onChange={(e) => setRoute(e.target.value as Route)}>
                        {ROUTES.map((r) => (
                          <option key={r} value={r}>{ROUTE_LABELS[r]}{r === last.output.route ? " (recommended)" : ""}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {changed && (
                    <label>
                      Reason for the change (required; it becomes a test case)
                      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
                    </label>
                  )}
                  {error && <div className="err">{error}</div>}
                  <div className="row" style={{ alignItems: "center" }}>
                    <button className="btn btn-primary" style={{ flex: "0 0 auto" }} onClick={confirm} disabled={busy || !reviewer.trim() || (changed && !reason.trim())}>
                      {changed ? `Record the change to ${ROUTE_LABELS[route]}` : `Confirm ${ROUTE_LABELS[last.output.route]}`}
                    </button>
                    <span className="note" style={{ marginTop: 0 }}>Appends a record; nothing is edited. The decision itself is made in ClaimsPro; this prototype has no approve or deny operation.</span>
                  </div>
                </section>
              )}

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
                  <div style={{ color: "var(--text-2)" }}>Not yet.</div>
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
      </div>
    </div>
  );
}
