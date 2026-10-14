// Replays a recorded run transcript against the claim folder and caches the
// packet, exactly as scripts/run-agent.ts would have, if and only if the replay
// reproduces the hashes the original run computed.
//
//   node scripts/replay-run.ts transcript.json [more.json ...]
//
// The deployment can run the model but cannot write to this repo; this
// sandbox can write but has no key. The transcript (the model's turns) is the
// hand-off. The tools are code, so the replay sees the same documents and
// builds the same packet; the input hash and packet hash prove it did.

import { readFileSync } from "node:fs";

import { loadClaimById } from "../lib/claim/load.ts";
import { readPacket, writePacket } from "../lib/agent/cache.ts";
import { runAgent } from "../lib/agent/run.ts";
import { applyRecordedTimings, packetHash, replayClient, replayVision, type Transcript } from "../lib/agent/transcript.ts";
import { appendAudit, recordFor } from "../lib/audit/record.ts";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Pass one or more transcript JSON files.");
  process.exit(1);
}
let bad = 0;
for (const f of files) {
  const t = JSON.parse(readFileSync(f, "utf8")) as Transcript;
  const claim = loadClaimById(t.claimId);
  if (!claim) {
    console.error(`${f}: no claim folder for ${t.claimId}.`);
    bad += 1;
    continue;
  }
  if (!t.result) {
    console.error(`${f}: transcript has no result block; the run did not complete.`);
    bad += 1;
    continue;
  }
  const r = applyRecordedTimings(t, await runAgent(claim, { model: t.model, client: replayClient(t), vision: replayVision(t) }));
  const problems: string[] = [];
  if (r.packet.inputHash !== t.result.inputHash) problems.push(`input hash ${r.packet.inputHash.slice(0, 12)} != recorded ${t.result.inputHash.slice(0, 12)} (the replay saw different documents)`);
  if (packetHash(r.packet) !== t.result.packetHash) problems.push(`packet hash ${packetHash(r.packet).slice(0, 12)} != recorded ${t.result.packetHash.slice(0, 12)}`);
  if (r.ok !== t.result.ok || r.failure !== t.result.failure) problems.push(`outcome differs: replay ${r.ok ? "ok" : r.failure}, recorded ${t.result.ok ? "ok" : t.result.failure}`);
  if (problems.length) {
    console.error(`${t.claimId}: replay does not match the recorded run. Nothing saved.\n  ${problems.join("\n  ")}`);
    bad += 1;
    continue;
  }
  if (!r.ok) {
    const cached = readPacket(t.claimId);
    console.error(`${t.claimId}: the recorded run failed: ${r.failure}${cached ? " (cached packet kept)" : ""}`);
    bad += 1;
    continue;
  }
  const p = writePacket({ packet: r.packet, decision: r.decision, usage: r.usage, savedAt: new Date().toISOString() });
  appendAudit(recordFor(r.packet, r.decision, r.snapshot));
  const d = r.decision;
  const tools = r.packet.trace.map((e) => e.tool).join(", ");
  console.log(`${t.claimId}: ${d.route}${d.agentRoute !== d.route ? ` (agent said ${d.agentRoute})` : ""} [${d.reasons.map((x) => x.id).join(",") || "no rules"}] ${r.packet.trace.length} tool calls (${tools}); ${r.packet.contradictions.length} contradictions; missing ${r.packet.missing.map((m) => m.id).join(", ") || "none"}; ${(r.usage.durationMs / 1000).toFixed(0)}s $${r.usage.costUsd.toFixed(3)}; hashes match -> ${p}`);
}
if (bad) process.exit(2);
