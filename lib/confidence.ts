// The three measured confidence numbers. None is a model's opinion of itself.
//   per-field extraction confidence: the OCR engine's number, raised by agreement
//                                    with the vision re-read and the arithmetic check
//   evidence completeness:           the fraction of the checklist on file
//   route confidence:                the historical agreement rate for the segment,
//                                    from the evaluation results file; "not yet measured" otherwise

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ClaimPacket } from "./claim/schema.ts";
import type { Segment } from "./rules/engine.ts";

export interface FieldConfidenceSummary {
  /** Mean over fields that have a measured confidence. Null when none do. */
  mean: number | null;
  measured: number;
  weakest: { key: string; label: string; confidence: number } | null;
  rereads: number;
  rereadsAgreed: number;
}

export function fieldConfidence(p: ClaimPacket): FieldConfidenceSummary {
  const measured = p.fields.filter((f) => f.confidence !== null);
  const rereads = p.fields.filter((f) => f.reread);
  const weakest = measured.reduce<FieldConfidenceSummary["weakest"]>((w, f) => (w === null || f.confidence! < w.confidence ? { key: f.key, label: f.label, confidence: f.confidence! } : w), null);
  return {
    mean: measured.length ? Math.round((measured.reduce((a, f) => a + f.confidence!, 0) / measured.length) * 100) / 100 : null,
    measured: measured.length,
    weakest,
    rereads: rereads.length,
    rereadsAgreed: rereads.filter((f) => f.reread!.agreed === true).length,
  };
}

export interface RouteConfidence {
  /** Agreement rate with the labelled route for this segment, 0 to 1, or null when not measured. */
  value: number | null;
  n: number;
  basis: string;
}

interface ResultsFile {
  bySegment?: Record<string, { agreed: number; of: number }>;
}

/** Reads eval/results/latest.json if the packet evaluation has run. */
export function routeConfidence(segment: Segment, root = process.cwd()): RouteConfidence {
  const p = path.join(root, "eval", "results", "latest.json");
  if (!existsSync(p)) return { value: null, n: 0, basis: "Not yet measured: the packet evaluation has not run." };
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as ResultsFile;
    const s = j.bySegment?.[segment];
    if (!s || !s.of) return { value: null, n: 0, basis: `Not yet measured: no evaluated claims in the "${segment}" segment.` };
    return { value: Math.round((s.agreed / s.of) * 100) / 100, n: s.of, basis: `${s.agreed} of ${s.of} evaluated claims in this segment got the labelled route (draft labels).` };
  } catch {
    return { value: null, n: 0, basis: "Not yet measured: the results file could not be read." };
  }
}
