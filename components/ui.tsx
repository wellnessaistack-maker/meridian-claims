"use client";

// Small shared pieces: route pill, source tag, money and dates.

import type { FinalRoute, Source } from "@/lib/claim/schema.ts";
import { ROUTE_LABELS, SOURCE_LABELS, SOURCE_SYSTEMS } from "@/lib/claim/schema.ts";

export function RoutePill({ route, small }: { route: FinalRoute; small?: boolean }) {
  return (
    <span className={`route-${route}`}>
      <span className={`route-pill ${small ? "sm" : ""}`}>
        <span className="dot" />
        {ROUTE_LABELS[route]}
      </span>
    </span>
  );
}

export function SourceTag({ source, document, page }: { source: Source | null; document?: string | null; page?: number | null }) {
  if (!source) return null;
  return (
    <span className={`src src-${source}`} title={`${SOURCE_SYSTEMS[source]}${document ? `\n${document}` : ""}${page ? `, page ${page}` : ""}`}>
      {SOURCE_LABELS[source]}
      {document ? ` · ${document}` : ""}
      {page ? ` p.${page}` : ""}
    </span>
  );
}

export const usd = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
export const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
export const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
export const when = (iso: string) => (iso ? iso.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC") : "—");
export const fileUrl = (claimId: string, p: string) => `/api/claims/${encodeURIComponent(claimId)}/file?path=${encodeURIComponent(p)}`;
