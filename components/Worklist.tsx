"use client";

// The adjuster's worklist, after the earlier prototype's inbox: a header with
// progress toward an empty inbox, three tabs (Inbox, Waiting, Done), and
// inside the inbox the segments in work order, oldest first. One line per
// claim: what it is, how long it has waited, and the one reason it is where
// it is. The 24-hour mark is the SOW's target for simple claims.

import { useEffect, useState } from "react";

import type { ClaimRow } from "@/lib/ui/workspace-data.ts";
import { ROUTE_LABELS } from "@/lib/claim/schema.ts";
import { SEGMENT_LABELS, type Segment } from "@/lib/rules/engine.ts";
import { RoutePill, hours, usd } from "./ui";

export const SLA_HOURS = 24;
type Tab = "inbox" | "waiting" | "done";
/** Inbox groups in work order. "verify" is the verify-documents route: adjuster work, not waiting on anyone. */
type Group = Segment | "verify";
// Easiest first, as the earlier prototype ordered its inbox: clear the quick ones, then the ones that need more.
const INBOX_ORDER: Group[] = ["ready", "verify", "senior", "regulatory"];
const GROUP_LABELS: Record<Group, string> = { ...SEGMENT_LABELS, verify: "Verify documents" };
const groupOf = (r: ClaimRow): Group => (r.decision.segment === "waiting" ? (r.decision.route === "verify_documents" ? "verify" : "waiting") : r.decision.segment);

const PROVENANCE_SHORT: Record<string, string> = { provided: "Meridian sample", variant: "Variant", mock: "Mock", extract: "Extract row" };

export const isDone = (r: ClaimRow) => r.audit.some((a) => a.humanReviewed);
export const tabOf = (r: ClaimRow): Tab => (isDone(r) ? "done" : groupOf(r) === "waiting" ? "waiting" : "inbox");

export function reasonLine(r: ClaimRow): string {
  const p = r.packet?.packet;
  const top = r.decision.reasons[0];
  if (p && p.status === "not_assembled") return `Not assembled: ${p.notAssembledReason}`;
  if (top) return `${top.title}. ${top.reason}`;
  if (p) return p.missing.length ? `Missing: ${p.missing.map((m) => m.label.toLowerCase()).join(", ")}` : "Complete and consistent; no rule fired.";
  return r.documentCount === 0 ? "Extract row: structured rules only, no documents." : "Not run yet: structured rules only.";
}

export interface DemoState {
  active: boolean;
  playing: boolean;
  /** Claims that have arrived so far, in arrival order. */
  arrived: string[];
  /** The claim being assessed right now, shown with a spinner. */
  assessing: string | null;
  total: number;
}

