// The protocol, rendered from lib/rules/protocol.ts: every rule as written in
// code, nothing re-typed. Locked rules cannot be changed from the screen;
// configurable settings show their defaults and ranges.

import { ROUTE_LABELS } from "@/lib/claim/schema.ts";
import { HUMAN_DECISION } from "@/lib/rules/engine.ts";
import { CONSENT_STATES, DEFAULT_SETTINGS, PROTOCOL_VERSION, RULES, SETTING_DEFS, THRESHOLD_AMOUNT_USD, THRESHOLD_STATES, type RuleGroup } from "@/lib/rules/protocol.ts";

const GROUPS: { key: RuleGroup; title: string; blurb: string }[] = [
  { key: "guardrail", title: "Guardrails", blurb: "What the AI can never do." },
  { key: "regulatory", title: "Regulatory floors (locked)", blurb: "State rules the prototype does not argue with." },
  { key: "scope", title: "Scope (locked)", blurb: "Claims the prototype does not handle." },
  { key: "evidence", title: "Evidence (locked)", blurb: "A packet that is not whole is not ready." },
  { key: "operating", title: "Operating rules (configurable)", blurb: "Meridian's own thresholds. Changing one changes the route for every claim it touches; the change is logged with the protocol version." },
];

export default function RulesPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-6 text-sm">
      <a href="/" className="text-xs text-blue-700 underline">← Worklist</a>
      <h1 className="mt-2 text-lg font-semibold">Routing protocol {PROTOCOL_VERSION}</h1>
      <p className="mt-1 text-slate-700">The rules run after the agent, in code, and only ever make a route more conservative. {HUMAN_DECISION}</p>
      <p className="mt-1 text-xs text-slate-500">
        Routes, least to most conservative: {Object.values(ROUTE_LABELS).join(" → ")}. Threshold states: {THRESHOLD_STATES.join(", ")} over ${THRESHOLD_AMOUNT_USD.toLocaleString()}. Consent states: {CONSENT_STATES.join(", ")}.
      </p>

      {GROUPS.map((g) => (
        <section key={g.key} className="mt-6">
          <h2 className="text-base font-semibold">{g.title}</h2>
          <p className="text-xs text-slate-500">{g.blurb}</p>
          <ul className="mt-2 space-y-2">
            {RULES.filter((r) => r.group === g.key).map((r) => (
              <li key={r.id} id={r.id} className="rounded border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{r.id}</span>
                  <strong>{r.title}</strong>
                  <span className={`rounded px-1.5 text-[11px] ${r.tier === "locked" ? "bg-slate-800 text-white" : "bg-blue-50 text-blue-800"}`}>{r.tier}</span>
                  <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">floor: {ROUTE_LABELS[r.floor]}</span>
                  <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{r.scope === "structured" ? "runs on the extract alone" : "needs the packet"}</span>
                </div>
                <p className="mt-1 text-slate-700">{r.when}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Reads: {r.uses.join(", ")}
                  {r.settings?.length ? ` · settings: ${r.settings.join(", ")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-6">
        <h2 className="text-base font-semibold">Configurable settings (defaults)</h2>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500"><th className="py-1 pr-3">Setting</th><th className="py-1 pr-3">Default</th><th className="py-1 pr-3">Range</th><th className="py-1">What it does</th></tr>
          </thead>
          <tbody>
            {SETTING_DEFS.map((d) => (
              <tr key={d.key} className="border-t border-slate-200 align-top">
                <td className="py-1 pr-3 font-medium">{d.label}</td>
                <td className="py-1 pr-3 font-mono">{fmt(DEFAULT_SETTINGS[d.key], d.unit)}</td>
                <td className="py-1 pr-3 font-mono">{fmt(d.min, d.unit)} – {fmt(d.max, d.unit)}</td>
                <td className="py-1 text-slate-700">{d.help}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Each rule has a test in lib/rules/engine.test.ts. The rules-only evaluation on the 500 labelled extract rows runs in npm test.</p>
      </section>
    </main>
  );
}

function fmt(v: number, unit: "usd" | "pct" | "ratio") {
  return unit === "usd" ? `$${v.toLocaleString()}` : unit === "pct" ? `${v}%` : String(v);
}
