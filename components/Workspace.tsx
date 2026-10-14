"use client";

// The shell: top bar, three columns (queue, packet, documents), the audit
// drawer as an overlay. State lives here: the open claim, the drawer, packets
// re-run in this session, audit records confirmed in this session.

import { useMemo, useState } from "react";

import type { AuditRecord } from "@/lib/audit/record.ts";
import type { PacketRecord } from "@/lib/agent/cache.ts";
import type { ClaimRow, WorkspaceData } from "@/lib/ui/workspace-data.ts";
import { AuditDrawer, type DrawerMode } from "./AuditDrawer";
import { ErrorBoundary } from "./ErrorBoundary";
import { PacketPanel } from "./PacketPanel";
import { Viewer, type Shown } from "./Viewer";
import { Worklist } from "./Worklist";

const NO_KEY = "No API key. Showing cached packets; re-run is disabled.";

export function Workspace({ data }: { data: WorkspaceData }) {
  const [selected, setSelected] = useState<string | null>(data.rows.find((r) => r.packet)?.claimId ?? data.rows[0]?.claimId ?? null);
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<ClaimRow>>>({});
  const [rerun, setRerun] = useState<{ running: boolean; error: string | null }>({ running: false, error: null });
  const [focus, setFocus] = useState<Shown | null>(null);
  const [role, setRole] = useState("adjuster");

  const rows = useMemo(() => data.rows.map((r) => (overrides[r.claimId] ? { ...r, ...overrides[r.claimId] } : r)), [data.rows, overrides]);
  const row = rows.find((r) => r.claimId === selected) ?? null;
  const images: Shown[] = useMemo(() => {
    if (!row) return [];
    return [...row.photos.map((p) => ({ path: p, label: p.split("/").pop()! })), ...row.pages.map((pg) => ({ path: pg.image, label: `${pg.document} p.${pg.page}` }))];
  }, [row]);

  const select = (id: string) => {
    setSelected(id);
    setFocus(null);
    setRerun({ running: false, error: null });
  };
  const onConfirmed = (rec: AuditRecord) => {
    if (!row) return;
    setOverrides((o) => ({ ...o, [row.claimId]: { ...o[row.claimId], audit: [...row.audit, rec] } }));
    setDrawer("view");
  };
  const onRerun = async () => {
    if (!row) return;
    let token = window.localStorage.getItem("agentRunToken");
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
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">M</div>
          Meridian claim readiness <small>Commercial auto</small>
        </div>
        <span className="env-chip">Prototype · protocol {data.protocolVersion} · {data.model}</span>
        {!data.apiKey && <span className="chip chip-bad">No API key</span>}
        <div className="topbar-spacer" />
        <nav className="topbar-nav">
          <a href="/rules">Routing protocol</a>
          <a href="/evaluation">Evaluation</a>
          <a href="/api/health">Health</a>
        </nav>
        <select className="role-select" value={role} onChange={(e) => setRole(e.target.value)} title="Mock role, no real login">
          <option value="adjuster">Role: Adjuster</option>
          <option value="senior">Role: Senior adjuster</option>
        </select>
        <div className="user">
          <div className="avatar">AD</div>
          <div>
            ADJ-110
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{role === "senior" ? "Senior adjuster" : "Adjuster"} · queue ADJ-110</div>
          </div>
        </div>
      </header>
      {!data.apiKey && <div className="keybar">{NO_KEY}</div>}
      <ErrorBoundary fallback={(error, reset) => <ManualTriage error={error} reset={reset} rows={rows} />}>
        <div className="workspace">
          <section className="col worklist">
            <Worklist rows={rows} selected={selected} onSelect={select} />
          </section>
          <section className="col assess">
            {row ? (
              <PacketPanel key={row.claimId} row={row} decision={row.decision} apiKey={data.apiKey} model={data.model} rerun={rerun} onRerun={onRerun} onOpenAudit={(m) => setDrawer(m)} onFocus={setFocus} />
            ) : (
              <div className="viewer-empty">No claims.</div>
            )}
          </section>
          <section className="col viewer">{row && <Viewer key={row.claimId} row={row} images={images} focus={focus} />}</section>
        </div>
      </ErrorBoundary>
      {drawer && row && <AuditDrawer key={`${row.claimId}-${row.audit.length}-${drawer}`} row={row} mode={drawer} onClose={() => setDrawer(null)} onConfirmed={onConfirmed} />}
    </div>
  );
}

/** The fallback when the screen fails: the queue as a plain list, so the day's work can still be triaged by hand. */
function ManualTriage({ error, reset, rows }: { error: Error; reset: () => void; rows: ClaimRow[] }) {
  return (
    <div className="page">
      <div className="err">
        The screen hit an error: {error.message}. Manual triage below; nothing has been decided. <button className="btn btn-sm" onClick={reset}>Try again</button>
      </div>
      <table className="t">
        <thead><tr><th>Claim</th><th>Type</th><th>State</th><th>Amount</th><th>Queue age</th><th>Route (rules)</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.claimId}><td className="mono">{r.claimId}</td><td>{r.header.claimType}</td><td>{r.header.state}</td><td>{r.header.amountUsd ?? "—"}</td><td>{Math.round(r.queueAgeHours)} h</td><td>{r.decision.routeLabel}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
