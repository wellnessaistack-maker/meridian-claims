// Routing protocol v0.1 for Meridian claim readiness.
//
// This file is both the executable rules and the document rendered on the Rules
// page, so the rules a compliance officer reads are the rules the code runs.
// The pattern is borrowed from the Scale prototype's lib/policy/protocol.ts; none
// of the rules are.
//
// The rules run AFTER the agent has assembled the packet and recommended a route.
// They can only move a claim to a more conservative route, never a less
// conservative one, and they can never recommend a denial: the route enum has no
// such value. Every route ends with a person deciding in ClaimsPro.
//
// Two tiers:
//   locked        regulatory floors and guardrails. Changing one is a new protocol
//                 version with compliance sign-off. Not editable in the app.
//   configurable  operating settings with safe bounds, editable by the protocol
//                 owner. Every change is a new version that can be tested first.
//
// Two scopes:
//   structured    needs only ClaimsPro and Snowflake fields, so it can run on the
//                 whole extract (the rules-only evaluation) and on queue entries
//                 that have no packet yet.
//   packet        needs the assembled packet.

import type { ClaimType } from "../extract/csv.ts";
import { ROUTE_ORDER, type DenialIndicatorKind, type FinalRoute, type Route } from "../claim/schema.ts";

export const PROTOCOL_VERSION = "0.1";

/** States that require human review of any claim decision over $10,000. From Michael Torres's systems session; to be confirmed by Meridian Compliance. */
export const THRESHOLD_STATES = ["CA", "NY", "NJ", "FL", "IL", "PA", "OH", "GA", "MD", "MA", "MI", "VA"] as const;
export const THRESHOLD_AMOUNT_USD = 10_000;

/** States that prohibit fully automated adjudication without the policyholder's consent. Consent is not cleanly tracked in ClaimsPro. */
export const CONSENT_STATES = ["AZ", "IN", "MO", "NC", "TN", "TX", "WA", "WI"] as const;

// ---------------------------------------------------------------------------
// Configurable settings
// ---------------------------------------------------------------------------

export interface Settings {
  /** Above this amount a claim is not "simple" and goes to an experienced adjuster. */
  simpleClaimCeilingUsd: number;
  /** Share of the evidence checklist that must be on file before a claim can be ready to decide. */
  minCompletenessPct: number;
  /** OCR confidence below which a field must be re-read from the page image before it is trusted. */
  ocrRereadThreshold: number;
}

export const DEFAULT_SETTINGS: Settings = {
  simpleClaimCeilingUsd: 5000,
  minCompletenessPct: 100,
  ocrRereadThreshold: 0.8,
};

export interface SettingDef {
  key: keyof Settings;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  unit: "usd" | "pct" | "ratio";
}

export const SETTING_DEFS: SettingDef[] = [
  {
    key: "simpleClaimCeilingUsd",
    label: "Simple-claim amount ceiling",
    help: "Claims above this amount are not simple claims and go to specialist review, whatever the packet says. The SOW's under-24-hour target is for simple claims.",
    min: 1000,
    max: 10000,
    step: 250,
    unit: "usd",
  },
  {
    key: "minCompletenessPct",
    label: "Minimum evidence completeness for ready to decide",
    help: "The share of the claim type's checklist that must be on file. Below it, the claim waits for the missing items. 100% means nothing may be missing.",
    min: 50,
    max: 100,
    step: 5,
    unit: "pct",
  },
  {
    key: "ocrRereadThreshold",
    label: "OCR confidence threshold for a re-read",
    help: "A field the OCR engine read below this confidence is re-read from the page image by the vision model. A weak field that was not re-read sends the claim to document verification.",
    min: 0.5,
    max: 0.95,
    step: 0.05,
    unit: "ratio",
  },
];

/** Keep every setting inside its bounds, whatever the UI sends. */
export function clampSettings(input: Partial<Settings>): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const def of SETTING_DEFS) {
    const v = input[def.key];
    if (typeof v === "number" && Number.isFinite(v)) out[def.key] = Math.min(def.max, Math.max(def.min, v));
  }
  return out;
}

