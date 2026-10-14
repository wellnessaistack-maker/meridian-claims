// Which Claude model the agent uses. ANTHROPIC_MODEL in the environment switches
// Sonnet and Opus without a code change. Prices are list prices per million
// tokens, for the cost-per-claim figure only.

export interface ModelInfo {
  id: string;
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODELS: ModelInfo[] = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20 },
];

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export function modelFromEnv(): string {
  const m = process.env.ANTHROPIC_MODEL?.trim();
  return m || DEFAULT_MODEL;
}

export function modelInfo(id: string): ModelInfo {
  return MODELS.find((m) => id.startsWith(m.id)) ?? { id, label: id, inputPerMTok: MODELS[0].inputPerMTok, outputPerMTok: MODELS[0].outputPerMTok };
}

export const apiKeyConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

export const NO_KEY_MESSAGE = "No API key. Showing cached packets; re-run is disabled.";
