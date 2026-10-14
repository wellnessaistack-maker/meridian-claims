import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as writes from "./writes.ts";

test("there are exactly four write operations and none of them is a decision", () => {
  assert.deepEqual([...writes.WRITE_OPERATIONS], ["add_note", "set_status", "send_correspondence", "transition_workflow"]);
  const exported = Object.keys(writes).join(" ").toLowerCase();
  assert.doesNotMatch(exported, /approve|deny|denial|adjudicat|pay/);
  assert.throws(() => writes.write("approve_claim" as never, "X", {} as never));
});

test("every call appends a record to the log and returns an id", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cpw-"));
  const a = writes.addNote("IS-CLM-TEST", { text: "Packet reviewed.", author: "ADJ-110" }, root);
  const b = writes.setStatus("IS-CLM-TEST", { status: "In Review", note: null }, root);
  assert.match(a.id, /^cpw_[0-9a-f]{12}$/);
  assert.equal(a.stub, true);
  assert.equal(a.soap, "ClaimNoteService.AddNote");
  const lines = readFileSync(path.join(root, "data", "claimspro-writes.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).id, b.id);
  assert.deepEqual(writes.listWrites("IS-CLM-TEST", root).map((r) => r.op), ["add_note", "set_status"]);
  assert.deepEqual(writes.listWrites("IS-CLM-OTHER", root), []);
});
