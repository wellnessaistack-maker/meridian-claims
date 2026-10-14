// A stub of the ClaimsPro SOAP write operations the product would actually use.
//
// Four operations: add_note, set_status, send_correspondence, transition_workflow.
// There is no approve or deny operation in this file, on purpose. ClaimsPro has no
// API for claim decisioning (approvals and denials enter through the UI or the
// batch file) and the AI must never deny a claim, so the prototype cannot write a
// decision even by accident. Every call appends to data/claimspro-writes.jsonl so
// the screen can show what would have been written.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const WRITE_OPERATIONS = ["add_note", "set_status", "send_correspondence", "transition_workflow"] as const;
export type WriteOperation = (typeof WRITE_OPERATIONS)[number];

export const WRITE_OPERATION_SOAP: Record<WriteOperation, string> = {
  add_note: "ClaimNoteService.AddNote",
  set_status: "ClaimWorkflowService.SetStatus",
  send_correspondence: "CorrespondenceService.Send",
  transition_workflow: "ClaimWorkflowService.Transition",
};

export interface WritePayloads {
  add_note: { text: string; author: string };
  set_status: { status: string; note: string | null };
  send_correspondence: { to: "claimant" | "provider" | "policyholder"; channel: "email" | "letter" | "portal"; subject: string; body: string };
  transition_workflow: { from: string; to: string; reason: string };
}

export interface WriteRecord<K extends WriteOperation = WriteOperation> {
  id: string;
  at: string;
  op: K;
  soap: string;
  claimId: string;
  payload: WritePayloads[K];
  /** Always true in the prototype: nothing reaches ClaimsPro. */
  stub: true;
}

const LOG = path.join("data", "claimspro-writes.jsonl");

// Vercel's filesystem is read-only outside /tmp, so the log falls back to memory there.
const memory: WriteRecord[] = [];

function logPath(root: string) {
  return path.join(root, LOG);
}

function makeId(op: string, claimId: string, at: string) {
  return "cpw_" + createHash("sha256").update(`${op}|${claimId}|${at}|${Math.random()}`).digest("hex").slice(0, 12);
}

export function write<K extends WriteOperation>(op: K, claimId: string, payload: WritePayloads[K], root = process.cwd()): WriteRecord<K> {
  if (!WRITE_OPERATIONS.includes(op)) throw new Error(`Unknown ClaimsPro operation: ${op}`);
  const at = new Date().toISOString();
  const rec: WriteRecord<K> = { id: makeId(op, claimId, at), at, op, soap: WRITE_OPERATION_SOAP[op], claimId, payload, stub: true };
  memory.push(rec);
  try {
    mkdirSync(path.dirname(logPath(root)), { recursive: true });
    appendFileSync(logPath(root), JSON.stringify(rec) + "\n");
  } catch {
    // Read-only filesystem: kept in memory for this process only.
  }
  return rec;
}

export const addNote = (claimId: string, payload: WritePayloads["add_note"], root?: string) => write("add_note", claimId, payload, root);
export const setStatus = (claimId: string, payload: WritePayloads["set_status"], root?: string) => write("set_status", claimId, payload, root);
export const sendCorrespondence = (claimId: string, payload: WritePayloads["send_correspondence"], root?: string) => write("send_correspondence", claimId, payload, root);
export const transitionWorkflow = (claimId: string, payload: WritePayloads["transition_workflow"], root?: string) => write("transition_workflow", claimId, payload, root);

/** Everything written so far, from the log file plus anything only in memory. */
export function listWrites(claimId?: string, root = process.cwd()): WriteRecord[] {
  let fromFile: WriteRecord[] = [];
  const p = logPath(root);
  if (existsSync(p)) {
    fromFile = readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as WriteRecord);
  }
  const seen = new Set(fromFile.map((r) => r.id));
  const all = [...fromFile, ...memory.filter((r) => !seen.has(r.id))];
  return claimId ? all.filter((r) => r.claimId === claimId) : all;
}
