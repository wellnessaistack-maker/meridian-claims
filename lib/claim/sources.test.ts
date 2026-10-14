import { test } from "node:test";
import assert from "node:assert/strict";

import { findClaimFolder, listClaimFolders } from "./catalog.ts";
import { loadClaim, loadClaimById } from "./load.ts";
import { extractOcrFields, cleanToken, measureConfidence } from "./ocr-fields.ts";
import { parseEdi } from "./edi.ts";
import { checkCompleteness } from "../rules/checklist.ts";

const provided = () => listClaimFolders().filter((f) => f.provenance.kind === "provided");

test("the three provided claims are found with the right provenance label", () => {
  const ids = provided().map((f) => f.claimId);
  assert.deepEqual(ids, ["IS-CLM-2025000300", "IS-CLM-2025002993", "IS-CLM-2025004222"]);
  assert.equal(provided()[0].provenance.label, "Meridian sample claim");
});

test("every field a loader returns is tagged with its system and its document", () => {
  for (const f of provided()) {
    const c = loadClaim(f);
    for (const x of c.claimsPro.intake) assert.equal(x.source, "claimspro");
    for (const x of c.claimsPro.cycle) assert.equal(x.document, "status_history.md");
    for (const x of c.snowflake.fields) assert.equal(x.source, "snowflake");
    assert.ok(c.snowflake.fields.every((x) => x.document.length > 0));
    for (const x of c.edi?.fields ?? []) assert.equal(x.source, "databricks");
  }
});

test("300: the portal claim loads clean, complete, with its cycle metrics as the before picture", () => {
  const c = loadClaimById("IS-CLM-2025000300")!;
  assert.equal(c.header.claimType, "Collision");
  assert.equal(c.header.channel, "E-Portal");
  assert.equal(c.header.amountUsd, 2825.07);
  assert.equal(c.header.regulatoryReviewRequired, false);
  assert.equal(c.claimsPro.queueWaitHours, 30.4);
  assert.equal(c.claimsPro.handlingHours, 4.3);
  assert.equal(c.claimsPro.totalCycleHours, 34.7);
  assert.equal(c.claimsPro.receivedAt, "2025-06-19 08:12");
  assert.equal(c.claimsPro.documentsOnFile.length, 4);
  assert.equal(c.databricks.photos.length, 2);
  assert.equal(c.databricks.pdfs[0].pages.length, 4, "pre-rendered page images are picked up");
  assert.equal(c.ocr, null);
  const r = checkCompleteness(c);
  assert.equal(r.completeness, 1);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(c.names.map((n) => n.value), ["Sunstate Logistics LLC"]);
});

test("2993: the fax claim loads with the OCR text, the EDI record, seven page images and two missing items", () => {
  const c = loadClaimById("IS-CLM-2025002993")!;
  assert.equal(c.header.channel, "Fax/EDI");
  assert.equal(c.header.regulatoryReviewRequired, true);
  assert.equal(c.header.dateOfLoss, "2025-09-08", "date of loss comes from the EDI record when intake has none");
  assert.equal(c.databricks.ocr?.engineConfidence, 0.69);
  assert.equal(c.databricks.pdfs[0].pages.length, 7);
  assert.equal(c.claimsPro.documentsOnFile.length, 18);
  const r = checkCompleteness(c);
  assert.deepEqual(r.missing.map((m) => m.id), ["claimant_contact", "claimant_account"]);
  assert.ok(r.completeness > 0.7 && r.completeness < 0.8);
  assert.deepEqual(c.names.map((n) => n.token), ["[POLICYHOLDER]", "[CLAIMANT]"]);
});

test("4222: the phone claim loads with the transcript, the medical summary and a complete checklist", () => {
  const c = loadClaimById("IS-CLM-2025004222")!;
  assert.equal(c.header.channel, "Phone");
  assert.equal(c.header.dateOfLoss, "2025-09-19");
  assert.equal(c.databricks.transcript?.engineConfidence, 0.85);
  assert.match(c.databricks.transcript?.confidenceBasis ?? "", /low-confidence/);
  assert.equal(c.databricks.pdfs[0].pages.length, 1);
  const r = checkCompleteness(c);
  assert.equal(r.completeness, 1);
  assert.ok(r.items.some((i) => i.id === "claimant_contact" && /call-back/i.test(i.note ?? "")));
});

