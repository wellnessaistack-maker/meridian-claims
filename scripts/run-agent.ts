// Runs the agent on claim folders and caches the packets.
//
//   npm run agent -- IS-CLM-2025000300 IS-CLM-2025002993   # named claims
//   npm run agent -- --provided                             # the three Meridian sample claims
//   npm run agent -- --all                                  # every folder: provided, variants, mock
//   npm run agent -- --model claude-sonnet-5-5 --all
//
// Needs ANTHROPIC_API_KEY. Writes data/packets/<id>.json and appends to
// data/audit/<id>.json. A run that fails never overwrites a good cached packet.

import { listClaimFolders } from "../lib/claim/catalog.ts";
import { loadClaim } from "../lib/claim/load.ts";
import { apiKeyConfigured, modelFromEnv, NO_KEY_MESSAGE } from "../lib/agent/models.ts";
import { runAgent } from "../lib/agent/run.ts";
import { readPacket, writePacket } from "../lib/agent/cache.ts";
import { appendAudit, recordFor } from "../lib/audit/record.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i > -1 ? args[i + 1] : undefined;
};
const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--model");

if (!apiKeyConfigured()) {
  console.error(`${NO_KEY_MESSAGE} Set ANTHROPIC_API_KEY and run again.`);
  process.exit(1);
}

const folders = listClaimFolders().filter((f) => (flag("all") ? true : flag("provided") ? f.provenance.kind === "provided" : ids.includes(f.claimId)));
if (!folders.length) {
  console.error("No claims selected. Pass claim IDs, --provided or --all.");
  process.exit(1);
}
const model = opt("model") ?? modelFromEnv();
console.log(`Model ${model}; ${folders.length} claim${folders.length === 1 ? "" : "s"}.`);

let failures = 0;
for (const f of folders) {
  const claim = loadClaim(f);
  process.stdout.write(`${f.claimId} (${f.provenance.label}) ... `);
  const r = await runAgent(claim, { model });
  const tools = r.packet.trace.map((t) => t.tool.replace(/^(get_|check_|reread_)/, (m) => m[0])).join(" ");
  if (!r.ok) {
    failures += 1;
    const cached = readPacket(f.claimId);
    console.log(`FAILED: ${r.failure}${cached ? " (cached packet kept)" : ""}`);
    continue;
  }
  writePacket({ packet: r.packet, decision: r.decision, usage: r.usage, savedAt: new Date().toISOString() });
  appendAudit(recordFor(r.packet, r.decision, r.snapshot));
  const d = r.decision;
  console.log(`${d.route}${d.agentRoute !== d.route ? ` (agent said ${d.agentRoute})` : ""} [${d.reasons.map((x) => x.id).join(",") || "no rules"}] ${r.packet.trace.length} tool calls (${tools}), ${r.packet.contradictions.length} contradictions, ${r.packet.missing.length} missing, ${(r.usage.durationMs / 1000).toFixed(1)}s, $${r.usage.costUsd.toFixed(3)}`);
}
if (failures) {
  console.error(`${failures} claim${failures === 1 ? "" : "s"} failed.`);
  process.exit(2);
}
