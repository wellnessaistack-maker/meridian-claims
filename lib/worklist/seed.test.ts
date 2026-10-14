import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pickSeedRows, seedWorklist, SEED_SIZE } from "./seed.ts";
import { loadExtract } from "../extract/csv.ts";

test("the seed is 30 extract rows across every channel, complexity and flag status, labelled as such", () => {
  const entries = seedWorklist();
  assert.equal(entries.length, SEED_SIZE);
  assert.equal(new Set(entries.map((e) => e.channel)).size, 3);
  assert.equal(new Set(entries.map((e) => e.complexity)).size, 3);
  assert.equal(new Set(entries.map((e) => e.todayFlagged)).size, 2);
  assert.ok(new Set(entries.map((e) => e.state)).size >= 8);
  assert.ok(entries.every((e) => e.provenance.kind === "extract" && e.provenance.label === "From the extract (no documents)"));
  assert.ok(entries.every((e) => e.packet === "none" && e.queueAgeHours > 0));
});

test("the seed is deterministic and data/worklist.json matches it", () => {
  const a = pickSeedRows(loadExtract()).map((r) => r.claimId);
  const b = pickSeedRows(loadExtract()).map((r) => r.claimId);
  assert.deepEqual(a, b);
  const file = JSON.parse(readFileSync("data/worklist.json", "utf8")) as { entries: { claimId: string; route: string }[] };
  assert.deepEqual(file.entries.map((e) => e.claimId), a);
  assert.deepEqual(file.entries.map((e) => e.route), seedWorklist().map((e) => e.route));
});

test("entries with no packet never sit in the ready segment", () => {
  for (const e of seedWorklist()) assert.notEqual(e.segment, "ready", e.claimId);
});