test("OCR: the fax has exactly the two weak fields the floor described, plus the cut-off date, and the arithmetic repairs the garbled line", () => {
  const c = loadClaimById("IS-CLM-2025002993")!;
  const x = c.ocr!;
  const weak = x.fields.filter((f) => f.confidence < 0.8).map((f) => f.key);
  assert.deepEqual(weak, ["ocr_claimant_contact", "ocr_date_of_loss", "ocr_line_1"]);
  const line1 = x.fields.find((f) => f.key === "ocr_line_1")!;
  assert.equal(line1.raw, "1,B00.00");
  assert.equal(line1.issue, "out_of_class");
  assert.equal(line1.page, 4);
  const contact = x.fields.find((f) => f.key === "ocr_claimant_contact")!;
  assert.equal(contact.value, null);
  assert.equal(contact.confidence, 0);
  assert.equal(contact.page, 1);
  const total = x.fields.find((f) => f.key === "ocr_vehicle_total")!;
  assert.equal(total.value, "3,655.74");
  assert.ok(total.confidence >= 0.8);
  const fix = x.codeChecks.find((k) => k.field === "ocr_line_1")!;
  assert.equal(fix.candidate, "1,800.00");
  assert.equal(fix.passed, true);
  assert.ok(x.codeChecks.every((k) => k.passed === true));
  assert.equal(x.fields.find((f) => f.key === "ocr_policy_number")!.value, "CA-CA-88123-18");
  assert.equal(x.fields.find((f) => f.key === "ocr_estimate_written")!.value, "2025-09-05");
});

test("OCR glyph normalisation fixes O/0 and l/1 twins in numbers and words but leaves real ambiguity alone", () => {
  assert.equal(cleanToken("64O.OO"), "640.00");
  assert.equal(cleanToken("CA-CA-88l23-l8"), "CA-CA-88123-18");
  assert.equal(cleanToken("c0ver"), "cover");
  assert.equal(cleanToken("P0L1CY"), "POLICY");
  assert.equal(cleanToken("1,B00.00"), "1,B00.00", "a B in a number is not a glyph twin; it stays and lowers confidence");
  assert.equal(cleanToken("M2"), "M2");
});

test("per-field confidence is measured in code from the engine's number and a format check", () => {
  assert.equal(measureConfidence("3,655.74", "3,655.74", "amount", 0.69).confidence, 0.88);
  assert.equal(measureConfidence("1,B00.00", "1,B00.00", "amount", 0.69).confidence, 0.35);
  assert.equal(measureConfidence("____", "____", "contact", 0.69).confidence, 0);
  assert.equal(measureConfidence("09/O____", "09/O____", "date", 0.69).issue, "partial");
  assert.equal(measureConfidence("3,655.74", "3,655.74", "amount", 0.97).confidence, 0.99);
});

test("the EDI parser reports the segments Meridian's parser drops silently", () => {
  const c = loadClaimById("IS-CLM-2025002993")!;
  const e = c.edi!;
  assert.equal(e.claimAmount, 48959.36);
  assert.equal(e.dateOfLoss, "2025-09-08");
  assert.equal(e.estimateRef, "IAB9930");
  assert.equal(e.claimantAddressPresent, false);
  assert.equal(e.claimantContactPresent, false);
  assert.ok(e.emptySegments.includes("N3 (claimant address)"));
  const clean = parseEdi("NM1*QC*1*DOE*JANE****MI*X~N3*1 MAIN ST~PER*IC*JANE*TE*5555551234~CLM*X*100.00***11:B:1~");
  assert.equal(clean.claimantAddressPresent, true);
  assert.equal(clean.claimantContactPresent, true);
});

test("an unknown claim ID returns null rather than a guess", () => {
  assert.equal(findClaimFolder("IS-CLM-0000000000"), null);
  assert.equal(loadClaimById("IS-CLM-0000000000"), null);
});
