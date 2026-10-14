// GET /api/agent/run?claim=<id>&token=<AGENT_RUN_TOKEN>[&model=<id>][&mode=background]
//
// Runs the agent on one claim folder and returns the packet, the decision at
// the default settings, the usage and the audit record. This is the "re-run"
// the screen calls, and the way packets are produced when the key lives only
// on the deployment. The endpoint spends API money, so it needs the shared token.
// Nothing is written on the server: Vercel's filesystem is read-only.
//
// mode=background answers at once and finishes the run after the response,
// writing the same JSON into the function's runtime logs as gzip+base64
// chunks (PKTCHUNK lines). A caller that cannot hold a connection open for the
// length of a run (a minute or more) collects the chunks from the logs and
// decodes them with scripts/decode-run-log.ts.

import { timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { after } from "next/server";

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

async function runOne(claimId: string, model: string) {
  const folder = findClaimFolder(claimId)!;
  const claim = loadClaim(folder);
  const r = await runAgent(claim, { model });
  const audit = r.ok ? recordFor(r.packet, r.decision, r.snapshot) : null;
  // The audit record carries the input snapshot, so it is not repeated at the top level.
  return { ok: r.ok, failure: r.failure, model, packet: r.packet, decision: r.decision, usage: r.usage, audit };
}

/** Writes a JSON result to the logs in chunks that fit a log line. */
function logChunks(claimId: string, runId: string, body: unknown) {
  const gz = gzipSync(Buffer.from(JSON.stringify(body))).toString("base64");
  const size = 3000;
  const n = Math.ceil(gz.length / size);
  for (let i = 0; i < n; i++) console.log(`PKTCHUNK ${claimId} ${runId} ${i + 1}/${n} ${gz.slice(i * size, (i + 1) * size)}`);
  console.log(`PKTDONE ${claimId} ${runId} ${n} chunks ${gz.length} chars`);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!process.env.AGENT_RUN_TOKEN?.trim()) return Response.json({ ok: false, error: "AGENT_RUN_TOKEN is not set on the server; re-runs are disabled." }, { status: 503 });
  if (!tokenOk(url.searchParams.get("token") ?? request.headers.get("x-agent-run-token"))) return Response.json({ ok: false, error: "Bad or missing token." }, { status: 403 });
  if (!apiKeyConfigured()) return Response.json({ ok: false, error: NO_KEY_MESSAGE }, { status: 503 });

  const claimId = url.searchParams.get("claim") ?? "";
  if (!findClaimFolder(claimId)) return Response.json({ ok: false, error: `No claim folder for ${claimId || "(empty)"}.` }, { status: 404 });
  const model = url.searchParams.get("model") ?? modelFromEnv();

  if (url.searchParams.get("mode") === "background") {
    const runId = Date.now().toString(36);
    after(async () => {
      try {
        const body = await runOne(claimId, model);
        logChunks(claimId, runId, body);
      } catch (err) {
        console.error(`PKTFAIL ${claimId} ${runId} ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    return Response.json({ started: true, claimId, runId, model, note: "The run finishes after this response; the result is written to the runtime logs as PKTCHUNK lines." });
  }

  return Response.json(await runOne(claimId, model));
}
