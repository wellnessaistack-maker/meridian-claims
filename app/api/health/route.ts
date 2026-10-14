// GET /api/health: is the server configured? Never returns the key itself.

import { apiKeyConfigured, modelFromEnv, NO_KEY_MESSAGE } from "@/lib/agent/models.ts";
import { PROTOCOL_VERSION } from "@/lib/rules/protocol.ts";

export const dynamic = "force-dynamic";

export function GET() {
  const key = apiKeyConfigured();
  return Response.json({
    ok: true,
    apiKeyConfigured: key,
    apiKey: key ? "configured" : NO_KEY_MESSAGE,
    model: modelFromEnv(),
    protocolVersion: PROTOCOL_VERSION,
  });
}
