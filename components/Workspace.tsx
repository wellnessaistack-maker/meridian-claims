"use client";

// One page, three panes: the worklist, the packet, the audit drawer.
// State lives here: which claim is open, drawer open or closed, packets that
// were re-run in this session, audit records confirmed in this session.

import { useMemo, useState } from "react";

import type { AuditRecord } from "@/lib/audit/record.ts";
import type { PacketRecord } from "@/lib/agent/cache.ts";
import type { ClaimRow, WorkspaceData } from "@/lib/ui/workspace-data.ts";
import { AuditDrawer } from "./AuditDrawer";
import { ErrorBoundary } from "./ErrorBoundary";
import { PacketView } from "./PacketView";
import { Worklist } from "./Worklist";

const NO_KEY = "No API key. Showing cached packets; re-run is disabled.";

export function Workspace({ data }: { data: WorkspaceData }) {
  const [selected, setSelected] = useState<string | null>(data.rows.find((r) => r.packet)?.claimId ?? data.rows[0]?.claimId ?? null);
  const [drawer, setDrawer] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Partial<ClaimRow>>>({});
  const [rerun, setRerun] = useState<{ running: boolean; error: string | null }>({ running: false, error: null });

  const rows = useMemo(() => data.rows.map((r) => (overrides[r.claimId] ? { ...r, ...overrides[r.claimId] } : r)), [data.rows, overrides]);
  const row = rows.find((r) => r.claimId === selected) ?? null;

  const onConfirmed = (rec: AuditRecord) => {
    if (!row) return;
    setOverrides((o) => ({ ...o, [row.claimId]: { ...o[row.claimId], audit: [...row.audit, rec] } }));
  };

  const onRerun = async () => {
    if (!row) return;
    let token = typeof window !== "undefined" ? window.localStorage.getItem("agentRunToken") : null;
    if (!token) {
      token = window.prompt("Re-runs spend API money, so the endpoint needs the run token (AGENT_RUN_TOKEN on the deployment).");
      if (!token) return;
      window.localStorage.setItem("agentRunToken", token);
    }
    setRerun({ running: true, error: null });
    try {
      const res = await fetch(`/api/agent/run?claim=${encodeURIComponent(row.claimId)}`, { headers: { "x-agent-run-token": token } });
      const j = (await res.json()) as { ok: boolean; error?: string; failure?: string | null; packet?: PacketRecord["packet"]; decision?: PacketRecord["decision"]; usage?: PacketRecord["usage"]; audit?: AuditRecord | null };
      if (!res.ok) {
        if (res.status === 403) window.localStorage.removeItem("agentRunToken");
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      if (!j.ok || !j.packet || !j.decision || !j.usage) throw new Error(j.failure ?? "The run did not produce a packet. The cached packet is kept.");
      const packet: PacketRecord = { packet: j.packet, decision: j.decision, usage: j.usage, savedAt: new Date().toISOString() };
      setOverrides((o) => ({ ...o, [row.claimId]: { ...o[row.claimId], packet, decision: j.decision, audit: j.audit ? [...row.audit, j.audit] : row.audit } }));
      setRerun({ running: false, error: null });
    } catch (err) {
      setRerun({ running: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-900 px-4 text-sm text-slate-200">
        <span className="font-semibold text-white">Meridian claim readiness</span>
        <span className="rounded-full border border-slate-700 px-2 text-[11px] text-slate-300">prototype · protocol {data.protocolVersion} · {data.model}</span>
        <span className="flex-1" />
        <nav className="flex gap-3 text-xs">
          <a href="/rules" className="hover:text-white">Rules</a>
          <a href="/evaluation" className="hover:text-white">Evaluation</a>
          <a href="/api/health" className="hover:text-white">Health</a>
        </nav>
      </header>
      {!data.apiKey && <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">{NO_KEY}</div>}
      <ErrorBoundary fallback={(error, reset) => <ManualTriage error={error} reset={reset} rows={rows} />}>
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: drawer ? "300px minmax(420px, 1fr) minmax(380px, 36%)" : "300px minmax(420px, 1fr)" }}>
          <aside className="min-h-0 border-r border-slate-200 bg-white">
            <Worklist rows={rows} selected={selected} onSelect={(id) => { setSelected(id); setRerun({ running: false, error: null }); }} />
          </aside>
          <main className="min-h-0 bg-slate-50/60">
            {row ? <PacketView row={row} decision={row.decision} onOpenAudit={() => setDrawer(true)} onRerun={onRerun} rerunState={rerun} apiKey={data.apiKey} model={data.model} /> : <div className="p-6 text-sm text-slate-500">No claims.</div>}
          </main>
          {drawer && row && (
            <aside className="min-h-0 border-l border-slate-200 bg-white print:fixed print:inset-0">
              <AuditDrawer key={row.claimId + row.audit.length} row={row} onClose={() => setDrawer(false)} onConfirmed={onConfirmed} />
            </aside>
          )}
        </div>
      </ErrorBoundary>
    </div>
  );
}

/** The fallback when the screen fails: the queue as a plain list, so the day's work can still be triaged by hand. */
function ManualTriage({ error, reset, rows }: { error: Error; reset: () => void; rows: ClaimRow[] }) {
  return (
    <div className="overflow-auto p-6 text-sm">
      <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-900">
        The screen hit an error: {error.message}. Manual triage below; nothing has been decided. <button onClick={reset} className="underline">Try again</button>
      </div>
      <table className="text-xs">
        <thead>
          <tr className="text-left text-slate-500"><th className="pr-4">Claim</th><th className="pr-4">Type</th><th className="pr-4">State</th><th className="pr-4">Amount</th><th className="pr-4">Queue age</th><th>Route (rules)</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.claimId} className="border-t border-slate-200"><td className="pr-4 font-mono">{r.claimId}</td><td className="pr-4">{r.header.claimType}</td><td className="pr-4">{r.header.state}</td><td className="pr-4">{r.header.amountUsd ?? "—"}</td><td className="pr-4">{Math.round(r.queueAgeHours)} h</td><td>{r.decision.routeLabel}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
