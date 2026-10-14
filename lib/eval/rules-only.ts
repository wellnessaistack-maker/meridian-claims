// The rules-only evaluation: the routing protocol's structured rules scored
// against the 500 extract rows that carry a calibration label
// (review_actually_needed). No model, no API key. Runs in npm test and the
// numbers go in the README verbatim.
//
// "Flagged" means the rules route the claim anywhere but ready_to_decide, which
// is the nearest equivalent of today's flagged_for_human_review. Today's flag is
// scored the same way on the same rows for comparison.

import type { ExtractRow } from "../extract/csv.ts";
import { decide, type Decision } from "../rules/engine.ts";
import { DEFAULT_SETTINGS, type RuleInput, type Settings } from "../rules/protocol.ts";

export function ruleInputFromRow(row: ExtractRow): RuleInput {
  return {
    claimId: row.claimId,
    claimType: row.claimType,
    state: row.state,
    country: "US",
    amountUsd: row.claimAmountUsd,
    regulatoryReviewRequired: row.requiresHumanByRegulation,
    policyStatus: "unknown",
    packet: null,
  };
}

/** The structured rules only: what the protocol can say about a claim before any packet exists. */
export function routeRow(row: ExtractRow, settings: Settings = DEFAULT_SETTINGS): Decision {
  return decide(ruleInputFromRow(row), settings, { structuredOnly: true });
}

export interface FlagScore {
  /** Flagged among all 5,000 rows. */
  flagged: number;
  of: number;
  flagRate: number;
  /** Among the labelled rows. */
  labelled: number;
  needed: number;
  flaggedLabelled: number;
  /** Needed review but not flagged. */
  missed: number;
  missedPct: number;
  /** Flagged, did not need review, and not required by regulation. */
  unnecessary: number;
  /** Required by regulation (per the extract) but not flagged. */
  missedRegulatory: number;
  regulatoryLabelled: number;
}

function score(rows: ExtractRow[], flagged: (r: ExtractRow) => boolean): FlagScore {
  const labelled = rows.filter((r) => r.reviewActuallyNeeded !== null);
  const needed = labelled.filter((r) => r.reviewActuallyNeeded === true);
  const regulatoryLabelled = labelled.filter((r) => r.requiresHumanByRegulation);
  const flaggedAll = rows.filter(flagged).length;
  const missed = needed.filter((r) => !flagged(r)).length;
  return {
    flagged: flaggedAll,
    of: rows.length,
    flagRate: rows.length ? flaggedAll / rows.length : 0,
    labelled: labelled.length,
    needed: needed.length,
    flaggedLabelled: labelled.filter(flagged).length,
    missed,
    missedPct: needed.length ? missed / needed.length : 0,
    unnecessary: labelled.filter((r) => flagged(r) && r.reviewActuallyNeeded === false && !r.requiresHumanByRegulation).length,
    missedRegulatory: regulatoryLabelled.filter((r) => !flagged(r)).length,
    regulatoryLabelled: regulatoryLabelled.length,
  };
}

export interface RulesOnlyReport {
  protocolVersion: string;
  settings: Settings;
  rules: FlagScore;
  today: FlagScore;
  /** The regulatory floor alone (R1, R2, R3), with no operating rules. */
  regulatoryOnly: FlagScore;
  /** How the rules' flag rate and misses move with the simple-claim ceiling. */
  ceilingSweep: { ceilingUsd: number; flagRate: number; missed: number; unnecessary: number }[];
  bySegment: Record<string, number>;
}

export function scoreRulesOnly(rows: ExtractRow[], settings: Settings = DEFAULT_SETTINGS): RulesOnlyReport {
  const cache = new Map<string, Decision>();
  const dec = (r: ExtractRow, s: Settings) => {
    const k = `${r.claimId}|${s.simpleClaimCeilingUsd}`;
    let d = cache.get(k);
    if (!d) {
      d = routeRow(r, s);
      cache.set(k, d);
    }
    return d;
  };
  const rulesFlag = (r: ExtractRow) => dec(r, settings).route !== "ready_to_decide";
  const todayFlag = (r: ExtractRow) => r.flaggedForHumanReview;
  const regFlag = (r: ExtractRow) => dec(r, settings).regulatory;
  const bySegment: Record<string, number> = {};
  for (const r of rows) {
    const s = dec(r, settings).segment;
    bySegment[s] = (bySegment[s] ?? 0) + 1;
  }
  const sweep = [2500, 5000, 7500, 10000].map((ceilingUsd) => {
    const s = { ...settings, simpleClaimCeilingUsd: ceilingUsd };
    const f = score(rows, (r) => dec(r, s).route !== "ready_to_decide");
    return { ceilingUsd, flagRate: f.flagRate, missed: f.missed, unnecessary: f.unnecessary };
  });
  return {
    protocolVersion: dec(rows[0], settings).protocolVersion,
    settings,
    rules: score(rows, rulesFlag),
    today: score(rows, todayFlag),
    regulatoryOnly: score(rows, regFlag),
    ceilingSweep: sweep,
    bySegment,
  };
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;
