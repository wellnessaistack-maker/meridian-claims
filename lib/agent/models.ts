// Which Claude model the agent uses. ANTHROPIC_MODEL in the environment switches
// Sonnet and Opus without a code change. Prices are list prices per million
// tokens, for the cost-per-claim figure only.

export interface ModelInfo {
  id: string;
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
}

export const MODELS: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
];

export const DEFAULT_MODEL = "claude-opus-5-5";

export function modelFromEnv(): string {
  const m = process.env.ANTHROPIC_MODEL?.trim();
  return m || DEFAULT_MODEL;
}

export function modelInfo(id: string): ModelInfo {
  return MODELS.find((m) => id.startsWith(m.id)) ?? { ...MODELS[0], id, label: id };
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costUsd(modelId: string, usage: Usage): number {
  const m = modelInfo(modelId);
  const input = usage.input_tokens + 1.25 * (usage.cache_creation_input_tokens ?? 0);
  const cached = usage.cache_read_input_tokens ?? 0;
  return (input * m.inputPerMTok + cached * m.cacheReadPerMTok + usage.output_tokens * m.outputPerMTok) / 1_000_000;
}

export const apiKeyConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

export const NO_KEY_MESSAGE = "No API key. Showing cached packets; re-run is disabled.";
