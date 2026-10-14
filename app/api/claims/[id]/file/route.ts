// GET /api/claims/<id>/file?path=<path under the claim folder>
// Serves a photo or a page image from a claim folder. Only files inside that
// claim's own folder, only images.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { findClaimFolder } from "@/lib/claim/catalog.ts";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folder = findClaimFolder(id);
  if (!folder) return new Response("No such claim.", { status: 404 });
  const rel = new URL(request.url).searchParams.get("path") ?? "";
  const root = path.resolve(process.cwd(), folder.dir);
  // Paths in the packet are repo-relative; paths from the screen may be folder-relative. Both must stay inside the folder.
  const abs = path.resolve(process.cwd(), rel.startsWith(folder.dir) ? rel : path.join(folder.dir, rel));
  if (!abs.startsWith(root + path.sep)) return new Response("Outside the claim folder.", { status: 400 });
  const type = TYPES[path.extname(abs).toLowerCase()];
  if (!type || !existsSync(abs)) return new Response("Not found.", { status: 404 });
  return new Response(readFileSync(abs), { headers: { "content-type": type, "cache-control": "public, max-age=3600" } });
}
