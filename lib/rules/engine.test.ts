import { test } from "node:test";
import assert from "node:assert/strict";

import { ROUTES } from "../claim/schema.ts";
import { decide, segmentFor } from "./engine.ts";
import { clampSettings, CONSENT_STATES, DEFAULT_SETTINGS, RULES, SETTING_DEFS, THRESHOLD_STATES, type PacketView, type RuleInput } from "./protocol.ts";

// --- Fixtures -----------------------------------------------------------------

/** A clean, complete portal collision claim in Florida (like IS-CLM-2025000300). */
const packet = (over: Partial<PacketView> = {}): PacketView => ({
  assembled: true,
  notAssembledReason: null,
  agentRoute: "ready_to_decide",
  completeness: 1,
  missing: [],
  fields: [
    { key: "amount", label: "Claim amount", confidence: null, reread: null },
    { key: "ocr_vehicle_total", label: "Vehicle total", confidence: 0.88, reread: null },
  ],
  contradictions: [],
  denialIndicators: [],
  rationale: "The package is complete and consistent; the adjuster can confirm.",
  ...over,
});

const claim = (over: Partial<RuleInput> = {}): RuleInput => ({
  claimId: "IS-CLM-TEST",
  claimType: "Collision",
  state: "FL",
  country: "US",
  amountUsd: 2825.07,
  regulatoryReviewRequired: false,
  policyStatus: "unknown",
  packet: packet(),
  ...over,
});

const run = (input: RuleInput, settings = DEFAULT_SETTINGS) => decide(input, settings);
const fired = (d: ReturnType<typeof run>) => d.reasons.map((r) => r.id);

// --- The clean claim ----------------------------------------------------------------

test("a complete, consistent portal claim under the ceiling in a non-consent state is ready to decide, and still needs a person", () => {
  const d = run(claim());
  assert.equal(d.route, "ready_to_decide");
  assert.equal(d.routeLabel, "Ready to decide");
  assert.equal(d.segment, "ready");
  assert.deepEqual(fired(d), []);
  assert.equal(d.escalatedByRules, false);
  assert.match(d.humanDecision, /never approves and never denies/);
});

// --- Guardrail ------------------------------------------------------------------------

test("G1: the route enum has no denial, and a rationale that recommends one is set aside and sent to full review", () => {
  assert.ok(!ROUTES.some((r) => /den/i.test(r)));
  const d = run(claim({ packet: packet({ rationale: "The photos show old rust, so this claim should be denied." }) }));
  assert.equal(d.route, "full_review");
  assert.deepEqual(fired(d), ["G1"]);
  assert.match(d.reasons[0].reason!, /must not/);
  assert.equal(run(claim({ packet: packet({ rationale: "A denial indicator was found; a person decides." }) })).route, "ready_to_decide", "naming an indicator is not recommending a denial");
});

// --- Regulatory floors ------------------------------------------------------------------

test("R1: over $10,000 in every human-review state goes to full review; $10,000 exactly does not", () => {
  for (const state of THRESHOLD_STATES) {
    const d = run(claim({ state, amountUsd: 10100 }));
    assert.equal(d.route, "full_review", state);
    assert.ok(fired(d).includes("R1"));
    assert.equal(d.regulatory, true);
    assert.equal(d.segment, "regulatory");
  }
  assert.ok(!fired(run(claim({ state: "FL", amountUsd: 10000 }))).includes("R1"));
  assert.ok(!fired(run(claim({ state: "TX", amountUsd: 50000, regulatoryReviewRequired: false }))).includes("R1"), "not a threshold state");
});

test("R2: a consent state is never ready to decide unless consent is on file", () => {
  for (const state of CONSENT_STATES) {
    const unknown = run(claim({ state, regulatoryReviewRequired: null }));
    assert.equal(unknown.route, "verify_documents", state);
    assert.deepEqual(fired(unknown), ["R2"]);
    assert.equal(unknown.segment, "regulatory");
    assert.match(unknown.reasons[0].reason!, /no consent flag/);
    const required = run(claim({ state, regulatoryReviewRequired: true }));
    assert.equal(required.route, "verify_documents");
    const consented = run(claim({ state, regulatoryReviewRequired: false }));
    assert.equal(consented.route, "ready_to_decide", `${state} with consent on file`);
  }
});

test("R3: a Canadian policyholder is out of scope whatever else the packet says", () => {
  const d = run(claim({ country: "CA", packet: packet({ agentRoute: "ready_to_decide" }) }));
  assert.equal(d.route, "out_of_scope");
  assert.equal(d.routeLabel, "Out of scope");
  assert.equal(d.segment, "regulatory");
  assert.ok(fired(d).includes("R3"));
});

