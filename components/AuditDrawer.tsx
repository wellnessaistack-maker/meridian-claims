"use client";

// The right-hand drawer: the five-field audit record plus the rationale.
// Confirm the route, or change it with a reason. Both append a record; the
// old one stays. Download as JSON or print.

import { useState } from "react";

import type { AuditRecord } from "@/lib/audit/record.ts";
import { ROUTES, ROUTE_LABELS, type FinalRoute, type Route } from "@/lib/claim/schema.ts";
import type { ClaimRow } from "@/lib/ui/workspace-data.ts";
import { RouteChip, pct, when } from "./ui";

export function AuditDrawer({ row, onClose, onConfirmed }: { row: ClaimRow; onClose: () => void; onConfirmed: (rec: AuditRecord) => void }) {
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
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <h3 className="text-sm font-semibold">Audit record · {row.claimId}</h3>
        <div className="flex gap-2 text-xs">
          <button onClick={download} disabled={!history.length} className="underline disabled:opacity-40">Download JSON</button>
          <button onClick={() => window.print()} disabled={!history.length} className="underline disabled:opacity-40">Print</button>
          <button onClick={onClose} className="rounded border border-slate-300 px-1.5">Close</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm print:overflow-visible">
        {!last ? (
          <p className="text-slate-600">No audit record: the agent has not produced a packet for this claim. {row.documentCount === 0 ? "An extract row has no documents to read." : "Run it to create one."}</p>
        ) : (
          <>
            <Field n="1" label="Input snapshot">
              SHA-256 <code className="font-mono text-xs">{last.input.hash}</code>
              <div className="text-xs text-slate-500">{last.input.snapshot.length} items the model was shown (masked), {new Set(last.input.documents).size} documents: {[...new Set(last.input.documents)].join(", ") || "none"}</div>
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-blue-700">Show what the model saw</summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px]">{last.input.snapshot.join("\n\n")}</pre>
              </details>
            </Field>
            <Field n="2" label="Model version">
              {last.modelVersion.modelServed ?? last.modelVersion.model} · prompt {last.modelVersion.promptVersion} · {last.modelVersion.agentVersion} · protocol {last.modelVersion.protocolVersion}
            </Field>
            <Field n="3" label="Output">
              <RouteChip route={last.output.route} /> <span className="text-xs text-slate-600">segment: {last.output.segment}; agent said {last.output.agentRoute ?? "nothing"}; rules fired: {last.output.rulesFired.join(", ") || "none"}</span>
            </Field>
            <Field n="4" label="Confidence (three measured numbers)">
              <ul className="text-xs text-slate-700">
                <li>Per-field extraction: {last.confidence.fieldExtraction.mean === null ? "n/a" : pct(last.confidence.fieldExtraction.mean)} over {last.confidence.fieldExtraction.measured} fields{last.confidence.fieldExtraction.weakest ? `, weakest ${last.confidence.fieldExtraction.weakest.label} ${pct(last.confidence.fieldExtraction.weakest.confidence)}` : ""}; re-reads {last.confidence.fieldExtraction.rereadsAgreed} of {last.confidence.fieldExtraction.rereads} agreed</li>
                <li>Evidence completeness: {pct(last.confidence.evidenceCompleteness)}</li>
                <li>Route: {last.confidence.route.value === null ? "not yet measured" : pct(last.confidence.route.value)} · {last.confidence.route.basis}</li>
              </ul>
            </Field>
            <Field n="5" label="Human reviewed">
              {last.humanReviewed ? (
                <span>
                  Yes: {last.reviewer} at {when(last.reviewedAt ?? "")}, route <RouteChip route={last.reviewerRoute ?? last.output.route} small />
                  {last.reviewerReason ? <span className="text-slate-600"> — “{last.reviewerReason}”</span> : null}
                </span>
              ) : (
                <span className="text-slate-600">Not yet. Confirm below.</span>
              )}
            </Field>
            <Field n="" label="Rationale">
              <p className="leading-relaxed">{last.rationale}</p>
            </Field>

            <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 print:hidden">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Confirm, or change the route with a reason</div>
              <label className="block text-xs">
                Reviewer
                <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Your name or adjuster ID" className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1" />
              </label>
              <label className="mt-2 block text-xs">
                Route
                <select value={route} onChange={(e) => setRoute(e.target.value as Route)} className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1">
                  {ROUTES.map((r) => (
                    <option key={r} value={r}>
                      {ROUTE_LABELS[r]}
                      {r === last.output.route ? " (recommended)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {changed && (
                <label className="mt-2 block text-xs">
                  Reason for the change (required; this becomes a test case)
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1" />
                </label>
              )}
              {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
              <button onClick={confirm} disabled={busy || !reviewer.trim() || (changed && !reason.trim())} className="mt-2 rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50">
                {changed ? "Record the change" : "Confirm this route"}
              </button>
              <div className="mt-1 text-[11px] text-slate-500">Appends a record; nothing is edited. The decision itself is made in ClaimsPro; this prototype has no approve or deny operation.</div>
            </div>

            {history.length > 1 && (
              <div className="mt-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">History ({history.length} records, append-only)</div>
                <ul className="text-xs text-slate-600">
                  {history.map((h) => (
                    <li key={h.id}>
                      {when(h.createdAt)} · {h.id} · {ROUTE_LABELS[h.output.route]}
                      {h.humanReviewed ? ` · reviewed by ${h.reviewer}${h.reviewerRoute && h.reviewerRoute !== h.output.route ? ` → ${ROUTE_LABELS[h.reviewerRoute]}` : ""}` : " · machine"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Field({ n, label, children }: { n: string; label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {n ? `${n}. ` : ""}
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
