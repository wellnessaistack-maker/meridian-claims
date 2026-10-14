// Writes data/worklist.json: about 30 extract rows as queue entries with no
// documents, routed by the structured rules. Deterministic.
//
//   npm run seed

import { mkdirSync, writeFileSync } from "node:fs";

import { seedWorklist } from "../lib/worklist/seed.ts";
import { PROTOCOL_VERSION } from "../lib/rules/protocol.ts";

const entries = seedWorklist();
mkdirSync("data", { recursive: true });
const out = { generatedBy: "scripts/seed-worklist.ts", protocolVersion: PROTOCOL_VERSION, source: "meridian/reference/claims_processing.csv (stratified by channel, complexity and flag status)", entries };
writeFileSync("data/worklist.json", JSON.stringify(out, null, 2) + "\n");
const by = (k: keyof (typeof entries)[number]) => Object.entries(entries.reduce<Record<string, number>>((a, e) => ({ ...a, [String(e[k])]: (a[String(e[k])] ?? 0) + 1 }), {})).map(([a, b]) => `${a} ${b}`).join(", ");
console.log(`Wrote ${entries.length} entries to data/worklist.json`);
console.log(`  segments: ${by("segment")}`);
console.log(`  channels: ${by("channel")}`);
console.log(`  complexity: ${by("complexity")}`);
console.log(`  states: ${by("state")}`);
