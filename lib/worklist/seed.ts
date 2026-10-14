// Seeds the morning queue from the extract: about 30 claims across channels,
// states, complexity and flag status, as lightweight records with no documents.
// Deterministic: the same rows every time.

import { loadExtract, type ExtractRow } from "../extract/csv.ts";
import { decide } from "../rules/engine.ts";
import { ruleInputFromRow } from "../eval/rules-only.ts";
import { DEFAULT_SETTINGS, type Settings } from "../rules/protocol.ts";
import type { FinalRoute, Provenance } from "../claim/schema.ts";
import { PROVENANCE_LABELS } from "../claim/catalog.ts";

export interface WorklistEntry {
  claimId: string;
  provenance: Provenance;
  claimType: ExtractRow["claimType"];
  state: string;
  channel: ExtractRow["intakeChannel"];
  filedDate: string;
  amountUsd: number;
  complexity: ExtractRow["complexity"] | null;
  /** Hours in queue so far (the extract's queue_wait_hours for a pending claim). */
  queueAgeHours: number;
  todayFlagged: boolean;
  regulatoryReviewRequired: boolean | null;
  documentCount: number;
  packet: "none";
  notAssembledReason: string;
  route: FinalRoute;
  segment: string;
  regulatory: boolean;
  reasons: { id: string; title: string; reason: string }[];
}

export const SEED_SIZE = 30;

/**
 * Picks the rows: spread across channel, complexity and today's flag status
 * (18 cells), round-robin, in claim-ID order within each cell. The extract's
 * closed claims stand in for a morning's arrivals; their queue_wait_hours is
 * the age shown.
 */
export function pickSeedRows(rows: ExtractRow[], size = SEED_SIZE): ExtractRow[] {
  const sorted = [...rows].sort((a, b) => a.claimId.localeCompare(b.claimId));
  const cells = new Map<string, ExtractRow[]>();
  for (const r of sorted) {
    const k = `${r.intakeChannel}|${r.complexity}|${r.flaggedForHumanReview ? "flagged" : "clear"}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(r);
  }
  // Round-robin over the cells in a fixed order so every channel and complexity shows up.
  const keys = [...cells.keys()].sort();
  const picked: ExtractRow[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (picked.length < size && i < 1000) {
    const k = keys[i % keys.length];
    const bucket = cells.get(k)!;
    const next = bucket.find((r) => !seen.has(r.claimId));
    if (next) {
      picked.push(next);
      seen.add(next.claimId);
    }
    i += 1;
    if (keys.every((kk) => cells.get(kk)!.every((r) => seen.has(r.claimId)))) break;
  }
  return picked;
}

export function seedWorklist(rows: ExtractRow[] = loadExtract(), settings: Settings = DEFAULT_SETTINGS, size = SEED_SIZE): WorklistEntry[] {
  return pickSeedRows(rows, size).map((r) => {
    const d = decide(ruleInputFromRow(r), settings);
    return {
      claimId: r.claimId,
      provenance: { kind: "extract", label: PROVENANCE_LABELS.extract, parentId: null, change: null },
      claimType: r.claimType,
      state: r.state,
      channel: r.intakeChannel,
      filedDate: r.filedDate,
      amountUsd: r.claimAmountUsd,
      complexity: r.complexity,
      queueAgeHours: r.queueWaitHours,
      todayFlagged: r.flaggedForHumanReview,
      regulatoryReviewRequired: r.requiresHumanByRegulation,
      documentCount: r.documentCount,
      packet: "none",
      notAssembledReason: "No documents in the extract; only the structured row. The structured rules ran; the packet rules could not.",
      route: d.route,
      segment: d.segment,
      regulatory: d.regulatory,
      reasons: d.reasons.map((x) => ({ id: x.id, title: x.title, reason: x.reason ?? "" })),
    };
  });
}
