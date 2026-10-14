// Saves a response from GET /api/agent/run (the deployed endpoint) into the
// repo as the cached packet and the audit record, exactly as scripts/run-agent.ts
// would have written them locally.
//
//   node scripts/save-run.ts path/to/response.json [more.json ...]

import { readFileSync } from "node:fs";

import { claimPacketSchema } from "../lib/claim/schema.ts";
import { writePacket, type PacketRecord } from "../lib/agent/cache.ts";
import { appendAudit, type AuditRecord } from "../lib/audit/record.ts";
import type { Decision } from "../lib/rules/engine.ts";

interface RunResponse {
  ok: boolean;
  failure: string | null;
  model: string;
  packet: unknown;
  decision: Decision;
  usage: PacketRecord["usage"];
  audit: AuditRecord | null;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Pass one or more response JSON files.");
  process.exit(1);
}
let bad = 0;
for (const f of files) {
  const r = JSON.parse(readFileSync(f, "utf8")) as RunResponse;
  if (!r.ok || !r.audit) {
    console.error(`${f}: run failed: ${r.failure}. Nothing saved.`);
    bad += 1;
    continue;
  }
  const packet = claimPacketSchema.parse(r.packet);
  const p = writePacket({ packet, decision: r.decision, usage: r.usage, savedAt: new Date().toISOString() });
  appendAudit(r.audit);
  const tools = packet.trace.map((t) => t.tool).join(", ");
  console.log(`${packet.claimId}: ${r.decision.route} [${r.decision.reasons.map((x) => x.id).join(",") || "no rules"}] agent said ${packet.agentRoute}; ${packet.trace.length} tool calls (${tools}); ${packet.contradictions.length} contradictions; missing ${packet.missing.map((m) => m.id).join(", ") || "none"}; ${(r.usage.durationMs / 1000).toFixed(0)}s $${r.usage.costUsd.toFixed(3)} -> ${p}`);
}
if (bad) process.exit(2);
