// POST /api/audit/confirm  { claimId, reviewer, route?, reason? }
// The adjuster confirms the route or changes it with a reason. Appends an
// audit record; nothing is ever edited. On the deployment the file system is
// read-only, so the record lives in memory for the instance and the response
// carries it back to the screen.

import { confirmAudit } from "@/lib/audit/record.ts";
import { ROUTES } from "@/lib/claim/schema.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { claimId?: string; reviewer?: string; route?: string; reason?: string } | null;
  if (!body?.claimId || !body.reviewer?.trim()) return Response.json({ ok: false, error: "claimId and reviewer are required." }, { status: 400 });
  if (body.route && !(ROUTES as readonly string[]).includes(body.route)) return Response.json({ ok: false, error: `Unknown route ${body.route}.` }, { status: 400 });
  try {
    const record = confirmAudit(body.claimId, body.reviewer.trim(), { route: body.route as (typeof ROUTES)[number] | undefined, reason: body.reason });
    return Response.json({ ok: true, record });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