// ---------------------------------------------------------------------------
// What a rule can see
// ---------------------------------------------------------------------------

export interface PacketView {
  assembled: boolean;
  notAssembledReason: string | null;
  agentRoute: Route | null;
  completeness: number | null;
  missing: { id: string; label: string; from: "claimant" | "provider" | "internal" }[];
  fields: { key: string; label: string; confidence: number | null; reread: { agreed: boolean | null } | null }[];
  contradictions: { topic: string; material: boolean }[];
  denialIndicators: { kind: DenialIndicatorKind; evidence: string }[];
  rationale: string;
}

export interface RuleInput {
  claimId: string;
  claimType: ClaimType;
  state: string;
  country: "US" | "CA" | "other";
  amountUsd: number | null;
  /** ClaimsPro's or the extract's regulatory flag. Null means unknown. */
  regulatoryReviewRequired: boolean | null;
  policyStatus: "in_force" | "lapsed" | "unknown";
  /** Null when there is no packet at all (an extract row, or the agent never ran). */
  packet: PacketView | null;
}

export interface RuleContext {
  input: RuleInput;
  settings: Settings;
  firedSoFar: string[];
}

export type RuleGroup = "guardrail" | "regulatory" | "scope" | "evidence" | "operating";
export type RuleScope = "structured" | "packet";

export interface RuleHit {
  reason: string;
  evidence?: string;
  /** Overrides the rule's default floor, for example request_information when there is something to ask for. */
  floor?: FinalRoute;
}

export type SourceKey = "claim.state" | "claim.amount" | "claim.country" | "claim.regulatory_flag" | "policy.status" | "packet.route" | "packet.completeness" | "packet.fields" | "packet.contradictions" | "packet.denial_indicators" | "packet.rationale";

export interface Rule {
  id: string;
  group: RuleGroup;
  tier: "locked" | "configurable";
  scope: RuleScope;
  /** The least conservative route a claim may have once this rule fires. */
  floor: FinalRoute;
  title: string;
  /** The rule in plain language, as it appears in the protocol document. */
  when: string;
  settings?: (keyof Settings)[];
  uses: SourceKey[];
  check: (ctx: RuleContext) => RuleHit | null;
}

export const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

const DENIAL_WORDS = /\b(recommend(?:s|ed|ing)?\s+(?:a\s+)?denial|should\s+be\s+denied|deny\s+(?:the|this)\s+claim|denial\s+(?:is\s+)?recommended|recommend(?:s|ed)?\s+(?:to\s+)?deny(?:ing)?)\b/i;