export function Worklist({ rows, selected, onSelect, onRunUnprocessed, running, apiKey, demo, onDemo }: { rows: ClaimRow[]; selected: string | null; onSelect: (id: string) => void; onRunUnprocessed: (ids: string[]) => void; running: string | null; apiKey: boolean; demo: DemoState; onDemo: (action: "start" | "play" | "pause" | "step" | "reset") => void }) {
  const [tab, setTab] = useState<Tab>("inbox");
  const inbox = rows.filter((r) => tabOf(r) === "inbox");
  const waiting = rows.filter((r) => tabOf(r) === "waiting").sort((a, b) => b.queueAgeHours - a.queueAgeHours);
  const done = rows.filter((r) => tabOf(r) === "done");
  const unprocessed = rows.filter((r) => !r.packet && r.documentCount > 0 && r.header.country !== "CA");
  const late = inbox.filter((r) => r.header.complexity === "Simple" && r.queueAgeHours > SLA_HOURS).length;
  const pct = rows.length ? Math.round((done.length / rows.length) * 100) : 0;

  // Follow the selected claim to its tab, for example after it is confirmed.
  const sel = rows.find((r) => r.claimId === selected);
  useEffect(() => {
    if (sel) setTab(tabOf(sel));
  }, [selected, sel?.audit.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const openTab = (t: Tab) => {
    if (t === tab) return;
    setTab(t);
    const first = t === "inbox" ? INBOX_ORDER.flatMap((s) => bySegment(inbox, s))[0] : t === "waiting" ? waiting[0] : done[0];
    if (first) onSelect(first.claimId);
  };

  const item = (r: ClaimRow) => {
    const isLate = r.header.complexity === "Simple" && r.queueAgeHours > SLA_HOURS && !isDone(r);
    const reviewed = r.audit.filter((a) => a.humanReviewed).pop();
    return (
      <button key={r.claimId} className={`wl-item ${r.claimId === selected ? "active" : ""}`} onClick={() => onSelect(r.claimId)}>
        <div className="wl-item-top">
          <span>{r.claimId.replace("IS-CLM-2025", "…")}</span>
          <span className={`age ${isLate ? "late" : ""}`} title={isLate ? `Simple claim over the ${SLA_HOURS} h target` : "Time in queue"}>
            {reviewed ? "confirmed" : `${hours(r.queueAgeHours)}${isLate ? " · late" : ""}`}
          </span>
        </div>
        <div className="wl-item-sub">
          {r.header.claimType} · {r.header.state} · {usd(r.header.amountUsd)} · {PROVENANCE_SHORT[r.provenance.kind]}
        </div>
        <div className="wl-item-reason">
          {(running === r.claimId || demo.assessing === r.claimId) && <span className="spinner" style={{ marginRight: 6, verticalAlign: -2 }} />}
          {demo.assessing === r.claimId && "Assessing: reading the three systems and the documents… "}
          {reviewed && reviewed.reviewerRoute && reviewed.reviewerRoute !== reviewed.output.route ? (
            <>
              <span className="chip chip-warn" style={{ marginRight: 6 }}>Route changed</span>
              {reviewed.reviewerReason}
            </>
          ) : (
            reasonLine(r)
          )}
        </div>
        <div className="wl-item-chips">
          <RoutePill route={reviewed?.reviewerRoute ?? r.decision.route} small />
          {!r.packet && r.documentCount > 0 && r.header.country !== "CA" && <span className="chip">Not run</span>}
        </div>
      </button>
    );
  };

  return (
    <>
      <div className="wl-head">
        <div className="wl-title">
          <h2>My worklist</h2>
          <span className="wl-count">{inbox.length + waiting.length} to review · {done.length} done</span>
        </div>
        <div className="progress" aria-label="Progress to an empty worklist"><div style={{ width: `${pct}%` }} /></div>
        <div className="wl-goal">
          {rows.length === 0 ? "Nothing in the queue." : inbox.length === 0 ? "Inbox clear." : `Goal: clear the inbox by end of day. ${late} simple claim${late === 1 ? "" : "s"} past the ${SLA_HOURS} h target.`}
        </div>
        <div className="wl-tabs" role="tablist">
          {([["inbox", "Inbox", inbox.length], ["waiting", "Waiting", waiting.length], ["done", "Done", done.length]] as const).map(([key, label, n]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => openTab(key)} title={key === "waiting" ? "Waiting on information from the claimant or a provider" : undefined}>
              {label} <span className="n">{n}</span>
            </button>
          ))}
        </div>
        <div className="wl-actions">
          {!demo.active ? (
            <button className="btn btn-primary" onClick={() => onDemo("start")} title="Empty the inbox and let the morning's claims arrive one at a time, from the cached packets">
              ▶ Play the morning
            </button>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => onDemo(demo.playing ? "pause" : "play")} disabled={demo.arrived.length >= demo.total && !demo.assessing}>
                {demo.playing ? "Pause" : demo.arrived.length ? "Resume" : "Play"}
              </button>
              <button className="btn" onClick={() => onDemo("step")} disabled={demo.playing || demo.assessing !== null || demo.arrived.length >= demo.total}>Next claim</button>
              <button className="btn btn-ghost" onClick={() => onDemo("reset")} title="Show the whole queue again">Show all</button>
            </>
          )}
        </div>
        {demo.active && <div className="wl-hint">{demo.arrived.length} of {demo.total} arrived. Each claim is assessed from its cached packet; with a key, the same button runs the live agent.</div>}
        {unprocessed.length > 0 && !demo.active && (
          <div className="wl-actions">
            <button className="btn" disabled={!apiKey || running !== null} onClick={() => onRunUnprocessed(unprocessed.map((r) => r.claimId))} title={!apiKey ? "No API key. Runs are disabled." : "Run the agent on every claim with documents that has no packet yet, one at a time"}>
              {running ? "Running…" : `Run the ${unprocessed.length} not yet run`}
            </button>
          </div>
        )}
      </div>
      <div className="wl-body">
        {tab === "inbox" &&
          (inbox.length === 0 ? (
            <div className="wl-empty">Inbox clear. Confirmed claims are under Done.</div>
          ) : (
            INBOX_ORDER.map((seg) => {
              const list = bySegment(inbox, seg);
              if (!list.length) return null;
              return (
                <div key={seg} className={`route-${list[0].decision.route}`}>
                  <div className="wl-group-head">
                    <span className="dot" /> {GROUP_LABELS[seg]} <span className="n">{list.length}</span>
                  </div>
                  {list.map(item)}
                </div>
              );
            })
          ))}
        {tab === "waiting" &&
          (waiting.length ? (
            <>
              <div className="wl-hint">Information requested from the claimant or a provider. When it arrives the claim is re-run and comes back to the inbox.</div>
              {waiting.map(item)}
            </>
          ) : (
            <div className="wl-empty">Nothing waiting on information.</div>
          ))}
        {tab === "done" && done.length > 0 && <AgreementSummary rows={done} />}
        {tab === "done" && (done.length ? done.map(item) : <div className="wl-empty">Nothing confirmed yet. A claim lands here once a person confirms its route or changes it with a reason.</div>)}
      </div>
    </>
  );
}

