"use client";

// The middle column: the packet for one claim, in the order an adjuster reads
// it. The route and why, the rationale, what is missing (with the drafted
// request), what the rules and the agent found, the evidence, the fields with
// their sources, the timeline, the three measured confidence numbers, the
// trace. The action bar at the bottom is where a person confirms.

import { useState } from "react";

import { DENIAL_INDICATOR_LABELS, ROUTE_LABELS, ROUTE_MEANING } from "@/lib/claim/schema.ts";
import type { Decision } from "@/lib/rules/engine.ts";
import type { ClaimRow } from "@/lib/ui/workspace-data.ts";
import { RoutePill, SourceTag, pct, when } from "./ui";
import type { Shown } from "./Viewer";

export interface PacketPanelProps {
  row: ClaimRow;
  decision: Decision;
  apiKey: boolean;
  model: string;
  rerun: { running: boolean; error: string | null };
  onRerun: () => void;
  onOpenAudit: (mode: "view" | "confirm" | "change") => void;
  onFocus: (s: Shown | null) => void;
}

export function PacketPanel({ row, decision, apiKey, model, rerun, onRerun, onOpenAudit, onFocus }: PacketPanelProps) {
  const p = row.packet?.packet ?? null;
  const last = row.audit[row.audit.length - 1] ?? null;
  const reviewed = last?.humanReviewed ? last : null;
  const unmask = (s: string) => row.names.reduce((t, n) => t.split(n.token).join(n.name), s);
  const fired = decision.reasons;
  const material = p?.contradictions.filter((c) => c.material) ?? [];
  const minor = p?.contradictions.filter((c) => !c.material) ?? [];

  // The short list a person reads first: one line per thing that needs them,
  // grouped so the same thing is not said twice (the indicators stand for rule D1,
  // the contradictions for E2, the missing items for C2).
  const attention: { text: string; tone: "bad" | "warn" | "info" }[] = [];
  for (const r of fired) {
    if (p && ["D1", "E2", "C2", "C3"].includes(r.id)) continue;
    attention.push({ text: `${r.title}. ${r.reason}`, tone: r.floor === "full_review" || r.floor === "out_of_scope" ? "bad" : "warn" });
  }
  if (p) {
    const byKind = new Map<string, number>();
    for (const d of p.denialIndicators) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);
    for (const [kind, n] of byKind) {
      const first = p.denialIndicators.find((d) => d.kind === kind)!;
      attention.push({ text: `${DENIAL_INDICATOR_LABELS[kind as keyof typeof DENIAL_INDICATOR_LABELS]}${n > 1 ? ` (${n} sources)` : ""}: ${firstSentence(first.evidence)}`, tone: "bad" });
    }
    if (material.length) attention.push({ text: `Sources disagree on ${material.length === 1 ? "one point" : `${material.length} points`}: ${material.map((c) => c.topic.toLowerCase()).slice(0, 2).join("; ")}${material.length > 2 ? "; and more below" : ""}`, tone: "warn" });
    if (p.missing.length) attention.push({ text: `Missing: ${p.missing.map((m) => m.label.toLowerCase()).join(", ")}`, tone: "warn" });
    const weak = fired.find((r) => r.id === "C3");
    if (weak) attention.push({ text: `OCR fields read below the threshold and not confirmed by a re-read`, tone: "warn" });
  }

  return (
    <>
      <div className="assess-scroll reading">
        <div className={`banner route-${decision.route}`}>
          <div className="banner-top">
            <span className="banner-label">Recommended route</span>
            <div className="banner-links">
              <a className="btn btn-sm btn-ghost" href="/rules">Protocol {decision.protocolVersion}</a>
              <button className="btn btn-sm btn-ghost" onClick={() => onOpenAudit("view")}>Audit record</button>
            </div>
          </div>
          <h2>{ROUTE_LABELS[decision.route]}</h2>
          <div className="banner-why">{ROUTE_MEANING[decision.route]}</div>
          <div className="banner-flags">
            {p?.agentRoute && (decision.escalatedByRules ? <span className="chip chip-warn">Agent said {ROUTE_LABELS[p.agentRoute].toLowerCase()}; a rule moved it</span> : <span className="chip chip-ok">Agent and rules agree</span>)}
            {reviewed && <span className="chip chip-ok">Confirmed by {reviewed.reviewer}</span>}
            {!p && <span className="chip">{row.documentCount === 0 ? "Structured rules only" : "Not run yet"}</span>}
          </div>
        </div>

        {rerun.error && <div className="err">{rerun.error}</div>}

        {!p && (
          <div className="failure">
            <b>No packet.</b>{" "}
            {row.documentCount === 0
              ? "This claim comes from the extract: a structured row, no documents. The structured rules ran; the packet rules could not. It is worked as today, by a person."
              : "The agent has not run on this claim. The structured rules alone put it where it is; run it to assemble the packet."}
          </div>
        )}
        {p && p.status === "not_assembled" && (
          <div className="failure">
            <b>Packet not assembled.</b> {p.notAssembledReason} Manual triage: a person works this claim from the documents. Nothing was guessed.
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <h3>{attention.length ? "What needs a person" : "Nothing needs a person"}</h3>
            <span className="sub">{attention.length ? `${attention.length} item${attention.length === 1 ? "" : "s"}` : "complete, consistent, under the ceiling"}</span>
          </div>
          <div className="card-body">
            {attention.length ? (
              <ul className="attention">
                {attention.map((a, i) => (
                  <li key={i} className={`tone-${a.tone}`}><span className="dot" /><span>{a.text}</span></li>
                ))}
              </ul>
            ) : (
              <div className="reason-text">{p ? "The packet is complete and consistent, the amount is under the ceiling, and the state has no floor. The route is the agent's recommendation." : "Nothing in the structured record triggers a floor."}</div>
            )}
            <div className="note">{decision.humanDecision}</div>
          </div>
        </div>

        {p && (
          <>
            <div className="card">
              <div className="card-head"><h3>In short</h3><span className="sub">Written for a regulator</span></div>
              <div className="card-body">
                <Rationale text={p.rationale} />
              </div>
            </div>

            {p.missing.length > 0 && <MissingCard row={row} decision={decision} unmask={unmask} open={decision.route === "request_information"} />}

            <Fold title="Why each rule fired" count={fired.length} hint="The rules run after the agent and only make the route more conservative">
              {fired.length === 0 ? (
                <div className="reason-text">No rule fired.</div>
              ) : (
                <ul className="reasons">
                  {fired.map((r) => (
                    <li key={r.id} className={`reason route-${r.floor}`}>
                      <span className="dot" />
                      <div>
                        <span className="reason-title">{r.title}</span>
                        <span className="rid">{r.id}</span>
                        <div className="reason-text">{r.reason}</div>
                        {r.evidence && <div className="reason-evidence">Seen: {r.evidence}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Fold>

            {p.denialIndicators.length > 0 && (
              <Fold title="Denial indicators" count={p.denialIndicators.length} hint="Flagged with evidence; a person weighs them. The AI never recommends a denial.">
                <ul className="reasons">
                  {p.denialIndicators.map((d, i) => (
                    <li key={i} className="reason route-full_review">
                      <span className="dot" />
                      <div>
                        <span className="reason-title">{DENIAL_INDICATOR_LABELS[d.kind]}</span>
                        <div className="reason-text">{d.evidence}</div>
                        <SourceTag source={d.source} document={d.document} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Fold>
            )}

            {p.contradictions.length > 0 && (
              <Fold title="Where the sources disagree" count={p.contradictions.length} hint={`${material.length} material, ${minor.length} not blocking`}>
                {[...material, ...minor].map((c, i) => (
                  <div key={i} className="contra">
                    <div className="contra-top">
                      {c.topic}
                      <span className={`chip ${c.material ? "chip-bad" : ""}`}>{c.material ? "material" : "not blocking"}</span>
                    </div>
                    <div className="quotes">
                      <div className="quote"><div className="q">“{c.a.quote}”</div><SourceTag source={c.a.source} document={c.a.document} /></div>
                      <div className="quote"><div className="q">“{c.b.quote}”</div><SourceTag source={c.b.source} document={c.b.document} /></div>
                    </div>
                    {c.note && <div className="note">{c.note}</div>}
                  </div>
                ))}
              </Fold>
            )}

            <Fold title="Evidence checklist" count={`${p.evidence.filter((e) => e.present).length} of ${p.evidence.length}`} hint={pct(p.completeness)}>
              <ul className="checklist">
                {p.evidence.map((e) => (
                  <li key={e.id}>
                    <span className={e.present ? "tick" : "cross"}>{e.present ? "✓" : "✗"}</span>
                    <span>
                      {e.label}{" "}
                      {e.present ? <SourceTag source={e.source} document={e.document} /> : <span style={{ color: "var(--text-3)" }}>{e.note ?? "not on file"}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Fold>

            <Fold title="Fields, with sources" count={p.fields.length} hint="Hover a source for the system it is read from. Confidence is measured, never self-reported." flush>
              <table className="t">
                <thead><tr><th>Field</th><th>Value</th><th>Source</th><th>Conf.</th><th>Re-read</th></tr></thead>
                <tbody>
                  {p.fields.map((f) => (
                    <tr key={f.key}>
                      <td style={{ color: "var(--text-2)" }}>{f.label}</td>
                      <td style={{ fontWeight: 600 }}>{f.value === null ? <span style={{ color: "var(--text-3)", fontWeight: 400, fontStyle: "italic" }}>blank</span> : unmask(f.value)}</td>
                      <td><SourceTag source={f.source} document={f.document} page={f.page} /></td>
                      <td title={f.basis} style={{ whiteSpace: "nowrap" }}>{f.confidence === null ? <span style={{ color: "var(--text-3)" }}>n/a</span> : <span className={f.confidence < p.settingsUsed.ocrRereadThreshold ? "weak" : ""}>{pct(f.confidence)}</span>}</td>
                      <td>
                        {f.reread && (
                          <button className="btn btn-sm" onClick={() => onFocus({ path: f.reread!.pageImage, label: `${f.document ?? "page"} p.${f.reread!.page}`, region: f.reread!.region, tag: `Re-read: ${f.label}` })} title="Show the page the vision re-read looked at">
                            OCR “{f.reread.ocrText ?? "blank"}” → vision “{f.reread.visionValue ?? "blank"}” · {f.reread.agreed === null ? "nothing to compare" : f.reread.agreed ? "agree" : "differ"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Fold>

            {p.timeline.length > 0 && (
              <Fold title="Timeline" count={p.timeline.length} hint="From every source, in order">
                <ul className="timeline">
                  {p.timeline.map((t, i) => (
                    <li key={i}><span className="at">{t.at}</span><span>{t.event} <SourceTag source={t.source} document={t.document} /></span></li>
                  ))}
                </ul>
              </Fold>
            )}

            <Fold title="Confidence" hint="Three measured numbers. None is a model's opinion of itself.">
              <div className="stats3">
                <Stat label="Per-field extraction" value={fieldMean(p.fields)} note={fieldNote(p.fields)} />
                <Stat label="Evidence completeness" value={pct(p.completeness)} note={`${p.evidence.filter((e) => e.present).length} of ${p.evidence.length} checklist items`} />
                <Stat label="Route confidence" value={last?.confidence.route.value === null || !last ? "Not yet measured" : pct(last.confidence.route.value)} note={last?.confidence.route.basis ?? "The packet evaluation has not run."} />
              </div>
            </Fold>

            <Fold title="Agent trace" count={p.trace.length} hint={`${p.model.served ?? p.model.requested} · prompt ${p.model.promptVersion} · ${when(p.generatedAt)} · ${row.packet ? `$${row.packet.usage.costUsd.toFixed(2)}, ${(row.packet.usage.durationMs / 1000).toFixed(0)} s` : ""} · input hash ${p.inputHash.slice(0, 10)}…`} flush>
              <table className="t">
                <thead><tr><th>#</th><th>Tool</th><th>Args</th><th>Result</th><th>ms</th></tr></thead>
                <tbody>
                  {p.trace.map((t) => (
                    <tr key={t.step}><td>{t.step}</td><td className="mono">{t.tool}</td><td className="mono" style={{ color: "var(--text-3)" }}>{t.args}</td><td>{t.result}</td><td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>{t.durationMs}</td></tr>
                  ))}
                </tbody>
              </table>
            </Fold>
          </>
        )}

        {row.todayFlagged !== null && (
          <div className="today">
            <b>Today:</b> ClaimsPro's flag puts this claim in the <b>{row.todayQueue}</b> queue{row.header.complexity ? ` (complexity ${row.header.complexity})` : ""}. Where the two differ, a person decides either way.
          </div>
        )}
      </div>

      <div className="actionbar">
        {reviewed ? (
          <div className="done-banner">
            Confirmed by {reviewed.reviewer} at {when(reviewed.reviewedAt ?? "")}: {ROUTE_LABELS[reviewed.reviewerRoute ?? reviewed.output.route]}
            {reviewed.reviewerReason ? ` — “${reviewed.reviewerReason}”` : ""}. The decision itself is made in ClaimsPro.
          </div>
        ) : (
          <div className="note" style={{ marginTop: 0 }}>A person confirms the route or changes it with a reason. Every change becomes a test case. Nothing here approves or denies a claim.</div>
        )}
        <div className="actionbar-row">
          <button className="btn btn-primary" disabled={!last || !!reviewed} onClick={() => onOpenAudit("confirm")} title={!last ? "No packet to confirm" : reviewed ? "Already confirmed; change the route to add a new record" : ""}>
            {reviewed ? `Confirmed: ${ROUTE_LABELS[reviewed.reviewerRoute ?? reviewed.output.route]}` : `Confirm route: ${ROUTE_LABELS[decision.route]}`}
          </button>
          <button className="btn" disabled={!last} onClick={() => onOpenAudit("change")}>Change route…</button>
          <button className="btn" onClick={onRerun} disabled={!apiKey || rerun.running || row.documentCount === 0 || row.header.country === "CA"} title={!apiKey ? "No API key. Re-run is disabled." : row.documentCount === 0 ? "No documents to read" : row.header.country === "CA" ? "Canadian policyholder: never sent to the model" : `Run the agent again with ${model}`}>
            {rerun.running ? "Running…" : p ? "Re-run" : "Run the agent"}
          </button>
        </div>
      </div>
    </>
  );
}

/** Sentences split at a full stop followed by a space and a capital, so file names and decimals stay whole. */
const sentencesOf = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
const firstSentence = (s: string) => sentencesOf(s)[0]?.trim() ?? s;

/** A card that opens on demand. Everything inside is still one click away; the page reads short by default. */
function Fold({ title, count, hint, flush, open, children }: { title: string; count?: number | string; hint?: string; flush?: boolean; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="card fold-card" open={open}>
      <summary className="card-head">
        <h3>
          {title}
          {count !== undefined && <span className="n">{count}</span>}
        </h3>
        <span className="sub">{hint}</span>
      </summary>
      <div className="card-body" style={flush ? { padding: 0 } : undefined}>{children}</div>
    </details>
  );
}

/** The rationale: the first two sentences, then the rest on request. */
function Rationale({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const sentences = sentencesOf(text);
  const short = sentences.slice(0, 2).join(" ").trim();
  const rest = sentences.slice(2).join(" ").trim();
  return (
    <div className="rationale">
      <p>{all || !rest ? text : short}</p>
      {rest && (
        <button className="btn btn-sm btn-ghost" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Read the full rationale (${sentences.length} sentences)`}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="stat"><div className="l">{label}</div><div className="v">{value}</div><div className="d">{note}</div></div>
  );
}

type Fields = NonNullable<ClaimRow["packet"]>["packet"]["fields"];
function fieldMean(fields: Fields) {
  const m = fields.filter((f) => f.confidence !== null);
  return m.length ? pct(m.reduce((a, f) => a + f.confidence!, 0) / m.length) : "n/a";
}
function fieldNote(fields: Fields) {
  const m = fields.filter((f) => f.confidence !== null);
  if (!m.length) return "No OCR or ASR fields on this claim; database fields carry no confidence.";
  const weakest = m.reduce((w, f) => (f.confidence! < w.confidence! ? f : w));
  const rr = fields.filter((f) => f.reread);
  return `${m.length} measured · weakest ${weakest.label} ${pct(weakest.confidence)}${rr.length ? ` · ${rr.filter((f) => f.reread!.agreed).length} of ${rr.length} re-reads agree` : ""}`;
}

/** What is missing, and the drafted request. Sending goes through the ClaimsPro write stub; nothing decides the claim. */
function MissingCard({ row, decision, unmask, open }: { row: ClaimRow; decision: Decision; unmask: (s: string) => string; open: boolean }) {
  const p = row.packet!.packet;
  const external = p.missing.filter((m) => m.from !== "internal");
  const [body, setBody] = useState(
    `Dear ${unmask(p.header.claimantToken ?? p.header.policyholderToken)},\n\nTo continue with claim ${row.claimId} we need:\n${external.map((m) => `- ${m.label}: ${m.why}`).join("\n")}\n\nYou can reply to this message or upload the documents through the portal.\n\nMeridian Claims`,
  );
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const res = await fetch("/api/writes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "send_correspondence", claimId: row.claimId, payload: { to: p.header.claimantToken ? "claimant" : "policyholder", channel: "portal", subject: `Information needed for claim ${row.claimId}`, body } }) });
    const j = (await res.json()) as { ok: boolean; entry?: { id: string; soap: string }; error?: string };
    setSent(j.ok ? `Logged as ClaimsPro ${j.entry!.soap} (${j.entry!.id}). A stub: nothing left the building.` : j.error ?? "Failed");
    setBusy(false);
  };
  return (
    <details className="card fold-card" open={open}>
      <summary className="card-head"><h3>What is missing, and the drafted request<span className="n">{p.missing.length}</span></h3><span className="sub">{decision.route === "request_information" ? "The route asks the claimant for it" : "The route is more conservative; the request can still go"}</span></summary>
      <div className="card-body">
        <ul className="reasons">
          {p.missing.map((m) => (
            <li key={m.id} className="reason route-request_information">
              <span className="dot" />
              <div>
                <span className="reason-title">{m.label}</span> <span className="chip">from the {m.from}</span>
                <div className="reason-text">{m.why}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {external.length > 0 && (
        <div className="card-body">
          <div className="section-label">Drafted request (the adjuster sends it)</div>
          <textarea className="message" value={body} onChange={(e) => setBody(e.target.value)} disabled={sent !== null} />
          <div className="actionbar-row" style={{ marginTop: 8, alignItems: "center" }}>
            <button className="btn btn-sm" onClick={send} disabled={busy || sent !== null}>Send via ClaimsPro (stub)</button>
            {sent && <span className="note" style={{ marginTop: 0 }}>{sent}</span>}
          </div>
        </div>
      )}
    </details>
  );
}
