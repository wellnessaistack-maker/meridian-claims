import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { claimPacketSchema } from "../claim/schema.ts";
import { loadClaimById } from "../claim/load.ts";
import { amountCheck } from "./amount.ts";

const packetOf = (id: string) => claimPacketSchema.parse(JSON.parse(readFileSync(`data/packets/${id}.json`, "utf8")).packet);
const docsOf = (id: string) => loadClaimById(id)!.databricks.documents.map((d) => ({ name: d.name, text: d.text }));

test("300: the estimate's net total supports the amount claimed, read by the agent from the PDF", () => {
  const a = amountCheck(packetOf("IS-CLM-2025000300"), docsOf("IS-CLM-2025000300"));
  assert.equal(a.claimed, 2825.07);
  assert.equal(a.supported, 2825.07);
  assert.equal(a.gap, 0);
  const counted = a.lines.filter((l) => l.counted);
  assert.equal(counted.length, 1);
  assert.equal(counted[0].document, "repair_estimate.pdf");
});

test("2993: only the vehicle estimate is on file, so most of the injury claim is unsupported", () => {
  const a = amountCheck(packetOf("IS-CLM-2025002993"), docsOf("IS-CLM-2025002993"));
  assert.equal(a.claimed, 48959.36);
  assert.equal(a.supported, 3655.74);
  assert.ok(a.gap! > 45000);
  assert.match(a.note, /not supported/);
});

test("a markdown estimate's net total is found by code when the agent did not record it", () => {
  const a = amountCheck(packetOf("IS-CLM-2025900001"), docsOf("IS-CLM-2025900001"));
  assert.equal(a.supported, 4480);
  assert.equal(a.gap, 0);
  assert.equal(a.lines.find((l) => l.counted)?.source, "code");
});

test("two quotes and a total in one letter count once, as the letter's total", () => {
  const a = amountCheck(packetOf("IS-CLM-2025900002"), docsOf("IS-CLM-2025900002"));
  assert.equal(a.supported, 6800);
  assert.equal(a.lines.filter((l) => l.counted).length, 1);
});
