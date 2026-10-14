// Reassembles a background run's result from the PKTCHUNK log lines written by
// /api/agent/run?mode=background, and writes it as the JSON that
// scripts/save-run.ts expects.
//
//   node scripts/decode-run-log.ts <log lines file> <out.json>

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error("Usage: node scripts/decode-run-log.ts <log lines file> <out.json>");
  process.exit(1);
}
const text = readFileSync(inFile, "utf8");
const chunks = new Map<string, { n: number; parts: Map<number, string> }>();
for (const m of text.matchAll(/PKTCHUNK (\S+) (\S+) (\d+)\/(\d+) ([A-Za-z0-9+/=]+)/g)) {
  const key = `${m[1]} ${m[2]}`;
  if (!chunks.has(key)) chunks.set(key, { n: Number(m[4]), parts: new Map() });
  chunks.get(key)!.parts.set(Number(m[3]), m[5]);
}
if (!chunks.size) {
  console.error("No PKTCHUNK lines found.");
  process.exit(1);
}
// The latest run for each claim wins when several are present.
const [key, run] = [...chunks.entries()].sort((a, b) => a[0].localeCompare(b[0])).pop()!;
const missing = Array.from({ length: run.n }, (_, i) => i + 1).filter((i) => !run.parts.has(i));
if (missing.length) {
  console.error(`${key}: missing chunks ${missing.join(", ")} of ${run.n}.`);
  process.exit(2);
}
const b64 = Array.from({ length: run.n }, (_, i) => run.parts.get(i + 1)!).join("");
const json = gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
JSON.parse(json);
writeFileSync(outFile, json);
console.log(`${key}: ${run.n} chunks, ${json.length} bytes -> ${outFile}`);