export const RULES: Rule[] = [
  // --- Guardrails ---------------------------------------------------------------
  {
    id: "G1",
    group: "guardrail",
    tier: "locked",
    scope: "packet",
    floor: "full_review",
    title: "The AI never recommends a denial",
    when: "The route enum has no denial value, so the agent cannot return one. If its written rationale nonetheless recommends a denial, the rationale is set aside and the claim goes to full review, where a person decides.",
    uses: ["packet.rationale", "packet.route"],
    check: ({ input }) => {
      const p = input.packet;
      if (!p || !DENIAL_WORDS.test(p.rationale)) return null;
      return { reason: "The AI's rationale recommended a denial. It must not. The rationale is set aside; a person adjudicates in full.", evidence: p.rationale.match(DENIAL_WORDS)?.[0] };
    },
  },

  // --- Regulatory floors (structured: run on every claim, packet or not) ----------
  {
    id: "R1",
    group: "regulatory",
    tier: "locked",
    scope: "structured",
    floor: "full_review",
    title: "Over $10,000 in a human-review state",
    when: `The claim amount is over ${usd(THRESHOLD_AMOUNT_USD)} and the loss state is one of ${THRESHOLD_STATES.join(", ")}. These states require human review of any claim decision over that amount, whatever a system says.`,
    uses: ["claim.state", "claim.amount"],
    check: ({ input }) =>
      input.amountUsd !== null && input.amountUsd > THRESHOLD_AMOUNT_USD && (THRESHOLD_STATES as readonly string[]).includes(input.state)
        ? { reason: `${usd(input.amountUsd)} in ${input.state}: a human must review any decision over ${usd(THRESHOLD_AMOUNT_USD)} in this state.` }
        : null,
  },
  {
    id: "R2",
    group: "regulatory",
    tier: "locked",
    scope: "structured",
    floor: "verify_documents",
    title: "Consent state without consent on file",
    when: `The loss state is one of ${CONSENT_STATES.join(", ")}, which prohibit fully automated adjudication without the policyholder's consent, and the record does not say consent is on file. The claim is never routed ready to decide: an adjuster verifies the packet and decides in full. Consent is not cleanly tracked in ClaimsPro, so an unknown flag counts as no consent.`,
    uses: ["claim.state", "claim.regulatory_flag"],
    check: ({ input }) =>
      (CONSENT_STATES as readonly string[]).includes(input.state) && input.regulatoryReviewRequired !== false
        ? {
            reason:
              input.regulatoryReviewRequired === null
                ? `${input.state} is a consent state and ClaimsPro has no consent flag for this policyholder, so the claim cannot take the fast lane.`
                : `${input.state} is a consent state and the record says a human is required; the claim cannot take the fast lane.`,
          }
        : null,
  },
  {
    id: "R3",
    group: "scope",
    tier: "locked",
    scope: "structured",
    floor: "out_of_scope",
    title: "Canadian policyholder data",
    when: "The policyholder is Canadian. Canadian policyholder data carries residency constraints and the API route is US-East, so the prototype does not process the claim at all. It goes through today's process untouched.",
    uses: ["claim.country"],
    check: ({ input }) => (input.country === "CA" ? { reason: "Canadian policyholder: residency constraints keep this claim out of the AI's scope. Handled as today." } : null),
  },

  // --- Denial indicators (packet) -----------------------------------------------
  {
    id: "D1",
    group: "regulatory",
    tier: "locked",
    scope: "packet",
    floor: "full_review",
    title: "Denial indicator in the packet",
    when: "The packet found pre-existing damage, a policy lapse at the date of loss, a possible missed filing deadline, or a fraud signal (for example a photo that matches a prior claim). Any of these goes to full review. The AI flags the indicator; only a person can act on it.",
    uses: ["packet.denial_indicators", "policy.status"],
    check: ({ input }) => {
      const found = [...(input.packet?.denialIndicators ?? [])];
      if (input.policyStatus === "lapsed" && !found.some((d) => d.kind === "policy_lapse")) found.push({ kind: "policy_lapse", evidence: "Policy record: not in force at the date of loss." });
      if (!found.length) return null;
      return { reason: `${found.length === 1 ? "A denial indicator" : `${found.length} denial indicators`} in the packet: ${found.map((d) => d.kind.replace(/_/g, " ")).join(", ")}. A person adjudicates in full; the AI never recommends a denial.`, evidence: found.map((d) => d.evidence).join(" | ") };
    },
  },

  // --- Evidence (packet) -------------------------------------------------------
  {
    id: "E1",
    group: "evidence",
    tier: "locked",
    scope: "packet",
    floor: "verify_documents",
    title: "Packet not assembled",
    when: "The AI could not assemble the packet (no documents, a model failure, or a timeout). The claim keeps whatever the structured rules say and otherwise goes to document verification: the adjuster works it in ClaimsPro as today. The AI never guesses.",
    uses: ["packet.route"],
    check: ({ input }) => (!input.packet || !input.packet.assembled ? { reason: `Packet not assembled: ${input.packet?.notAssembledReason ?? "no packet for this claim"}. Worked as today.` } : null),
  },
  {
    id: "E2",
    group: "evidence",
    tier: "locked",
    scope: "packet",
    floor: "verify_documents",
    title: "Material contradiction between sources",
    when: "Two sources disagree on something that could change the decision (dates, amounts, what was damaged). Both are quoted in the packet; a person resolves it before the claim can be decided.",
    uses: ["packet.contradictions"],
    check: ({ input }) => {
      const m = input.packet?.contradictions.filter((c) => c.material) ?? [];
      return m.length ? { reason: `${m.length === 1 ? "A material contradiction" : `${m.length} material contradictions`} between sources: ${m.map((c) => c.topic).join("; ")}.` } : null;
    },
  },

  // --- Operating settings (configurable) ----------------------------------------
  {
    id: "C1",
    group: "operating",
    tier: "configurable",
    scope: "structured",
    floor: "specialist_review",
    title: "Over the simple-claim ceiling",
    when: "The claim amount is above the simple-claim ceiling. It is not a simple claim and goes to an experienced adjuster, even if the packet is complete.",
    settings: ["simpleClaimCeilingUsd"],
    uses: ["claim.amount"],
    check: ({ input, settings }) =>
      input.amountUsd !== null && input.amountUsd > settings.simpleClaimCeilingUsd ? { reason: `${usd(input.amountUsd)} is above the ${usd(settings.simpleClaimCeilingUsd)} simple-claim ceiling.` } : null,
  },
  {
    id: "C2",
    group: "operating",
    tier: "configurable",
    scope: "packet",
    floor: "request_information",
    title: "Evidence below the completeness minimum",
    when: "Less of the claim type's checklist is on file than the minimum. If the missing items can be asked for, the claim waits on that request (a message is drafted); otherwise an adjuster verifies what is there.",
    settings: ["minCompletenessPct"],
    uses: ["packet.completeness"],
    check: ({ input, settings }) => {
      const p = input.packet;
      if (!p || !p.assembled || p.completeness === null) return null;
      if (p.completeness * 100 >= settings.minCompletenessPct - 1e-9) return null;
      const askable = p.missing.filter((m) => m.from !== "internal");
      return {
        reason: `${Math.round(p.completeness * 100)}% of the checklist is on file, below the ${settings.minCompletenessPct}% minimum. Missing: ${p.missing.map((m) => m.label).join(", ")}.`,
        floor: askable.length ? "request_information" : "verify_documents",
      };
    },
  },
  {
    id: "C3",
    group: "operating",
    tier: "configurable",
    scope: "packet",
    floor: "verify_documents",
    title: "A weak field that was not confirmed",
    when: "A field was read below the OCR confidence threshold and was not re-read from the page, or the re-read disagreed with the OCR. The field is not trusted; an adjuster checks the document.",
    settings: ["ocrRereadThreshold"],
    uses: ["packet.fields"],
    check: ({ input, settings }) => {
      const p = input.packet;
      if (!p || !p.assembled) return null;
      const weak = p.fields.filter((f) => f.confidence !== null && f.confidence < settings.ocrRereadThreshold && !(f.reread && f.reread.agreed === true));
      return weak.length ? { reason: `${weak.length} field${weak.length === 1 ? "" : "s"} below the ${settings.ocrRereadThreshold} OCR threshold without a confirming re-read: ${weak.map((f) => f.label).join(", ")}.` } : null;
    },
  },
];

export const RULE_GROUP_LABELS: Record<RuleGroup, string> = {
  guardrail: "Guardrail",
  regulatory: "Regulatory floor",
  scope: "Scope",
  evidence: "Evidence",
  operating: "Operating setting",
};

export const SOURCE_KEY_LABELS: Record<SourceKey, string> = {
  "claim.state": "loss state (ClaimsPro)",
  "claim.amount": "claim amount (ClaimsPro / Snowflake)",
  "claim.country": "policyholder country (policy record)",
  "claim.regulatory_flag": "requires-human flag (ClaimsPro / extract)",
  "policy.status": "policy status at date of loss (policy record)",
  "packet.route": "the agent's route",
  "packet.completeness": "evidence completeness (code)",
  "packet.fields": "extracted fields and their measured confidence",
  "packet.contradictions": "contradictions the packet found",
  "packet.denial_indicators": "denial indicators the packet found",
  "packet.rationale": "the agent's written rationale",
};

export const moreConservative = (a: FinalRoute, b: FinalRoute): FinalRoute => (ROUTE_ORDER[a] >= ROUTE_ORDER[b] ? a : b);
