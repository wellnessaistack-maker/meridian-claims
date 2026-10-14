// One place to build the API client. Organisation-scoped keys need the
// workspace sent on every request; set ANTHROPIC_WORKSPACE_ID for those.

import Anthropic from "@anthropic-ai/sdk";

export function makeClient(opts: { timeoutMs?: number } = {}): Anthropic {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    timeout: opts.timeoutMs ?? 180_000,
    maxRetries: 1,
    defaultHeaders: workspace ? { "anthropic-workspace-id": workspace } : undefined,
  });
}
