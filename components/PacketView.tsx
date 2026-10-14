"use client";

// The middle pane: one claim, everything the agent assembled, with the route
// and the rules that produced it. Every value shows where it came from.

import { useState } from "react";

import type { ClaimRow } from "@/lib/ui/workspace-data.ts";
import { DENIAL_INDICATOR_LABELS, ROUTE_LABELS, ROUTE_MEANING, type FinalRoute } from "@/lib/claim/schema.ts";
import type { Decision } from "@/lib/rules/engine.ts";
import { RouteChip, Section, SourceTag, pct, usd, when } from "./ui";

const fileUrl = (claimId: string, p: string) => `/api/claims/${encodeURIComponent(claimId)}/file?path=${encodeURIComponent(p)}`;

export function PacketView({ row, decision, onOpenAudit, onRerun, rerunState, apiKey, model }: { row: ClaimRow; decision: Decision; onOpenAudit: () => void; onRerun: () => void; rerunState: { running: boolean; error: string | null }; apiKey: boolean; model: string }) {
  const p = row.packet?.packet ?? null;
  const [showTrace, setShowTrace] = useState(false);
  const [crop, setCrop] = useState<string | null>(null);
  const unmask = (s: string) => row.names.reduce((t, n) => t.split(n.token).join(n.name), s);
  const last = row.audit[row.audit.length - 1];

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-mono text-base font-semibold">{row.claimId}</h2>
            <span className="rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-600" title={row.provenance.change ?? ""}>
              {row.provenance.label}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-700">
            {row.header.claimType} · {row.header.state} · {row.header.channel} · filed {row.header.filedDate} · {usd(row.header.amountUsd)}
            {row.header.vehicle ? ` · ${row.header.vehicle}` : ""}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Policyholder {row.names.find((n) => n.token === "[POLICYHOLDER]")?.name ?? "(from the extract)"} · policy {row.header.policyNumber ?? "—"} · status {row.header.policyStatus} · date of loss {row.header.dateOfLoss ?? "not on file"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRerun} disabled={!apiKey || rerunState.running || row.documentCount === 0} className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50" title={!apiKey ? "No API key. Re-run is disabled." : row.documentCount === 0 ? "No documents: nothing for the agent to read." : `Run the agent again with ${model}`}>
            {rerunState.running ? "Running…" : "Re-run"}
          </button>
          <button onClick={onOpenAudit} className="rounded bg-slate-900 px-2.5 py-1 text-xs text-white hover:bg-slate-800">
            {last?.humanReviewed ? "Audit record (confirmed)" : "Review and confirm"}
          </button>
        </div>
      </header>
      {rerunState.error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{rerunState.error}</div>}

      <RouteBox decision={decision} />

      <div className="mb-5 grid grid-cols-3 gap-3 text-xs">
        <Stat label="Evidence completeness" value={p ? pct(p.completeness) : "—"} note={p ? `${p.evidence.filter((e) => e.present).length} of ${p.evidence.length} on the checklist` : "No packet"} />
        <Stat label="Field extraction" value={p ? fieldConfidenceText(p.fields) : "—"} note={p ? rereadText(p.fields) : "No packet"} />
        <Stat label="Route confidence" value={last ? (last.confidence.route.value === null ? "Not yet measured" : pct(last.confidence.route.value)) : "Not yet measured"} note={last?.confidence.route.basis ?? "The packet evaluation has not run."} />
      </div>

      <TodayBox row={row} />

      {!p && (
        <div className="mb-5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {row.documentCount === 0 ? "This claim comes from the extract: a structured row, no documents. The structured rules ran; the packet rules could not. It is routed as today's process would, for a person." : "The agent has not run on this claim yet. The structured rules alone put it where it is."}
        </div>
      )}
      {p && p.status === "not_assembled" && <div className="mb-5 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">Packet not assembled: {p.notAssembledReason}. Manual triage: a person works this claim from the documents.</div>}

      {p && (
        <>
          <Section title="Rationale (written for a regulator)">
            <p className="text-sm leading-relaxed">{p.rationale}</p>
            {p.agentRoute && (
              <p className="mt-1 text-xs text-slate-500">
                The agent recommended <strong>{ROUTE_LABELS[p.agentRoute]}</strong>. {decision.escalatedByRules ? "The rules moved it to a more conservative route; see the reasons above." : "The rules agreed."}
              </p>
            )}
          </Section>

          {p.missing.length > 0 && (
            <Section title="Missing">
              <ul className="space-y-1 text-sm">
                {p.missing.map((m) => (
                  <li key={m.id} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span>
                      <strong>{m.label}</strong> <span className="text-slate-500">(from the {m.from})</span>: {m.why}
                    </span>
                  </li>
                ))}
              </ul>
              {decision.route === "request_information" && <RequestDraft row={row} unmask={unmask} />}
            </Section>
          )}

          {p.denialIndicators.length > 0 && (
            <Section title="Denial indicators (a person weighs these)">
              <ul className="space-y-1.5 text-sm">
                {p.denialIndicators.map((d, i) => (
                  <li key={i} className="rounded border border-red-100 bg-red-50/60 px-2 py-1.5">
                    <div className="font-medium text-red-900">{DENIAL_INDICATOR_LABELS[d.kind]}</div>
                    <div className="text-slate-700">{d.evidence}</div>
                    <SourceTag source={d.source} document={d.document} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {p.contradictions.length > 0 && (
            <Section title="Contradictions">
              <ul className="space-y-2 text-sm">
                {p.contradictions.map((c, i) => (
                  <li key={i} className="rounded border border-slate-200 bg-white px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <strong>{c.topic}</strong>
                      <span className={`rounded px-1 text-[11px] ${c.material ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>{c.material ? "material" : "not blocking"}</span>
                    </div>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      <Quote q={c.a} />
                      <Quote q={c.b} />
                    </div>
                    {c.note && <div className="mt-1 text-xs text-slate-600">{c.note}</div>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Evidence checklist">
            <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {p.evidence.map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <span className={`mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full text-center text-[10px] leading-4 ${e.present ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-600"}`}>{e.present ? "✓" : "–"}</span>
                  <span>
                    {e.label} {e.present ? <SourceTag source={e.source} document={e.document} /> : <span className="text-xs text-slate-500">{e.note ?? "not on file"}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Fields" aside={<span className="text-[11px] text-slate-500">Hover a source for the system it is read from. Confidence is measured, never self-reported.</span>}>
            <table className="w-full text-xs">
              <tbody>
                {p.fields.map((f) => (
                  <tr key={f.key} className="border-t border-slate-100 align-top">
                    <td className="py-1 pr-2 text-slate-600">{f.label}</td>
                    <td className="py-1 pr-2 font-medium">{f.value === null ? <span className="text-slate-400">blank</span> : unmask(f.value)}</td>
                    <td className="py-1 pr-2">
                      <SourceTag source={f.source} document={f.document} />
                      {f.page ? <span className="ml-1 text-slate-400">p.{f.page}</span> : null}
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap" title={f.basis}>
                      {f.confidence === null ? <span className="text-slate-400">n/a</span> : <span className={f.confidence < 0.8 ? "font-semibold text-amber-700" : ""}>{pct(f.confidence)}</span>}
                    </td>
                    <td className="py-1">
                      {f.reread && (
                        <button onClick={() => setCrop(crop === f.key ? null : f.key)} className="rounded border border-slate-200 bg-white px-1.5 text-[11px] hover:bg-slate-50">
                          re-read: OCR “{f.reread.ocrText ?? "blank"}” → vision “{f.reread.visionValue ?? "blank"}” {f.reread.agreed === null ? "" : f.reread.agreed ? "agree" : "differ"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {crop && (() => {
              const f = p.fields.find((x) => x.key === crop)!;
              const r = f.reread!;
              return (
                <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                  <div className="mb-1 text-xs text-slate-600">
                    Page {r.page} of {f.document}: what the vision re-read looked at. {r.codeCheck ? `Code check: ${r.codeCheck}.` : ""}
                  </div>
                  <div className="relative inline-block max-w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrl(row.claimId, r.pageImage)} alt={`Page ${r.page}`} className="max-h-[520px] w-auto border border-slate-200" />
                    {r.region && <div className="absolute border-2 border-red-500" style={{ left: `${r.region.x * 100}%`, top: `${r.region.y * 100}%`, width: `${r.region.w * 100}%`, height: `${r.region.h * 100}%` }} />}
                  </div>
                </div>
              );
            })()}
          </Section>

          {p.timeline.length > 0 && (
            <Section title="Timeline">
              <ol className="space-y-0.5 text-xs">
                {p.timeline.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-36 shrink-0 font-mono text-slate-500">{t.at}</span>
                    <span>
                      {t.event} <SourceTag source={t.source} document={t.document} />
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {row.photos.length > 0 && (
            <Section title="Photos">
              <div className="flex flex-wrap gap-2">
                {row.photos.map((ph) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={ph} href={fileUrl(row.claimId, ph)} target="_blank" rel="noreferrer"><img src={fileUrl(row.claimId, ph)} alt={ph} className="h-28 rounded border border-slate-200 object-cover" /></a>
                ))}
              </div>
            </Section>
          )}

          <Section
            title="Agent trace"
            aside={
              <button onClick={() => setShowTrace(!showTrace)} className="text-[11px] text-blue-700 underline">
                {showTrace ? "hide" : `show ${p.trace.length} tool calls`}
              </button>
            }
          >
            {showTrace && (
              <table className="w-full text-xs">
                <tbody>
                  {p.trace.map((t) => (
                    <tr key={t.step} className="border-t border-slate-100 align-top">
                      <td className="py-1 pr-2 text-slate-400">{t.step}</td>
                      <td className="py-1 pr-2 font-mono">{t.tool}</td>
                      <td className="py-1 pr-2 font-mono text-slate-500">{t.args}</td>
                      <td className="py-1 pr-2">{t.result}</td>
                      <td className="py-1 whitespace-nowrap text-slate-400">{t.durationMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-1 text-[11px] text-slate-500">
              Model {p.model.served ?? p.model.requested} · prompt {p.model.promptVersion} · {p.model.agentVersion} · generated {when(p.generatedAt)} · input hash {p.inputHash.slice(0, 12)}… · {row.packet ? `$${row.packet.usage.costUsd.toFixed(3)}, ${(row.packet.usage.durationMs / 1000).toFixed(0)} s` : ""}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function RouteBox({ decision }: { decision: Decision }) {
  return (
    <div className="mb-4 rounded border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <RouteChip route={decision.route} />
        <span className="text-sm text-slate-700">{ROUTE_MEANING[decision.route as FinalRoute]}</span>
      </div>
      {decision.reasons.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm">
          {decision.reasons.map((r) => (
            <li key={r.id} className="flex gap-2">
              <span className="w-7 shrink-0 font-mono text-xs text-slate-500">{r.id}</span>
              <span>
                <strong>{r.title}.</strong> {r.reason}
                {r.evidence ? <span className="text-slate-500"> (“{r.evidence}”)</span> : null}
                <a href={`/rules#${r.id}`} className="ml-1 text-xs text-blue-700 underline">rule</a>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-sm text-slate-600">No rule fired. The route is the agent's recommendation, unchanged.</div>
      )}
      <div className="mt-2 text-[11px] text-slate-500">{decision.humanDecision}</div>
    </div>
  );
}

function TodayBox({ row }: { row: ClaimRow }) {
  if (row.todayFlagged === null) return null;
  return (
    <div className="mb-5 rounded border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600">
      <strong>Today:</strong> ClaimsPro's flag puts this claim in the <strong>{row.todayQueue}</strong> queue{row.header.complexity ? ` (complexity ${row.header.complexity})` : ""}. The prototype's route is shown above; the two can differ, and the person decides either way.
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[11px] text-slate-500">{note}</div>
    </div>
  );
}

function Quote({ q }: { q: { source: "claimspro" | "snowflake" | "databricks" | "vision" | "code"; document: string | null; quote: string } }) {
  return (
    <div className="rounded bg-slate-50 px-2 py-1 text-xs">
      <div className="text-slate-700">“{q.quote}”</div>
      <SourceTag source={q.source} document={q.document} />
    </div>
  );
}

function fieldConfidenceText(fields: ClaimRow["packet"] extends null ? never : NonNullable<ClaimRow["packet"]>["packet"]["fields"]) {
  const measured = fields.filter((f) => f.confidence !== null);
  if (!measured.length) return "n/a";
  const mean = measured.reduce((a, f) => a + f.confidence!, 0) / measured.length;
  return pct(mean);
}
function rereadText(fields: NonNullable<ClaimRow["packet"]>["packet"]["fields"]) {
  const measured = fields.filter((f) => f.confidence !== null);
  const rereads = fields.filter((f) => f.reread);
  const weakest = measured.reduce<(typeof measured)[number] | null>((w, f) => (w === null || f.confidence! < w.confidence! ? f : w), null);
  const parts = [`${measured.length} measured fields`];
  if (weakest) parts.push(`weakest ${weakest.label} ${pct(weakest.confidence)}`);
  if (rereads.length) parts.push(`${rereads.filter((f) => f.reread!.agreed).length} of ${rereads.length} re-reads agree`);
  return parts.join(" · ");
}

/** A drafted request for the missing items. Sending goes through the ClaimsPro write stub; nothing decides the claim. */
function RequestDraft({ row, unmask }: { row: ClaimRow; unmask: (s: string) => string }) {
  const p = row.packet!.packet;
  const fromClaimant = p.missing.filter((m) => m.from !== "internal");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const body = `Dear ${unmask(p.header.claimantToken ?? p.header.policyholderToken)},\n\nTo continue with claim ${row.claimId} we need:\n${fromClaimant.map((m) => `- ${m.label}: ${m.why}`).join("\n")}\n\nYou can reply to this message or upload the documents through the portal.\n\nMeridian Claims`;
  if (!fromClaimant.length) return null;
  const send = async () => {
    setBusy(true);
    const res = await fetch("/api/writes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "send_correspondence", claimId: row.claimId, payload: { to: p.header.claimantToken ? "claimant" : "policyholder", channel: "portal", subject: `Information needed for claim ${row.claimId}`, body } }) });
    const j = (await res.json()) as { ok: boolean; entry?: { id: string; soap: string }; error?: string };
    setSent(j.ok ? `Logged as ClaimsPro ${j.entry!.soap} (${j.entry!.id}). This is a stub: nothing left the building.` : j.error ?? "Failed");
    setBusy(false);
  };
  return (
    <div className="mt-2 rounded border border-slate-200 bg-white p-2">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Drafted request (the adjuster sends it)</div>
      <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{body}</pre>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={send} disabled={busy || sent !== null} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-50">
          Send via ClaimsPro (stub)
        </button>
        {sent && <span className="text-xs text-slate-600">{sent}</span>}
      </div>
    </div>
  );
}
