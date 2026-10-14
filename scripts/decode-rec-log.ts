// Reassembles a run transcript from the PKTREC log lines written by
// /api/agent/run?mode=background, checking each chunk against its hash, and
// writes it as JSON for scripts/replay-run.ts.
//
//   node scripts/decode-rec-log.ts <log lines file> <out transcript.json>
//
// Line format: PKTREC <claimId> <runId> <i>/<n> <sha8> |<chunk>|
// The pipes protect the chunk's ends from whitespace trimming; sha8 is the
// first 8 hex characters of the chunk's SHA-256, so a mistyped chunk is named.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error("Usage: node scripts/decode-rec-log.ts <log lines file> <out transcript.json>");
  process.exit(1);
}
export const sha8 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);

const text = readFileSync(inFile, "utf8");
const runs = new Map<string, { n: number; parts: Map<number, string>; bad: number[] }>();
for (const m of text.matchAll(/PKTREC (\S+) (\S+) (\d+)\/(\d+) ([0-9a-f]{8}) \|(.*?)\|\s*$/gm)) {
  const key = `${m[1]} ${m[2]}`;
  if (!runs.has(key)) runs.set(key, { n: Number(m[4]), parts: new Map(), bad: [] });
  const run = runs.get(key)!;
  const chunk = m[6];
  if (sha8(chunk) !== m[5]) {
    run.bad.push(Number(m[3]));
    continue;
  }
  run.parts.set(Number(m[3]), chunk);
}
if (!runs.size) {
  console.error("No PKTREC lines found.");
  process.exit(1);
}
let failed = false;
for (const [key, run] of runs) {
  const missing = Array.from({ length: run.n }, (_, i) => i + 1).filter((i) => !run.parts.has(i));
  if (run.bad.length) console.error(`${key}: chunk hash mismatch on ${run.bad.join(", ")} (copied wrongly; copy those lines again).`);
  if (missing.length) console.error(`${key}: missing chunks ${missing.join(", ")} of ${run.n}.`);
  if (run.bad.length || missing.length) {
    failed = true;
    continue;
  }
  const json = Array.from({ length: run.n }, (_, i) => run.parts.get(i + 1)!).join("");
  const t = JSON.parse(json) as { claimId: string; result?: { ok: boolean } };
  const out = runs.size === 1 ? outFile : outFile.replace(/\.json$/, `-${t.claimId}.json`);
  writeFileSync(out, JSON.stringify(t, null, 2) + "\n");
  console.log(`${key}: ${run.n} chunks, ${json.length} chars, ok=${t.result?.ok} -> ${out}`);
}
if (failed) process.exit(2);
