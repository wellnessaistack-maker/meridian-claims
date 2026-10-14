// Everything the screen needs, read on the server: the claim folders with their
// cached packets and audit history, the extract rows seeded into the queue, and
// whether the key is configured. One plain object, serialised to the client.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { packetView } from "../agent/assemble.ts";
import { listPackets, type PacketRecord } from "../agent/cache.ts";
import { apiKeyConfigured, modelFromEnv } from "../agent/models.ts";
import { readAudit, type AuditRecord } from "../audit/record.ts";
import { listClaimFolders } from "../claim/catalog.ts";
import { loadClaim } from "../claim/load.ts";
import type { PacketHeader, Provenance } from "../claim/schema.ts";
import { findExtractRow } from "../extract/csv.ts";
import { decide, type Decision, type Segment } from "../rules/engine.ts";
import { DEFAULT_SETTINGS, PROTOCOL_VERSION, SETTING_DEFS, type Settings } from "../rules/protocol.ts";
import type { WorklistEntry } from "../worklist/seed.ts";
import { amountCheck, type AmountCheck } from "./amount.ts";
import { routeConfidence } from "../confidence.ts";

export interface ClaimRow {
  claimId: string;
  provenance: Provenance;
  header: PacketHeader;
  /** Hours in the queue so far. */
  queueAgeHours: number;
  /** What today's process says: flagged for human review by ClaimsPro's rule. */
  todayFlagged: boolean | null;
  todayQueue: string | null;
  documentCount: number;
  /** Cached packet, when the agent has run on this claim. */
  packet: PacketRecord | null;
  /** The decision shown: the packet's at default settings, or the structured rules alone. */
  decision: Decision;
  audit: AuditRecord[];
  /** Real names for the screen only. Never in a prompt or a packet. */
  names: { token: string; name: string }[];
  /** Photos, as repo-relative paths. */
  photos: string[];
  /** Page images of the PDFs, as repo-relative paths, with the document they belong to. */
  pages: { document: string; page: number; image: string }[];
  documents: { name: string; kind: string; engineConfidence: number | null; pages: number }[];
  lossDescription: string | null;
  /** Claimed against what the documents support. Null without a packet. */
  amount: AmountCheck | null;
  /** A reply from the claimant after a request went out. Session state; null from the loader. */
  reply: { at: string; text: string } | null;
}

export interface WorkspaceData {
  generatedAt: string;
  apiKey: boolean;
  model: string;
  protocolVersion: string;
  settings: Settings;
  settingDefs: typeof SETTING_DEFS;
  rows: ClaimRow[];
}

/** An extract row as a claim row with no documents and no packet. */
function fromWorklistEntry(e: WorklistEntry, settings: Settings): ClaimRow {
  const header: PacketHeader = {
    claimId: e.claimId,
    claimType: e.claimType,
    state: e.state,
    country: "US",
    channel: e.channel,
    filedDate: e.filedDate,
    dateOfLoss: null,
    amountUsd: e.amountUsd,
    policyNumber: null,
    policyholderToken: "[POLICYHOLDER]",
    claimantToken: null,
    vehicle: null,
    complexity: e.complexity,
    regulatoryReviewRequired: e.regulatoryReviewRequired,
    policyStatus: "unknown",
    priorClaimsOnPolicy: 0,
    adjusterId: null,
  };
  const decision = decide({ claimId: e.claimId, claimType: e.claimType, state: e.state, country: "US", amountUsd: e.amountUsd, regulatoryReviewRequired: e.regulatoryReviewRequired, policyStatus: "unknown", packet: null }, settings, { structuredOnly: true });
  return { claimId: e.claimId, provenance: e.provenance, header, queueAgeHours: e.queueAgeHours, todayFlagged: e.todayFlagged, todayQueue: e.todayFlagged ? "Human review" : "Standard", documentCount: e.documentCount, packet: null, decision, audit: [], names: [], photos: [], pages: [], documents: [], lossDescription: null, amount: null, reply: null };
}

export function loadWorkspaceData(root = process.cwd(), settings: Settings = DEFAULT_SETTINGS): WorkspaceData {
  const packets = new Map(listPackets(root).map((p) => [p.packet.claimId, p]));
  const rows: ClaimRow[] = [];
  for (const folder of listClaimFolders(root)) {
    const claim = loadClaim(folder, root);
    const packet = packets.get(folder.claimId) ?? null;
    const extract = findExtractRow(folder.claimId, folder.dir)?.row ?? null;
    const decision = packet
      ? decide({ claimId: folder.claimId, claimType: claim.header.claimType, state: claim.header.state, country: claim.header.country, amountUsd: claim.header.amountUsd, regulatoryReviewRequired: claim.header.regulatoryReviewRequired, policyStatus: claim.header.policyStatus, packet: packetView(packet.packet) }, settings)
      : decide({ claimId: folder.claimId, claimType: claim.header.claimType, state: claim.header.state, country: claim.header.country, amountUsd: claim.header.amountUsd, regulatoryReviewRequired: claim.header.regulatoryReviewRequired, policyStatus: claim.header.policyStatus, packet: null }, settings, { structuredOnly: true });
    rows.push({
      claimId: folder.claimId,
      provenance: folder.provenance,
      header: claim.header,
      queueAgeHours: claim.claimsPro.queueWaitHours ?? extract?.queueWaitHours ?? 0,
      todayFlagged: extract ? extract.flaggedForHumanReview : null,
      todayQueue: extract ? (extract.flaggedForHumanReview ? "Human review" : "Standard") : null,
      documentCount: claim.databricks.documents.length + claim.databricks.photos.length,
      packet,
      decision,
      // Route confidence is "as of the latest evaluation": a record made before the evaluation ran reads it now.
      audit: readAudit(folder.claimId, root).map((r) => (r.confidence.route.value === null ? { ...r, confidence: { ...r.confidence, route: routeConfidence(r.output.segment as Segment, root) } } : r)),
      names: claim.names.map((n) => ({ token: n.token, name: n.value })),
      photos: claim.databricks.photos.map((p) => p.path),
      pages: claim.databricks.pdfs.flatMap((d) => d.pages.map((pg) => ({ document: d.name, page: pg.page, image: pg.image }))),
      documents: claim.databricks.documents.map((d) => ({ name: d.name, kind: d.kind, engineConfidence: d.engineConfidence, pages: d.pages.length })),
      lossDescription: claim.claimsPro.lossDescription,
      amount: packet ? amountCheck(packet.packet, claim.databricks.documents.map((d) => ({ name: d.name, text: d.text }))) : null,
      reply: null,
    });
  }
  const seedFile = path.join(root, "data", "worklist.json");
  if (existsSync(seedFile)) {
    const seed = JSON.parse(readFileSync(seedFile, "utf8")) as { entries: WorklistEntry[] };
    const have = new Set(rows.map((r) => r.claimId));
    for (const e of seed.entries) if (!have.has(e.claimId)) rows.push(fromWorklistEntry(e, settings));
  }
  return { generatedAt: new Date().toISOString(), apiKey: apiKeyConfigured(), model: modelFromEnv(), protocolVersion: PROTOCOL_VERSION, settings, settingDefs: SETTING_DEFS, rows };
}

