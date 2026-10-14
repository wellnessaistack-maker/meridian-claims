// Reassembles a run transcript from the PKTGZ (gzip + base64) or PKTREC
// (plain JSON) log lines written by /api/agent/run?mode=background, checking
// each chunk against its hash, and writes it as JSON for scripts/replay-run.ts.
//
//   node scripts/decode-rec-log.ts <log lines file> <out transcript.json>
//
// Line format: PKTGZ <claimId> <runId> <i>/<n> <sha8> |<chunk>|
// The pipes protect the chunk's ends from whitespace trimming; sha8 is the
// first 8 hex characters of the chunk's SHA-256, so a mistyped chunk is named.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error("Usage: node scripts/decode-rec-log.ts <log lines file> <out transcript.json>");
  process.exit(1);
}
export const sha8 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);

const text = readFileSync(inFile, "utf8");
const runs = new Map<string, { n: number; parts: Map<number, string>; bad: number[]; gz: boolean }>();
for (const m of text.matchAll(/PKT(GZ|REC) (\S+) (\S+) (\d+)\/(\d+) ([0-9a-f]{8}) \|(.*?)\|\s*$/gm)) {
  const [, kind, claimId, runId, i, n, hash, chunk] = m;
  const key = `${claimId} ${runId}`;
  if (!runs.has(key)) runs.set(key, { n: Number(n), parts: new Map(), bad: [], gz: kind === "GZ" });
  const run = runs.get(key)!;
  if (sha8(chunk) !== hash) {
    const fixed = repair(chunk, hash);
    if (fixed === null) {
      run.bad.push(Number(i));
      continue;
    }
    console.error(`${key}: chunk ${i} was off by one character and was repaired against its hash.`);
    run.parts.set(Number(i), fixed);
    continue;
  }
  run.parts.set(Number(i), chunk);
}

/**
 * A hand-copied chunk is usually wrong by one character. Try every single
 * substitution, deletion and insertion against the recorded hash; the
 * 32-bit hash makes a false match about one in thirty thousand per chunk.
 */
function repair(chunk: string, hash: string): string | null {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  for (let k = 0; k <= chunk.length; k++) {
    if (k < chunk.length) {
      const del = chunk.slice(0, k) + chunk.slice(k + 1);
      if (sha8(del) === hash) return del;
      for (const c of alphabet) {
        if (c === chunk[k]) continue;
        const sub = chunk.slice(0, k) + c + chunk.slice(k + 1);
        if (sha8(sub) === hash) return sub;
      }
    }
    for (const c of alphabet) {
      const ins = chunk.slice(0, k) + c + chunk.slice(k);
      if (sha8(ins) === hash) return ins;
    }
  }
  return null;
}
if (!runs.size) {
  console.error("No PKTGZ or PKTREC lines found.");
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
  const joined = Array.from({ length: run.n }, (_, i) => run.parts.get(i + 1)!).join("");
  const json = run.gz ? gunzipSync(Buffer.from(joined, "base64")).toString("utf8") : joined;
  const t = JSON.parse(json) as { claimId: string; result?: { ok: boolean } };
  const out = runs.size === 1 ? outFile : outFile.replace(/\.json$/, `-${t.claimId}.json`);
  writeFileSync(out, JSON.stringify(t, null, 2) + "\n");
  console.log(`${key}: ${run.n} chunks, ${json.length} chars, ok=${t.result?.ok} -> ${out}`);
}
if (failed) process.exit(2);
