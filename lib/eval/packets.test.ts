// The packet evaluation runs on the cached packets, so these numbers are pinned
// the same way the rules-only numbers are. A re-run that changes them changes
// this file too, on purpose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadCases, scorePackets } from "./packets.ts";
import { loadWorkspaceData } from "../ui/workspace-data.ts";

const cases = loadCases();
const report = scorePackets(cases, loadWorkspaceData().rows, "test");

test("every labelled case has a claim folder, and every provided and variant case a cached packet", () => {
  assert.equal(cases.length, 16);
  for (const c of report.cases) assert.equal(c.failure, null, `${c.caseId}: ${c.failure}`);
});

test("no claim that must reach a person is routed below specialist review", () => {
  assert.deepEqual(report.summary.escalation.missedIds, []);
  assert.equal(report.summary.escalation.of, 10);
});

test("the re-read of the fax line reads 1,800.00 on both the garbled and the clean OCR", () => {
  assert.equal(report.summary.fields.of, 2);
  assert.equal(report.summary.fields.right, 2);
});

test("route agreement on the cached packets, as it stands", () => {
  assert.equal(report.summary.agreement.exact, 12);
  assert.equal(report.summary.agreement.acceptable, 16);
  assert.equal(report.summary.overEscalated.count, 0);
});

test("no committed audit record is human-reviewed: confirmations belong to a session, not the repo", () => {
  const dir = path.join(process.cwd(), "data", "audit");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { records: { humanReviewed: boolean }[] };
    assert.ok(j.records.every((r) => !r.humanReviewed), `${f} carries a confirmed record`);
  }
});
