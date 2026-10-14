import { test } from "node:test";
import assert from "node:assert/strict";

import { findExtractRow, loadExtract, parseExtractCsv, rowToCsvLine } from "./csv.ts";

test("the extract parses to 5,000 typed rows with the 500 calibration labels", () => {
  const rows = loadExtract();
  assert.equal(rows.length, 5000);
  assert.equal(rows.filter((r) => r.reviewActuallyNeeded !== null).length, 500);
  assert.equal(rows.filter((r) => r.reviewActuallyNeeded === true).length, 159);
  assert.equal(rows.filter((r) => r.flaggedForHumanReview).length, 2280);
  assert.equal(rows.filter((r) => r.requiresHumanByRegulation).length, 1272);
});

test("the three sample claims are in the extract with the values on their intake records", () => {
  const r300 = findExtractRow("IS-CLM-2025000300")!.row;
  assert.equal(r300.claimAmountUsd, 2825.07);
  assert.equal(r300.state, "FL");
  assert.equal(r300.intakeChannel, "E-Portal");
  assert.equal(r300.queueWaitHours, 30.4);
  const r2993 = findExtractRow("IS-CLM-2025002993")!.row;
  assert.equal(r2993.denialReason, "Pre-existing damage");
  assert.equal(r2993.requiresHumanByRegulation, true);
  const r4222 = findExtractRow("IS-CLM-2025004222")!.row;
  assert.equal(r4222.claimType, "Bodily Injury");
  assert.equal(findExtractRow("IS-CLM-9999999999"), null);
});

test("in the extract the regulatory flag is exactly: a human-review state and over $10,000, or a consent-state record", () => {
  const TH = new Set(["CA", "NY", "NJ", "FL", "IL", "PA", "OH", "GA", "MD", "MA", "MI", "VA"]);
  for (const r of loadExtract()) {
    if (TH.has(r.state)) assert.equal(r.requiresHumanByRegulation, r.claimAmountUsd > 10000, r.claimId);
  }
});

test("a row round-trips through the one-row extract.csv format used by variants and mock claims", () => {
  const row = loadExtract()[0];
  const text = parseExtractCsv(["claim_id,filed_date,claim_type,state,intake_channel,cost_per_claim_usd,claim_amount_usd,complexity,automation_eligibility_score,flagged_for_human_review,requires_human_by_regulation,queue_wait_hours,handling_hours,total_cycle_time_hours,disposition,denial_reason,adjuster_id,document_count,customer_satisfaction_1to5,review_actually_needed", rowToCsvLine(row)].join("\n"));
  assert.deepEqual(text[0], row);
});
