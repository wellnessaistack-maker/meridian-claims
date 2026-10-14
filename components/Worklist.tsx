"use client";

// The morning queue, in four segments, oldest first. One line per claim:
// what it is, how long it has waited, where the rules put it and why, and
// whether a packet exists. The SLA mark is the SOW's 24 hours for simple claims.

import type { ClaimRow } from "@/lib/ui/workspace-data.ts";
import { SEGMENT_LABELS, SEGMENT_ORDER, type Segment } from "@/lib/rules/engine.ts";
import { RoutePill, hours, usd } from "./ui";

export const SLA_HOURS = 24;

const PROVENANCE_SHORT: Record<string, string> = { provided: "Meridian sample", variant: "Variant", mock: "Mock", extract: "Extract row" };

export function reasonLine(r: ClaimRow): string {
  const p = r.packet?.packet;
  const top = r.decision.reasons[0];
  if (p && p.status === "not_assembled") return `Not assembled: ${p.notAssembledReason}`;
  if (top) return `${top.title}. ${top.reason}`;
  if (p) return p.missing.length ? `Missing: ${p.missing.map((m) => m.label.toLowerCase()).join(", ")}` : "Complete and consistent; no rule fired.";
  return r.documentCount === 0 ? "Extract row: structured rules only, no documents." : "Not run yet: structured rules only.";
}

export function Worklist({ rows, selected, onSelect }: { rows: ClaimRow[]; selected: string | null; onSelect: (id: string) => void }) {
  const bySegment = new Map<Segment, ClaimRow[]>(SEGMENT_ORDER.map((s) => [s, []]));
  for (const r of rows) bySegment.get(r.decision.segment)!.push(r);
  for (const list of bySegment.values()) list.sort((a, b) => b.queueAgeHours - a.queueAgeHours);
  const confirmed = rows.filter((r) => r.audit.some((a) => a.humanReviewed)).length;
  const withPackets = rows.filter((r) => r.packet).length;
  const late = rows.filter((r) => r.header.complexity === "Simple" && r.queueAgeHours > SLA_HOURS).length;
  return (
    <>
      <div className="wl-head">
        <div className="wl-title">
          <h2>Morning queue</h2>
          <span className="wl-count">{rows.length} claims · {withPackets} with packets</span>
        </div>
        <div className="progress"><div style={{ width: `${rows.length ? (confirmed / rows.length) * 100 : 0}%` }} /></div>
        <div className="wl-goal">
          {confirmed} confirmed by a person · {late} simple claim{late === 1 ? "" : "s"} past the {SLA_HOURS} h target
        </div>
      </div>
      <div className="wl-body">
        {SEGMENT_ORDER.map((seg) => {
          const list = bySegment.get(seg)!;
          return (
            <div key={seg}>
              <div className="wl-group-head">
                <span className={`route-${list[0]?.decision.route ?? "ready_to_decide"}`}><span className="dot" /></span>
                {SEGMENT_LABELS[seg]}
                <span className="n">{list.length}</span>
              </div>
              {list.length === 0 && <div className="wl-empty">None</div>}
              {list.map((r) => {
                const isLate = r.header.complexity === "Simple" && r.queueAgeHours > SLA_HOURS;
                return (
                  <button key={r.claimId} className={`wl-item ${r.claimId === selected ? "active" : ""}`} onClick={() => onSelect(r.claimId)}>
                    <div className="wl-item-top">
                      <span>{r.claimId.replace("IS-CLM-2025", "…")}</span>
                      <span className={`age ${isLate ? "late" : ""}`} title={isLate ? `Simple claim over the ${SLA_HOURS} h target` : "Time in queue"}>
                        {hours(r.queueAgeHours)}
                        {isLate ? " · late" : ""}
                      </span>
                    </div>
                    <div className="wl-item-sub">
                      {r.header.claimType} · {r.header.state} · {usd(r.header.amountUsd)} · {PROVENANCE_SHORT[r.provenance.kind]}
                    </div>
                    <div className="wl-item-reason">{reasonLine(r)}</div>
                    <div className="wl-item-chips">
                      <RoutePill route={r.decision.route} small />
                      {r.audit.some((a) => a.humanReviewed) && <span className="chip chip-ok">Confirmed</span>}
                      {!r.packet && r.documentCount > 0 && <span className="chip">Not run</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
