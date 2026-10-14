// POST /api/writes  { operation, claimId, payload }
// The ClaimsPro write-back stub. Four operations; none of them decides a claim.

import { write, WRITE_OPERATIONS, type WriteOperation } from "@/lib/claimspro/writes.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { operation?: string; claimId?: string; payload?: Record<string, unknown> } | null;
  if (!body?.operation || !body.claimId) return Response.json({ ok: false, error: "operation and claimId are required." }, { status: 400 });
  if (!(WRITE_OPERATIONS as readonly string[]).includes(body.operation)) return Response.json({ ok: false, error: `Unknown operation ${body.operation}. Allowed: ${WRITE_OPERATIONS.join(", ")}. There is no approve or deny operation.` }, { status: 400 });
  const entry = write(body.operation as WriteOperation, body.claimId, (body.payload ?? {}) as never);
  return Response.json({ ok: true, entry });
}
