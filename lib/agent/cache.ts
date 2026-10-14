// Every packet is cached to data/packets/<claim_id>.json with the model version
// and a timestamp. The screen loads from the cache and offers a re-run; the demo
// works from the cache alone if the API is down.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { claimPacketSchema, type ClaimPacket } from "../claim/schema.ts";
import type { Decision } from "../rules/engine.ts";

export interface PacketRecord {
  packet: ClaimPacket;
  /** The decision at the default settings when the packet was made. The screen recomputes it for drafts. */
  decision: Decision;
  usage: { calls: number; inputTokens: number; outputTokens: number; costUsd: number; durationMs: number };
  savedAt: string;
}

const DIR = path.join("data", "packets");
const memory = new Map<string, PacketRecord>();

const fileFor = (claimId: string, root: string) => path.join(root, DIR, `${claimId}.json`);

export function readPacket(claimId: string, root = process.cwd()): PacketRecord | null {
  const mem = memory.get(claimId);
  if (mem) return mem;
  const p = fileFor(claimId, root);
  if (!existsSync(p)) return null;
  const rec = JSON.parse(readFileSync(p, "utf8")) as PacketRecord;
  rec.packet = claimPacketSchema.parse(rec.packet);
  return rec;
}

export function writePacket(rec: PacketRecord, root = process.cwd()): string {
  memory.set(rec.packet.claimId, rec);
  const p = fileFor(rec.packet.claimId, root);
  try {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(rec, null, 2) + "\n");
    return p;
  } catch {
    return "(memory only: read-only filesystem)";
  }
}

export function listPackets(root = process.cwd()): PacketRecord[] {
  const dir = path.join(root, DIR);
  const ids = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")) : [];
  for (const id of memory.keys()) if (!ids.includes(id)) ids.push(id);
  return ids.map((id) => readPacket(id, root)).filter((r): r is PacketRecord => r !== null);
}
