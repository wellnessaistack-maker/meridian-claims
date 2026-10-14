// The Snowflake extract: reference/claims_processing.csv, 5,000 rows, masked.
// Parsed once into typed rows. Variant and mock claim folders carry a one-row
// extract.csv in the same format so the Snowflake loader needs no special case.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ClaimType = "Collision" | "Comprehensive" | "Bodily Injury" | "Property Damage" | "Liability";
export type Channel = "E-Portal" | "Phone" | "Fax/EDI";
export type Complexity = "Simple" | "Moderate" | "Complex";

export const CLAIM_TYPES: ClaimType[] = ["Collision", "Comprehensive", "Bodily Injury", "Property Damage", "Liability"];
export const CHANNELS: Channel[] = ["E-Portal", "Phone", "Fax/EDI"];

export interface ExtractRow {
  claimId: string;
  filedDate: string;
  claimType: ClaimType;
  state: string;
  intakeChannel: Channel;
  costPerClaimUsd: number;
  claimAmountUsd: number;
  complexity: Complexity;
  automationEligibilityScore: number;
  flaggedForHumanReview: boolean;
  /** The extract's own regulatory flag. For consent states this is the only record of consent. */
  requiresHumanByRegulation: boolean;
  queueWaitHours: number;
  handlingHours: number;
  totalCycleTimeHours: number;
  disposition: string;
  denialReason: string;
  adjusterId: string;
  documentCount: number;
  csat: number | null;
  /** Q4 2025 calibration label. Null outside the 500-claim sample. */
  reviewActuallyNeeded: boolean | null;
}

export const EXTRACT_HEADER =
  "claim_id,filed_date,claim_type,state,intake_channel,cost_per_claim_usd,claim_amount_usd,complexity,automation_eligibility_score,flagged_for_human_review,requires_human_by_regulation,queue_wait_hours,handling_hours,total_cycle_time_hours,disposition,denial_reason,adjuster_id,document_count,customer_satisfaction_1to5,review_actually_needed";

export const EXTRACT_PATH = path.join("meridian", "reference", "claims_processing.csv");

const yes = (s: string) => s.trim() === "Yes";

export function parseExtractCsv(text: string): ExtractRow[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].trim();
  if (header !== EXTRACT_HEADER) {
    throw new Error(`Unexpected extract header. Expected the claims_processing.csv columns, got: ${header}`);
  }
  return lines.slice(1).map((line) => {
    const c = line.split(",");
    if (c.length !== 20) throw new Error(`Bad extract row (${c.length} cells): ${line}`);
    return {
      claimId: c[0],
      filedDate: c[1],
      claimType: c[2] as ClaimType,
      state: c[3],
      intakeChannel: c[4] as Channel,
      costPerClaimUsd: Number(c[5]),
      claimAmountUsd: Number(c[6]),
      complexity: c[7] as Complexity,
      automationEligibilityScore: Number(c[8]),
      flaggedForHumanReview: yes(c[9]),
      requiresHumanByRegulation: yes(c[10]),
      queueWaitHours: Number(c[11]),
      handlingHours: Number(c[12]),
      totalCycleTimeHours: Number(c[13]),
      disposition: c[14],
      denialReason: c[15],
      adjusterId: c[16],
      documentCount: Number(c[17]),
      csat: c[18] === "" ? null : Number(c[18]),
      reviewActuallyNeeded: c[19] === "" ? null : yes(c[19]),
    };
  });
}

export function rowToCsvLine(r: ExtractRow): string {
  const yn = (b: boolean) => (b ? "Yes" : "No");
  return [
    r.claimId,
    r.filedDate,
    r.claimType,
    r.state,
    r.intakeChannel,
    r.costPerClaimUsd,
    r.claimAmountUsd,
    r.complexity,
    r.automationEligibilityScore,
    yn(r.flaggedForHumanReview),
    yn(r.requiresHumanByRegulation),
    r.queueWaitHours,
    r.handlingHours,
    r.totalCycleTimeHours,
    r.disposition,
    r.denialReason,
    r.adjusterId,
    r.documentCount,
    r.csat ?? "",
    r.reviewActuallyNeeded === null ? "" : yn(r.reviewActuallyNeeded),
  ].join(",");
}

let cache: { path: string; rows: ExtractRow[] } | null = null;

/** The whole extract, parsed once per process. */
export function loadExtract(root = process.cwd()): ExtractRow[] {
  const p = path.join(root, EXTRACT_PATH);
  if (cache && cache.path === p) return cache.rows;
  const rows = parseExtractCsv(readFileSync(p, "utf8"));
  cache = { path: p, rows };
  return rows;
}

/**
 * The extract row for one claim: the reference extract first, then a one-row
 * extract.csv in the claim's own folder (variants and mock claims).
 */
export function findExtractRow(claimId: string, claimDir?: string, root = process.cwd()): { row: ExtractRow; from: string } | null {
  const hit = loadExtract(root).find((r) => r.claimId === claimId);
  if (hit) return { row: hit, from: EXTRACT_PATH };
  if (claimDir) {
    const local = path.join(claimDir, "extract.csv");
    if (existsSync(local)) {
      const rows = parseExtractCsv(readFileSync(local, "utf8"));
      const r = rows.find((x) => x.claimId === claimId);
      if (r) return { row: r, from: path.relative(root, local) };
    }
  }
  return null;
}