// --- Denial indicators -----------------------------------------------------------------

test("D1: any denial indicator in the packet goes to full review, and the reason says a person decides", () => {
  for (const kind of ["pre_existing_damage", "policy_lapse", "filing_deadline", "fraud_signal"] as const) {
    const d = run(claim({ packet: packet({ agentRoute: "verify_documents", denialIndicators: [{ kind, evidence: "test" }] }) }));
    assert.equal(d.route, "full_review", kind);
    assert.ok(fired(d).includes("D1"));
    assert.match(d.reasons.find((r) => r.id === "D1")!.reason!, /never recommends a denial/);
  }
});

test("D0: a policy that the record shows lapsed at the date of loss goes to full review even if the agent missed it, with or without a packet", () => {
  const d = run(claim({ policyStatus: "lapsed" }));
  assert.equal(d.route, "full_review");
  assert.ok(fired(d).includes("D0"));
  assert.match(d.reasons.find((r) => r.id === "D0")!.evidence!, /not in force/);
  const structured = decide(claim({ policyStatus: "lapsed", packet: null }), DEFAULT_SETTINGS, { structuredOnly: true });
  assert.equal(structured.route, "full_review");
  assert.ok(fired(structured).includes("D0"));
});

// --- Evidence -----------------------------------------------------------------------------

test("E1: with no packet the claim is worked as today: verify documents, or the regulatory route if one applies", () => {
  const none = run(claim({ packet: null }));
  assert.equal(none.route, "verify_documents");
  assert.deepEqual(fired(none), ["E1"]);
  assert.equal(none.agentRoute, null);
  assert.equal(none.segment, "waiting");
  const failed = run(claim({ packet: packet({ assembled: false, notAssembledReason: "The AI service timed out." }) }));
  assert.equal(failed.route, "verify_documents");
  assert.match(failed.reasons[0].reason!, /timed out/);
  const big = run(claim({ packet: null, state: "NY", amountUsd: 59533.85 }));
  assert.equal(big.route, "full_review");
  assert.equal(big.segment, "regulatory");
});

test("E2: a material contradiction needs a person; an immaterial one does not change the route", () => {
  const material = run(claim({ packet: packet({ contradictions: [{ topic: "Estimate dated before the date of loss", material: true }] }) }));
  assert.equal(material.route, "verify_documents");
  assert.deepEqual(fired(material), ["E2"]);
  const minor = run(claim({ packet: packet({ contradictions: [{ topic: "Street name garbled in the transcript", material: false }] }) }));
  assert.equal(minor.route, "ready_to_decide");
});

// --- Operating settings ------------------------------------------------------------------

test("C1: over the simple-claim ceiling goes to specialist review, and the ceiling is a setting", () => {
  const d = run(claim({ amountUsd: 6200 }));
  assert.equal(d.route, "specialist_review");
  assert.equal(d.segment, "senior");
  assert.deepEqual(fired(d), ["C1"]);
  assert.equal(d.regulatory, false);
  const relaxed = run(claim({ amountUsd: 6200 }), clampSettings({ simpleClaimCeilingUsd: 7500 }));
  assert.equal(relaxed.route, "ready_to_decide");
});

test("C2: below the completeness minimum the claim waits on a request when the missing item can be asked for, else on a document check", () => {
  const ask = run(claim({ packet: packet({ completeness: 0.8, missing: [{ id: "repair_estimate", label: "Repair estimate", from: "provider" }] }) }));
  assert.equal(ask.route, "request_information");
  assert.equal(ask.segment, "waiting");
  assert.match(ask.reasons[0].reason!, /80% of the checklist/);
  const internal = run(claim({ packet: packet({ completeness: 0.8, missing: [{ id: "vehicle_identified", label: "Insured vehicle identified", from: "internal" }] }) }));
  assert.equal(internal.route, "verify_documents");
  const lenient = run(claim({ packet: packet({ completeness: 0.8, missing: [{ id: "repair_estimate", label: "Repair estimate", from: "provider" }] }) }), clampSettings({ minCompletenessPct: 75 }));
  assert.equal(lenient.route, "ready_to_decide");
});

test("C3: a weak field is only trusted after a re-read that agrees", () => {
  const weak = { key: "ocr_line_1", label: "Line 1: Bumper cover rear", confidence: 0.35 };
  const notReread = run(claim({ packet: packet({ fields: [{ ...weak, reread: null }] }) }));
  assert.equal(notReread.route, "verify_documents");
  assert.deepEqual(fired(notReread), ["C3"]);
  const disagreed = run(claim({ packet: packet({ fields: [{ ...weak, reread: { agreed: false } }] }) }));
  assert.equal(disagreed.route, "verify_documents");
  const confirmed = run(claim({ packet: packet({ fields: [{ ...weak, reread: { agreed: true } }] }) }));
  assert.equal(confirmed.route, "ready_to_decide");
  const lowerBar = run(claim({ packet: packet({ fields: [{ key: "x", label: "x", confidence: 0.7, reread: null }] }) }), clampSettings({ ocrRereadThreshold: 0.6 }));
  assert.equal(lowerBar.route, "ready_to_decide");
});

