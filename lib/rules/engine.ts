// Runs the routing protocol over one claim. Pure and deterministic: the same
// inputs always give the same decision. The agent's route goes in; the final
// route, the segment and the reasons come out. Rules only ever make the route
// more conservative.

import { ROUTE_LABELS, ROUTE_ORDER, type FinalRoute, type Route } from "../claim/schema.ts";
import { moreConservative, PROTOCOL_VERSION, RULES, type Rule, type RuleGroup, type RuleInput, type RuleScope, type Settings, type SourceKey } from "./protocol.ts";

export type Segment = "regulatory" | "senior" | "waiting" | "ready";

export const SEGMENT_LABELS: Record<Segment, string> = {
  regulatory: "Regulatory review",
  senior: "Needs a senior",
  waiting: "Waiting on information",
  ready: "Ready to decide",
};

export const SEGMENT_ORDER: Segment[] = ["regulatory", "senior", "waiting", "ready"];

export interface RuleResult {
  id: string;
  title: string;
  group: RuleGroup;
  tier: "locked" | "configurable";
  scope: RuleScope;
  floor: FinalRoute;
  fired: boolean;
  skipped: boolean;
  reason?: string;
  evidence?: string;
  uses: SourceKey[];
}

export interface Decision {
  protocolVersion: string;
  settings: Settings;
  /** What the agent recommended, before the rules. Null when there was no packet. */
  agentRoute: Route | null;
  route: FinalRoute;
  routeLabel: string;
  /** True when the rules moved the route. */
  escalatedByRules: boolean;
  segment: Segment;
  segmentLabel: string;
  /** A locked state, amount or scope rule fired. */
  regulatory: boolean;
  /** Fired rules, most conservative first. These are the reasons shown to the adjuster. */
  reasons: RuleResult[];
  /** Every rule, fired or not. */
  ruleResults: RuleResult[];
  humanDecision: string;
}

export const HUMAN_DECISION = "Every route ends with a person deciding in ClaimsPro. The AI recommends; it never approves and never denies.";

export interface DecideOptions {
  /** Run only the structured rules (the rules-only evaluation on the extract). Packet rules are marked skipped. */
  structuredOnly?: boolean;
}

export function decide(input: RuleInput, settings: Settings, opts: DecideOptions = {}): Decision {
  const firedSoFar: string[] = [];
  const ruleResults: RuleResult[] = [];
  let floor: FinalRoute = "ready_to_decide";

  for (const rule of RULES) {
    const skipped = Boolean(opts.structuredOnly && rule.scope === "packet");
    const hit = skipped ? null : rule.check({ input, settings, firedSoFar });
    const ruleFloor = hit?.floor ?? rule.floor;
    ruleResults.push({ id: rule.id, title: rule.title, group: rule.group, tier: rule.tier, scope: rule.scope, floor: ruleFloor, fired: Boolean(hit), skipped, reason: hit?.reason, evidence: hit?.evidence, uses: rule.uses });
    if (!hit) continue;
    firedSoFar.push(rule.id);
    floor = moreConservative(floor, ruleFloor);
  }

  const agentRoute = input.packet?.assembled ? input.packet.agentRoute : null;
  const base: FinalRoute = agentRoute ?? "ready_to_decide";
  // The rules can only move a claim to a more conservative route.
  const route = moreConservative(base, floor);
  const fired = ruleResults.filter((r) => r.fired);
  const reasons = [...fired].sort((a, b) => ROUTE_ORDER[b.floor] - ROUTE_ORDER[a.floor]);
  const regulatory = fired.some((r) => r.group === "regulatory" || r.group === "scope");

  return {
    protocolVersion: PROTOCOL_VERSION,
    settings,
    agentRoute,
    route,
    routeLabel: ROUTE_LABELS[route],
    escalatedByRules: ROUTE_ORDER[route] > ROUTE_ORDER[base],
    segment: segmentFor(route, regulatory),
    segmentLabel: SEGMENT_LABELS[segmentFor(route, regulatory)],
    regulatory,
    reasons,
    ruleResults,
    humanDecision: HUMAN_DECISION,
  };
}

/**
 * The worklist segment, from the route plus the rules that fired.
 *   Regulatory review   a locked state, amount or scope rule fired
 *   Needs a senior      specialist or full review without a regulatory rule
 *   Waiting             a request or a document check
 *   Ready to decide     ready
 */
export function segmentFor(route: FinalRoute, regulatory: boolean): Segment {
  if (regulatory || route === "out_of_scope") return "regulatory";
  if (route === "specialist_review" || route === "full_review") return "senior";
  if (route === "request_information" || route === "verify_documents") return "waiting";
  return "ready";
}

/** A rule by ID, for the screens. */
export const ruleById = (id: string): Rule | undefined => RULES.find((r) => r.id === id);

export type { FinalRoute, Route, Settings };