/** The inbox in the order it is shown: easiest group first, oldest first within a group. */
export function inboxOrder(rows: ClaimRow[]): ClaimRow[] {
  const inbox = rows.filter((r) => tabOf(r) === "inbox");
  return INBOX_ORDER.flatMap((s) => bySegment(inbox, s));
}

function bySegment(rows: ClaimRow[], seg: Group) {
  return rows.filter((r) => groupOf(r) === seg).sort((a, b) => b.queueAgeHours - a.queueAgeHours);
}

/** How often the person kept the recommendation, across the confirmed claims. Every change is a test case. */
function AgreementSummary({ rows }: { rows: ClaimRow[] }) {
  const last = rows.map((r) => r.audit.filter((a) => a.humanReviewed).pop()!);
  const kept = last.filter((a) => !a.reviewerRoute || a.reviewerRoute === a.output.route).length;
  const changed = last.length - kept;
  const download = () => {
    const header = "claim_id,recommended_route,reviewer_route,reviewer,reason,reviewed_at";
    const lines = last.map((a) => [a.claimId, a.output.route, a.reviewerRoute ?? a.output.route, a.reviewer ?? "", JSON.stringify(a.reviewerReason ?? ""), a.reviewedAt ?? ""].join(","));
    const blob = new Blob([[header, ...lines].join("\n") + "\n"], { type: "text/csv" });
    const el = document.createElement("a");
    el.href = URL.createObjectURL(blob);
    el.download = "review-log.csv";
    el.click();
  };
  return (
    <div className="wl-agree">
      <div className="wl-agree-top">
        <b>Kept the recommendation on {kept} of {last.length}</b>
        <span className="hint">{Math.round((kept / last.length) * 100)}%</span>
      </div>
      <div className="wl-agree-bar" aria-hidden><span className="k" style={{ flex: kept }} /><span className="c" style={{ flex: changed }} /></div>
      <div className="hint">{changed} route{changed === 1 ? "" : "s"} changed, each with a reason. A change is the start of a test case: {changed ? last.filter((a) => a.reviewerRoute && a.reviewerRoute !== a.output.route).map((a) => `${a.claimId.replace("IS-CLM-2025", "…")} → ${ROUTE_LABELS[a.reviewerRoute!].toLowerCase()}`).join("; ") : "none yet"}.</div>
      <button className="btn btn-sm" onClick={download}>Download review log (CSV)</button>
    </div>
  );
}
