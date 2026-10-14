"use client";

// Right column: the claim's details and its documents. Photos and page images
// in a viewer with thumbnails; the re-read region drawn on the page when a
// field in the packet is selected.

import { useEffect, useState } from "react";

import type { ClaimRow } from "@/lib/ui/workspace-data.ts";
import { fileUrl, usd } from "./ui";

export interface Shown {
  path: string;
  label: string;
  region?: { x: number; y: number; w: number; h: number } | null;
  tag?: string;
}

export function Viewer({ row, images, focus }: { row: ClaimRow; images: Shown[]; focus: Shown | null }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [row.claimId]);
  useEffect(() => {
    if (!focus) return;
    const i = images.findIndex((s) => s.path === focus.path);
    if (i >= 0) setIdx(i);
  }, [focus, images]);
  const shown = focus && images[idx]?.path === focus.path ? focus : images[idx] ?? null;
  const h = row.header;
  const holder = row.names.find((n) => n.token === "[POLICYHOLDER]")?.name;
  const claimant = row.names.find((n) => n.token === "[CLAIMANT]")?.name;
  const p = row.packet?.packet;
  return (
    <>
      <div className="claim-head">
        <div className="claim-head-top">
          <h1>{row.claimId}</h1>
          <span className="chip" title={row.provenance.change ?? ""}>{row.provenance.label}</span>
          <span className="chip">{h.claimType}</span>
          <span className="chip">{h.channel}</span>
          {h.policyStatus === "lapsed" && <span className="chip chip-bad">Policy lapsed at loss</span>}
          {h.country === "CA" && <span className="chip chip-bad">Canadian policyholder</span>}
        </div>
        <dl className="claim-meta">
          <div><dt>Policyholder</dt><dd>{holder ?? "Not in the extract"}</dd></div>
          <div><dt>Policy</dt><dd>{h.policyNumber ?? "—"} · {h.policyStatus.replace("_", " ")}</dd></div>
          {claimant && <div><dt>Claimant</dt><dd>{claimant}</dd></div>}
          <div><dt>Vehicle</dt><dd>{h.vehicle ?? "—"}</dd></div>
          <div><dt>Loss</dt><dd>{h.dateOfLoss ?? "date not on file"} · {h.state}</dd></div>
          <div><dt>Filed</dt><dd>{h.filedDate} · {usd(h.amountUsd)}</dd></div>
          <div><dt>Complexity</dt><dd>{h.complexity ?? "—"} · adjuster {h.adjusterId ?? "—"}</dd></div>
          <div><dt>Today's flag</dt><dd>{row.todayFlagged === null ? "not in the extract" : row.todayFlagged ? "Human review" : "Standard"}</dd></div>
        </dl>
        {row.lossDescription && <div className="loss">{row.lossDescription}</div>}
      </div>
      <div className="stage">
        {images.length === 0 ? (
          <div className="viewer-empty">
            <div>
              <b>No photos or page images.</b>
              <div>{row.documentCount === 0 ? "This claim comes from the extract: a structured row, no documents." : "The claim folder has text documents only."}</div>
            </div>
          </div>
        ) : (
          <>
            <div className="photo-main">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(row.claimId, shown!.path)} alt={shown!.label} />
              {shown?.region && <div className="region" style={{ left: `${shown.region.x * 100}%`, top: `${shown.region.y * 100}%`, width: `${shown.region.w * 100}%`, height: `${shown.region.h * 100}%` }} />}
              <div className="photo-tags">{shown?.tag && <span className="chip chip-info">{shown.tag}</span>}</div>
              <div className="photo-name">{shown!.label}</div>
            </div>
            <div className="thumbs">
              {images.map((s, i) => (
                <button key={s.path} className={`thumb ${i === idx ? "active" : ""}`} onClick={() => setIdx(i)} title={s.label}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(row.claimId, s.path)} alt={s.label} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {row.documents.length > 0 && (
          <div className="card">
            <div className="card-head"><h3>Documents on file</h3><span className="sub">{row.documents.length} in the claim folder</span></div>
            <div className="card-body">
              <ul className="doclist">
                {row.documents.map((d) => (
                  <li key={d.name}>
                    <span>{d.name}</span>
                    <span style={{ color: "var(--text-3)" }}>{d.kind.replace("_", " ")}{d.engineConfidence !== null ? ` · engine confidence ${Math.round(d.engineConfidence * 100)}%` : ""}{d.pages ? ` · ${d.pages} page${d.pages === 1 ? "" : "s"}` : ""}</span>
                  </li>
                ))}
              </ul>
              {p && p.evidence.some((e) => !e.present) && <div className="note">Missing per the checklist: {p.evidence.filter((e) => !e.present).map((e) => e.label.toLowerCase()).join(", ")}.</div>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
