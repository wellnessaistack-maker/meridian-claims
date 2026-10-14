// The rules-only evaluation on the 500 labelled extract rows. These numbers are
// quoted verbatim in the README; if a rule changes, the README changes with them.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadExtract } from "../extract/csv.ts";
import { scoreRulesOnly } from "./rules-only.ts";

const report = scoreRulesOnly(loadExtract());

test("today's flag, as the floor described it: misses 21 of 159 and flags 63 unnecessarily", () => {
  const t = report.today;
  assert.equal(t.labelled, 500);
  assert.equal(t.needed, 159);
  assert.equal(t.flaggedLabelled, 237);
  assert.equal(t.missed, 21);
  assert.equal(t.unnecessary, 63);
  assert.equal(t.flagged, 2280);
  assert.equal(t.missedRegulatory, 31, "today's flag misses 31 of the 134 labelled claims that regulation requires a human on");
});

test("the structured rules at default settings: regulatory misses are zero; everything else is reported as it is", () => {
  const r = report.rules;
  assert.equal(r.missedRegulatory, 0);
  assert.equal(r.regulatoryLabelled, 134);
  assert.equal(r.flagged, 2513);
  assert.equal(r.flaggedLabelled, 259);
  assert.equal(r.missed, 34);
  assert.equal(r.unnecessary, 71);
});

test("the regulatory floor alone flags 25% of the extract with no unnecessary flags, and misses 88 of 159", () => {
  const r = report.regulatoryOnly;
  assert.equal(r.flagged, 1272);
  assert.equal(r.unnecessary, 0);
  assert.equal(r.missed, 88);
  assert.equal(r.missedRegulatory, 0);
});

test("raising the simple-claim ceiling trades misses for unnecessary flags, monotonically", () => {
  const s = report.ceilingSweep;
  assert.deepEqual(s.map((x) => x.ceilingUsd), [2500, 5000, 7500, 10000]);
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i].missed >= s[i - 1].missed);
    assert.ok(s[i].unnecessary <= s[i - 1].unnecessary);
    assert.ok(s[i].flagRate <= s[i - 1].flagRate);
  }
});
