// What the model returns at the end of the run, as a zod schema enforced by the
// API's structured outputs. Everything here is a description; the measured
// numbers (confidence, completeness) are computed in code, never asked of the model.

import { z } from "zod";

import { DENIAL_INDICATORS, ROUTES } from "../claim/schema.ts";

export const agentOutputSchema = z.object({
  summary: z.string(),
  fields_read: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.string().nullable(),
      document: z.string(),
      quote: z.string(),
    }),
  ),
  timeline: z.array(z.object({ at: z.string(), event: z.string(), document: z.string() })),
  contradictions: z.array(
    z.object({
      topic: z.string(),
      a: z.object({ document: z.string(), quote: z.string() }),
      b: z.object({ document: z.string(), quote: z.string() }),
      material: z.boolean(),
      note: z.string(),
    }),
  ),
  denial_indicators: z.array(z.object({ kind: z.enum(DENIAL_INDICATORS), evidence: z.string(), document: z.string() })),
  route: z.enum(ROUTES),
  rationale: z.string(),
  photo_observations: z.array(z.object({ photo: z.string(), observation: z.string() })),
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;

/** What the vision re-read returns for one field. */
export const visionReadSchema = z.object({
  value: z.string().nullable(),
  legible: z.boolean(),
  note: z.string(),
});
export type VisionRead = z.infer<typeof visionReadSchema>;
