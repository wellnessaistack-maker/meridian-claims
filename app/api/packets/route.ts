// GET /api/packets: the cached packets committed under data/packets, as the screen reads them.

import { listPackets } from "@/lib/agent/cache.ts";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ packets: listPackets() });
}
