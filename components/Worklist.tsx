"use client";

// The morning queue, in four segments, oldest first. One line per claim:
// what it is, how long it has waited, where the rules put it, and whether a
// packet exists. The SLA mark is the SOW's 24 hours for simple claims.

import type { ClaimRow } from "@/lib/ui/workspace-data.ts";
import { SEGMENT_LABELS, SEGMENT_ORDER, type Segment } from "@/lib/rules/engine.ts";
import { RouteChip, hours, usd } from "./ui";

export const SLA_HOURS = 24;

export function Worklist({ rows, selected, onSelect }: { rows: ClaimRow[]; selected: string | null; onSelect: (id: string) => void }) {
  const bySegment = new Map<Segment, ClaimRow[]>(SEGMENT_ORDER.map((s) => [s, []]));
  for (const r of rows) bySegment.get(r.decision.segment)!.push(r);
  for (const list of bySegment.values()) list.sort((a, b) => b.queueAgeHours - a.queueAgeHours);
  return (
    <div className="h-full overflow-y-auto">
      {SEGMENT_ORDER.map((seg) => {
        const list = bySegment.get(seg)!;
        return (
          <div key={seg}>
            <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{SEGMENT_LABELS[seg]}</span>
              <span className="text-[11px] text-slate-500">{list.length}</span>
            </div>
            {list.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">None</div>}
            {list.map((r) => {
              const late = r.header.complexity === "Simple" && r.queueAgeHours > SLA_HOURS;
              const active = r.claimId === selected;
              return (
                <button key={r.claimId} onClick={() => onSelect(r.claimId)} className={`block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-blue-50/60 ${active ? "bg-blue-50 border-l-2 border-l-blue-600" : "border-l-2 border-l-transparent"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium">{r.claimId.replace("IS-CLM-2025", "…")}</span>
                    <span className={`text-[11px] ${late ? "font-semibold text-red-700" : "text-slate-500"}`} title={late ? `Simple claim over the ${SLA_HOURS} h target` : "Time in queue"}>
                      {hours(r.queueAgeHours)}
                      {late ? " · late" : ""}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-600">
                    <span className="truncate">
                      {r.header.claimType} · {r.header.state} · {usd(r.header.amountUsd)}
                    </span>
                    <RouteChip route={r.decision.route} small />
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="truncate">{r.provenance.label}</span>
                    {r.packet ? <span className="rounded bg-blue-50 px-1 text-blue-700">packet</span> : r.documentCount > 0 ? <span className="rounded bg-slate-100 px-1">not run</span> : null}
                    {r.audit.some((a) => a.humanReviewed) && <span className="rounded bg-green-50 px-1 text-green-700">confirmed</span>}
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
