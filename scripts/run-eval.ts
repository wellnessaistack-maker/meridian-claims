// npm run eval: score the cached packets against the draft labels in
// eval/cases.csv and write eval/results/latest.json, which the Evaluation page
// and the route-confidence field of the audit record read. Spends nothing: it
// never calls the model. To evaluate a fresh run, re-run the claims first
// (npm run agent -- <claimId>, with a key) and then run this again.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadCases, scorePackets } from "../lib/eval/packets.ts";
import { loadWorkspaceData } from "../lib/ui/workspace-data.ts";

const root = process.cwd();
const data = loadWorkspaceData(root);
const cases = loadCases(root);
const report = scorePackets(cases, data.rows, data.model);

const out = path.join(root, "eval", "results", "latest.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

const s = report.summary;
console.log(`Packet evaluation on ${report.cases.length} cases (cached packets, protocol ${report.protocolVersion}, prompt ${report.promptVersion})`);
console.log(`  must reach a person: ${s.escalation.caught} of ${s.escalation.of} did${s.escalation.missedIds.length ? ` (missed: ${s.escalation.missedIds.join(", ")})` : ""}`);
console.log(`  route agreement:     ${s.agreement.exact} exact, ${s.agreement.acceptable} acceptable, of ${s.agreement.of}`);
console.log(`  over-escalated:      ${s.overEscalated.count} of ${s.overEscalated.of} that did not need a person${s.overEscalated.ids.length ? ` (${s.overEscalated.ids.join(", ")})` : ""}`);
console.log(`  re-read fields:      ${s.fields.right} of ${s.fields.of}`);
for (const [k, v] of Object.entries(s.byProvenance)) console.log(`  ${k.padEnd(9)} ${v.exact} exact, ${v.acceptable} acceptable, of ${v.of}`);
for (const c of report.cases) if (!c.acceptable) console.log(`  ✗ ${c.caseId}: expected ${c.expectedRoute}, got ${c.ok ? c.route : `failed (${c.failure})`}`);
console.log(`  model spend recorded on the packets: $${s.cost.total.toFixed(2)}`);
console.log(`Wrote ${path.relative(root, out)}`);
