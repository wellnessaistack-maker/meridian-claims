// The ClaimPacket: everything the agent assembled for one claim, as a zod
// schema. This is the contract between the agent, the rules, the audit record
// and the screen. Every value carries where it came from.
//
// Design rule: the route enum has no "deny". The AI can recommend that a person
// decides, asks, verifies or reviews. It cannot recommend that a claim is denied.

import { z } from "zod";

export const ROUTES = ["ready_to_decide", "request_information", "verify_documents", "specialist_review", "full_review"] as const;
export type Route = (typeof ROUTES)[number];
export const routeSchema = z.enum(ROUTES);

/** The rules can also take a claim out of scope entirely (residency). The agent never does. */
export type FinalRoute = Route | "out_of_scope";

export const ROUTE_LABELS: Record<FinalRoute, string> = {
  ready_to_decide: "Ready to decide",
  request_information: "Request information",
  verify_documents: "Verify documents",
  specialist_review: "Specialist review",
  full_review: "Full review",
  out_of_scope: "Out of scope",
};

/** What each route means for the adjuster, in one line. */
export const ROUTE_MEANING: Record<FinalRoute, string> = {
  ready_to_decide: "The packet is complete and consistent. The adjuster confirms the decision in ClaimsPro.",
  request_information: "Something is missing that the claimant or a provider can supply. A message is drafted; the adjuster sends it.",
  verify_documents: "A field or a document needs a person's eyes before the claim can be decided.",
  specialist_review: "The claim needs an experienced adjuster: injury, liability, or an amount over the simple-claim ceiling.",
  full_review: "A person adjudicates in full, with a written justification: a regulatory threshold or a denial indicator.",
  out_of_scope: "The prototype does not handle this claim. It goes through today's process untouched.",
};

/** Conservativeness order. The rules can move a claim right, never left. */
export const ROUTE_ORDER: Record<FinalRoute, number> = {
  ready_to_decide: 0,
  request_information: 1,
  verify_documents: 2,
  specialist_review: 3,
  full_review: 4,
  out_of_scope: 5,
};

export const PROVENANCE_KINDS = ["provided", "variant", "mock", "extract"] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

