// GET /api/agent/run?claim=<id>&token=<AGENT_RUN_TOKEN>[&model=<id>]
//
// Runs the agent on one claim folder and returns the packet, the decision at
// the default settings, the usage and the audit record. This is the "re-run"
// the screen calls, and the way packets are produced when the key lives only
// on the deployment: a script fetches this endpoint and commits the result as
// the cache. The endpoint spends API money, so it needs the shared token.
// Nothing is written on the server: Vercel's filesystem is read-only.

import { timingSafeEqual } from "node:crypto";

import { findClaimFolder } from "@/lib/claim/catalog.ts";
import { loadClaim } from "@/lib/claim/load.ts";
import { apiKeyConfigured, modelFromEnv, NO_KEY_MESSAGE } from "@/lib/agent/models.ts";
import { runAgent } from "@/lib/agent/run.ts";
import { recordFor } from "@/lib/audit/record.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function tokenOk(given: string | null): boolean {
  const expected = process.env.AGENT_RUN_TOKEN?.trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!process.env.AGENT_RUN_TOKEN?.trim()) return Response.json({ ok: false, error: "AGENT_RUN_TOKEN is not set on the server; re-runs are disabled." }, { status: 503 });
  if (!tokenOk(url.searchParams.get("token") ?? request.headers.get("x-agent-run-token"))) return Response.json({ ok: false, error: "Bad or missing token." }, { status: 403 });
  if (!apiKeyConfigured()) return Response.json({ ok: false, error: NO_KEY_MESSAGE }, { status: 503 });

  const claimId = url.searchParams.get("claim") ?? "";
  const folder = findClaimFolder(claimId);
  if (!folder) return Response.json({ ok: false, error: `No claim folder for ${claimId || "(empty)"}.` }, { status: 404 });
  const model = url.searchParams.get("model") ?? modelFromEnv();

  const claim = loadClaim(folder);
  const r = await runAgent(claim, { model });
  const audit = r.ok ? recordFor(r.packet, r.decision, r.snapshot) : null;
  return Response.json({ ok: r.ok, failure: r.failure, model, packet: r.packet, decision: r.decision, usage: r.usage, snapshot: r.snapshot, audit });
}