// --- Ordering ------------------------------------------------------------------------------

test("the rules only ever make a route more conservative: the agent's route is kept when it is already the more cautious", () => {
  const d = run(claim({ packet: packet({ agentRoute: "specialist_review" }) }));
  assert.equal(d.route, "specialist_review", "no rule fired, the agent's route stands");
  assert.equal(d.escalatedByRules, false);
  const e = run(claim({ packet: packet({ agentRoute: "specialist_review", completeness: 0.5, missing: [{ id: "x", label: "x", from: "claimant" }] }) }));
  assert.equal(e.route, "specialist_review", "C2's request_information floor is below the agent's route");
  const f = run(claim({ amountUsd: 20000, state: "CA", packet: packet({ agentRoute: "request_information" }) }));
  assert.equal(f.route, "full_review");
  assert.equal(f.escalatedByRules, true);
});

test("when several rules fire, the most conservative floor wins and the reasons list it first", () => {
  const d = run(claim({ state: "TX", regulatoryReviewRequired: null, amountUsd: 20000, packet: packet({ denialIndicators: [{ kind: "fraud_signal", evidence: "photo matches a prior claim" }] }) }));
  assert.equal(d.route, "full_review");
  assert.equal(d.reasons[0].id, "D1");
  assert.deepEqual(fired(d).sort(), ["C1", "D1", "R2"]);
  assert.equal(d.segment, "regulatory");
});

test("segments follow the route plus whether a regulatory rule fired", () => {
  assert.equal(segmentFor("full_review", true), "regulatory");
  assert.equal(segmentFor("verify_documents", true), "regulatory");
  assert.equal(segmentFor("full_review", false), "senior");
  assert.equal(segmentFor("specialist_review", false), "senior");
  assert.equal(segmentFor("request_information", false), "waiting");
  assert.equal(segmentFor("verify_documents", false), "waiting");
  assert.equal(segmentFor("ready_to_decide", false), "ready");
  assert.equal(segmentFor("out_of_scope", false), "regulatory");
});

test("structured-only mode runs the state, amount and scope rules and marks the packet rules skipped", () => {
  const d = decide(claim({ packet: null, state: "NY", amountUsd: 12000 }), DEFAULT_SETTINGS, { structuredOnly: true });
  assert.equal(d.route, "full_review");
  assert.ok(d.ruleResults.filter((r) => r.scope === "packet").every((r) => r.skipped && !r.fired));
  const clean = decide(claim({ packet: null }), DEFAULT_SETTINGS, { structuredOnly: true });
  assert.equal(clean.route, "ready_to_decide");
});

// --- Protocol hygiene --------------------------------------------------------------------------

test("settings are always kept inside their bounds", () => {
  const s = clampSettings({ simpleClaimCeilingUsd: 999999, minCompletenessPct: 10, ocrRereadThreshold: 2 });
  assert.equal(s.simpleClaimCeilingUsd, 10000);
  assert.equal(s.minCompletenessPct, 50);
  assert.equal(s.ocrRereadThreshold, 0.95);
  assert.deepEqual(clampSettings({}), DEFAULT_SETTINGS);
});

test("every rule has a unique ID, a tier, a scope, plain-language text, named sources, and a test above", () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of RULES) {
    assert.ok(r.title.length > 3 && r.when.length > 20, r.id);
    assert.ok(r.uses.length > 0, r.id);
    assert.ok(["locked", "configurable"].includes(r.tier));
    assert.ok(["structured", "packet"].includes(r.scope));
    if (r.tier === "configurable") assert.ok(r.settings && r.settings.length > 0, `${r.id} should name its setting`);
  }
  assert.deepEqual(ids, ["G1", "R1", "R2", "R3", "D0", "D1", "E1", "E2", "C1", "C2", "C3"]);
  for (const def of SETTING_DEFS) assert.ok(RULES.some((r) => r.settings?.includes(def.key)), `setting ${def.key} is used by a rule`);
});

test("protocol text has no em dashes", () => {
  const text = JSON.stringify([RULES.map((r) => [r.title, r.when]), SETTING_DEFS]);
  assert.ok(!text.includes("—") && !text.includes("–"));
});