export const provenanceSchema = z.object({
  kind: z.enum(PROVENANCE_KINDS),
  /** The label shown on the card and in the packet header. */
  label: z.string(),
  /** For variants: the provided claim it was built from, and what changed. */
  parentId: z.string().nullable(),
  change: z.string().nullable(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const SOURCES = ["claimspro", "snowflake", "databricks", "vision", "code"] as const;
export type Source = (typeof SOURCES)[number];
export const sourceSchema = z.enum(SOURCES);

export const SOURCE_LABELS: Record<Source, string> = {
  claimspro: "ClaimsPro",
  snowflake: "Snowflake",
  databricks: "Databricks",
  vision: "Vision re-read",
  code: "Code check",
};

/** In production, where each source is read from. Shown on hover. */
export const SOURCE_SYSTEMS: Record<Source, string> = {
  claimspro: "ClaimsPro REST (system of record: intake, status, documents)",
  snowflake: "Snowflake (claims transactions, policies, the nightly extract)",
  databricks: "Databricks (adjuster notes, call transcripts, OCR output, images)",
  vision: "Claude vision, reading one field from one page image",
  code: "Plain code: parsing, arithmetic and format checks, no model",
};

export const rereadSchema = z.object({
  /** What the OCR engine read, before the re-read. */
  ocrText: z.string().nullable(),
  /** What the vision re-read returned for the same field. Null if it could not read it either. */
  visionValue: z.string().nullable(),
  /** Whether the two agree after normalisation. Null when there was nothing to compare. */
  agreed: z.boolean().nullable(),
  /** Any code cross-check that also supports the value (for example line items adding up). */
  codeCheck: z.string().nullable(),
  /** The page image the re-read looked at, as a path under the claim folder. */
  pageImage: z.string(),
  page: z.number().int(),
  /** Approximate region of the field on the page, as fractions of width and height. */
  region: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
});
export type Reread = z.infer<typeof rereadSchema>;

export const sourcedFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  source: sourceSchema,
  document: z.string().nullable(),
  page: z.number().int().nullable(),
  /** Measured, never self-reported by a model. Null when the source has no confidence concept (a database field). */
  confidence: z.number().min(0).max(1).nullable(),
  /** How the confidence was arrived at, in plain words. */
  basis: z.string(),
  reread: rereadSchema.nullable(),
});
export type SourcedField = z.infer<typeof sourcedFieldSchema>;

export const evidenceItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  present: z.boolean(),
  document: z.string().nullable(),
  source: sourceSchema.nullable(),
  note: z.string().nullable(),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const timelineEventSchema = z.object({
  /** ISO date or date-time, as precise as the source allows. */
  at: z.string(),
  event: z.string(),
  source: sourceSchema,
  document: z.string().nullable(),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const quoteSchema = z.object({
  source: sourceSchema,
  document: z.string().nullable(),
  quote: z.string(),
});

export const contradictionSchema = z.object({
  topic: z.string(),
  a: quoteSchema,
  b: quoteSchema,
  /** Material: could change the decision. Otherwise worth a look but not blocking. */
  material: z.boolean(),
  note: z.string(),
});
export type Contradiction = z.infer<typeof contradictionSchema>;

export const missingItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  why: z.string(),
  /** Who can supply it. Drives the drafted message. */
  from: z.enum(["claimant", "provider", "internal"]),
});
export type MissingItem = z.infer<typeof missingItemSchema>;

export const DENIAL_INDICATORS = ["pre_existing_damage", "policy_lapse", "filing_deadline", "fraud_signal"] as const;
export type DenialIndicatorKind = (typeof DENIAL_INDICATORS)[number];
export const DENIAL_INDICATOR_LABELS: Record<DenialIndicatorKind, string> = {
  pre_existing_damage: "Possible pre-existing damage",
  policy_lapse: "Policy lapsed at the date of loss",
  filing_deadline: "Filing deadline may have passed",
  fraud_signal: "Fraud signal",
};

export const denialIndicatorSchema = z.object({
  kind: z.enum(DENIAL_INDICATORS),
  evidence: z.string(),
  source: sourceSchema,
  document: z.string().nullable(),
});
export type DenialIndicator = z.infer<typeof denialIndicatorSchema>;

export const AGENT_TOOLS = ["get_structured", "get_documents", "reread_field", "check_completeness"] as const;
export type AgentTool = (typeof AGENT_TOOLS)[number];

export const traceEntrySchema = z.object({
  step: z.number().int(),
  tool: z.enum(AGENT_TOOLS),
  args: z.string(),
  result: z.string(),
  durationMs: z.number(),
  startedAt: z.string(),
});
export type TraceEntry = z.infer<typeof traceEntrySchema>;

export const packetHeaderSchema = z.object({
  claimId: z.string(),
  claimType: z.enum(["Collision", "Comprehensive", "Bodily Injury", "Property Damage", "Liability"]),
  state: z.string(),
  country: z.enum(["US", "CA", "other"]),
  channel: z.enum(["E-Portal", "Phone", "Fax/EDI"]),
  filedDate: z.string(),
  dateOfLoss: z.string().nullable(),
  amountUsd: z.number().nullable(),
  policyNumber: z.string().nullable(),
  /** Names are masked before anything reaches the model, so the packet only ever holds the token. */
  policyholderToken: z.string(),
  claimantToken: z.string().nullable(),
  vehicle: z.string().nullable(),
  complexity: z.enum(["Simple", "Moderate", "Complex"]).nullable(),
  /** ClaimsPro's own flag, where it has one. Null means unknown, which the rules treat conservatively. */
  regulatoryReviewRequired: z.boolean().nullable(),
  policyStatus: z.enum(["in_force", "lapsed", "unknown"]),
  priorClaimsOnPolicy: z.number().int(),
  adjusterId: z.string().nullable(),
});
export type PacketHeader = z.infer<typeof packetHeaderSchema>;

export const claimPacketSchema = z.object({
  claimId: z.string(),
  provenance: provenanceSchema,
  status: z.enum(["assembled", "not_assembled"]),
  notAssembledReason: z.string().nullable(),
  generatedAt: z.string(),
  model: z.object({
    requested: z.string(),
    served: z.string().nullable(),
    promptVersion: z.string(),
    agentVersion: z.string(),
  }),
  header: packetHeaderSchema,
  evidence: z.array(evidenceItemSchema),
  /** Fraction of the checklist present. Null when the packet was not assembled. */
  completeness: z.number().min(0).max(1).nullable(),
  fields: z.array(sourcedFieldSchema),
  timeline: z.array(timelineEventSchema),
  contradictions: z.array(contradictionSchema),
  missing: z.array(missingItemSchema),
  denialIndicators: z.array(denialIndicatorSchema),
  /** The agent's recommendation. The rules run after this and can only make it more conservative. */
  agentRoute: routeSchema.nullable(),
  /** Written for a regulator, not an engineer. */
  rationale: z.string(),
  trace: z.array(traceEntrySchema),
  /** SHA-256 of the masked inputs the model saw. The audit record keeps the snapshot. */
  inputHash: z.string(),
  settingsUsed: z.object({ ocrRereadThreshold: z.number() }),
});
export type ClaimPacket = z.infer<typeof claimPacketSchema>;
