"use client";

// The shell: top bar, three columns (queue, packet, documents) with the
// audit record inline in the packet pane. State lives here: the open claim, packets
// re-run in this session, audit records confirmed in this session.

import { useEffect, useMemo, useRef, useState } from "react";

import type { AuditRecord } from "@/lib/audit/record.ts";
import { ROUTE_LABELS, type FinalRoute } from "@/lib/claim/schema.ts";
import type { PacketRecord } from "@/lib/agent/cache.ts";
import type { ClaimRow, WorkspaceData } from "@/lib/ui/workspace-data.ts";
import { ErrorBoundary } from "./ErrorBoundary";
import { PacketPanel } from "./PacketPanel";
import { Viewer, type Shown } from "./Viewer";
import { Worklist, inboxOrder, hasReply, type DemoState } from "./Worklist";
import { ADJUSTER, reviewerLabel } from "@/lib/ui/session.ts";

const NO_KEY = "No API key. Showing cached packets; re-run is disabled.";

export function Workspace({ data }: { data: WorkspaceData }) {
  const [selected, setSelected] = useState<string | null>(data.rows.find((r) => r.packet)?.claimId ?? data.rows[0]?.claimId ?? null);
  const [toast, setToast] = useState<{ text: string; claimId: string } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<ClaimRow>>>({});
  const [rerun, setRerun] = useState<{ running: boolean; error: string | null }>({ running: false, error: null });
  const [focus, setFocus] = useState<Shown | null>(null);
  const [role, setRole] = useState("adjuster");

  const allRows = useMemo(() => data.rows.map((r) => (overrides[r.claimId] ? { ...r, ...overrides[r.claimId] } : r)), [data.rows, overrides]);

  // Demo: the inbox starts empty and the morning's claims arrive one at a time, oldest first, each "assessed" from its cached packet.
  // Only claims with a packet take part: each one is "assessed" from its cached packet as it arrives.
  const arrivalOrder = useMemo(() => allRows.filter((r) => r.packet).sort((a, b) => b.queueAgeHours - a.queueAgeHours).map((r) => r.claimId), [allRows]);
  const [demo, setDemo] = useState<DemoState>({ active: false, playing: false, arrived: [], assessing: null, total: arrivalOrder.length });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advance = () => {
    setDemo((d) => {
      const next = arrivalOrder.find((id) => !d.arrived.includes(id) && id !== d.assessing);
      if (!next || d.assessing) return d;
      return { ...d, assessing: next };
    });
  };
  useEffect(() => {
    if (!demo.active || !demo.assessing) return;
    const id = demo.assessing;
    const t = setTimeout(() => {
      setDemo((d) => ({ ...d, assessing: null, arrived: [...d.arrived, id] }));
      setSelected(id);
    }, 1100);
    return () => clearTimeout(t);
  }, [demo.active, demo.assessing]);
  useEffect(() => {
    if (!demo.active || !demo.playing || demo.assessing) return;
    if (demo.arrived.length >= demo.total) {
      setDemo((d) => ({ ...d, playing: false }));
      return;
    }
    timer.current = setTimeout(advance, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [demo.active, demo.playing, demo.assessing, demo.arrived.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const onDemo = (action: "start" | "play" | "pause" | "step" | "reset") => {
    if (action === "start") { setDemo({ active: true, playing: true, arrived: [], assessing: null, total: arrivalOrder.length }); setSelected(null); }
    else if (action === "play") setDemo((d) => ({ ...d, playing: true }));
    else if (action === "pause") setDemo((d) => ({ ...d, playing: false }));
    else if (action === "step") advance();
    else { setDemo({ active: false, playing: false, arrived: [], assessing: null, total: arrivalOrder.length }); setSelected(allRows.find((r) => r.packet)?.claimId ?? null); }
  };
  const rows = useMemo(() => (demo.active ? allRows.filter((r) => demo.arrived.includes(r.claimId) || r.claimId === demo.assessing) : allRows), [allRows, demo.active, demo.arrived, demo.assessing]);
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
  const roleLabel = role === "senior" ? "Senior adjuster" : "Adjuster";
  // One click: the record is appended under the signed-in adjuster and the next claim in the inbox opens.
  const onConfirm = async (change?: { route: FinalRoute; reason: string }): Promise<string | null> => {
    if (!row) return "No claim open.";
    const current = row;
    const res = await fetch("/api/audit/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimId: current.claimId, reviewer: reviewerLabel(roleLabel), route: change?.route, reason: change?.reason }) });
    const j = (await res.json().catch(() => null)) as { ok: boolean; record?: AuditRecord; error?: string } | null;
    if (!j?.ok || !j.record) return j?.error ?? `Could not confirm (HTTP ${res.status}).`;
    const rec = j.record;
    setOverrides((o) => ({ ...o, [current.claimId]: { ...o[current.claimId], audit: [...current.audit, rec] } }));
    const next = inboxOrder(rows).find((r) => r.claimId !== current.claimId && r.packet);
    const label = ROUTE_LABELS[rec.reviewerRoute ?? rec.output.route];
    const finalRoute = rec.reviewerRoute ?? rec.output.route;
    setToast({
      text: finalRoute === "request_information"
        ? `${current.claimId.replace("IS-CLM-2025", "…")}: request sent via ClaimsPro; now waiting on the claimant. Record ${rec.id} appended.`
        : `${current.claimId.replace("IS-CLM-2025", "…")} ${change ? "changed to" : "confirmed as"} ${label.toLowerCase()}. Record ${rec.id} appended.`,
      claimId: current.claimId,
    });
    if (next) select(next.claimId);
    return null;
  };
  /** Demo: the claimant's reply arrives and the claim comes back to the inbox. In production this is the ClaimsPro document event. */
  const onReply = (text: string) => {
    if (!row) return;
    const current = row;
    setOverrides((o) => ({ ...o, [current.claimId]: { ...o[current.claimId], reply: { at: new Date().toISOString(), text } } }));
    setToast({ text: `${current.claimId.replace("IS-CLM-2025", "…")}: the claimant replied; the claim is back in the inbox under Verify documents.`, claimId: current.claimId });
  };
  const [running, setRunning] = useState<string | null>(null);
  const runOne = async (target: ClaimRow) => {
    let token = window.localStorage.getItem("agentRunToken");
    if (!token) {
      token = window.prompt("Re-runs spend API money, so the endpoint needs the run token (AGENT_RUN_TOKEN on the deployment).");
      if (!token) return;
      window.localStorage.setItem("agentRunToken", token);
    }
    setRerun({ running: true, error: null });
    setRunning(target.claimId);
    try {
      const res = await fetch(`/api/agent/run?claim=${encodeURIComponent(target.claimId)}`, { headers: { "x-agent-run-token": token } });
      const j = (await res.json()) as { ok: boolean; error?: string; failure?: string | null; packet?: PacketRecord["packet"]; decision?: PacketRecord["decision"]; usage?: PacketRecord["usage"]; audit?: AuditRecord | null };
      if (!res.ok) {
        if (res.status === 403) window.localStorage.removeItem("agentRunToken");
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      if (!j.ok || !j.packet || !j.decision || !j.usage) throw new Error(j.failure ?? "The run did not produce a packet. The cached packet is kept.");
      const packet: PacketRecord = { packet: j.packet, decision: j.decision, usage: j.usage, savedAt: new Date().toISOString() };
      setOverrides((o) => ({ ...o, [target.claimId]: { ...o[target.claimId], packet, decision: j.decision, audit: j.audit ? [...target.audit, j.audit] : target.audit } }));
      setRerun({ running: false, error: null });
    } catch (err) {
      setRerun({ running: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(null);
    }
  };
  const onRerun = () => row && runOne(row);
  const onRunUnprocessed = async (ids: string[]) => {
    for (const id of ids) {
      const target = rows.find((r) => r.claimId === id);
      if (target) await runOne(target);
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
          <div className="avatar">{ADJUSTER.initials}</div>
          <div>
            {ADJUSTER.name}
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{roleLabel} · {ADJUSTER.id} · mock sign-in</div>
          </div>
        </div>
      </header>
      {!data.apiKey && <div className="keybar">{NO_KEY}</div>}
      <ErrorBoundary fallback={(error, reset) => <ManualTriage error={error} reset={reset} rows={rows} />}>
        <div className="workspace">
          <section className="col worklist">
            <Worklist rows={rows} selected={selected} onSelect={select} onRunUnprocessed={onRunUnprocessed} running={running} apiKey={data.apiKey} demo={demo} onDemo={onDemo} />
          </section>
          <section className="col assess">
            {row ? (
              <PacketPanel key={row.claimId} row={row} decision={row.decision} apiKey={data.apiKey} model={data.model} rerun={rerun} onRerun={onRerun} onConfirm={onConfirm} onReply={onReply} replied={hasReply(row)} reviewer={`${ADJUSTER.name} (${ADJUSTER.id})`} onFocus={setFocus} />
            ) : (
              <div className="viewer-empty"><div><b>{demo.active ? "The morning is starting." : "No claims."}</b><div>{demo.active ? "Claims arrive on the left as they come in; each is assessed and sorted on arrival." : ""}</div></div></div>
            )}
          </section>
          <section className="col viewer">{row && <Viewer key={row.claimId} row={row} images={images} focus={focus} />}</section>
        </div>
      </ErrorBoundary>
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => { select(toast.claimId); setToast(null); }}>Open it</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}
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
