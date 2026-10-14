"use client";

// Small shared pieces: route chip, source tag, section, money and dates.

import type { FinalRoute, Source } from "@/lib/claim/schema.ts";
import { ROUTE_LABELS, SOURCE_LABELS, SOURCE_SYSTEMS } from "@/lib/claim/schema.ts";

export const ROUTE_STYLE: Record<FinalRoute, string> = {
  ready_to_decide: "bg-green-50 text-green-800 border-green-200",
  request_information: "bg-amber-50 text-amber-800 border-amber-200",
  verify_documents: "bg-amber-50 text-amber-800 border-amber-200",
  specialist_review: "bg-orange-50 text-orange-800 border-orange-200",
  full_review: "bg-red-50 text-red-800 border-red-200",
  out_of_scope: "bg-slate-100 text-slate-700 border-slate-300",
};

export function RouteChip({ route, small }: { route: FinalRoute; small?: boolean }) {
  return <span className={`inline-block rounded border px-2 ${small ? "py-0 text-[11px]" : "py-0.5 text-xs"} font-medium whitespace-nowrap ${ROUTE_STYLE[route]}`}>{ROUTE_LABELS[route]}</span>;
}

export function SourceTag({ source, document }: { source: Source | null; document?: string | null }) {
  if (!source) return null;
  return (
    <span className="inline-block rounded bg-slate-100 px-1.5 py-0 text-[11px] text-slate-600 cursor-help" title={`${SOURCE_SYSTEMS[source]}${document ? `\n${document}` : ""}`}>
      {SOURCE_LABELS[source]}
      {document ? ` · ${document}` : ""}
    </span>
  );
}

export function Section({ title, children, aside, id }: { title: string; children: React.ReactNode; aside?: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mb-5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const usd = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
export const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
export const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
export const when = (iso: string) => (iso ? iso.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC") : "—");
