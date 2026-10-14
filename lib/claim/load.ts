// Loads one claim folder through the three loaders and builds the packet header
// and the privacy mask. Everything here is code; no model.

import path from "node:path";
import { createHash } from "node:crypto";

import { findClaimFolder, listClaimFolders, type ClaimFolder } from "./catalog.ts";
import { parseEdi, type EdiExtraction } from "./edi.ts";
import { extractOcrFields, type OcrExtraction } from "./ocr-fields.ts";
import type { PacketHeader, Source } from "./schema.ts";
import { channelOf, claimTypeOf, complexityOf, loadClaimsPro, loadDatabricks, loadSnowflake, parseUsd, type ClaimsProSource, type DatabricksSource, type RawField, type SnowflakeSource } from "./sources.ts";
import type { MaskedName } from "../privacy/mask.ts";

export interface LoadedClaim {
  folder: ClaimFolder;
  claimsPro: ClaimsProSource;
  snowflake: SnowflakeSource;
  databricks: DatabricksSource;
  ocr: OcrExtraction | null;
  edi: EdiExtraction | null;
  header: PacketHeader;
  /** Real names, kept out of the packet. Used to mask prompts and to unmask the screen. */
  names: MaskedName[];
  /** Every structured field from every loader, with its source and document. */
  structuredFields: RawField[];
}

export function loadClaim(folder: ClaimFolder, root = process.cwd()): LoadedClaim {
  const claimsPro = loadClaimsPro(folder.dir, root);
  const snowflake = loadSnowflake(folder.dir, claimsPro, root);
  const databricks = loadDatabricks(folder.dir, claimsPro.claimId, root);
  const ocr = databricks.ocr?.text ? extractOcrFields(databricks.ocr.text, databricks.ocr.name) : null;
  const edi = databricks.edi?.text ? parseEdi(databricks.edi.text, databricks.edi.name) : null;

  const names: MaskedName[] = [];
  if (snowflake.policy.policyholder) names.push({ token: "[POLICYHOLDER]", value: snowflake.policy.policyholder });
  if (snowflake.policy.claimant) names.push({ token: "[CLAIMANT]", value: snowflake.policy.claimant });
  const thirdParty = claimsPro.get("Third party") ?? claimsPro.get("Third party (name)");
  if (thirdParty) names.push({ token: "[THIRD_PARTY]", value: thirdParty.replace(/\s*\(.*\)$/, "") });

  const row = snowflake.row;
  const g = (l: string) => claimsPro.get(l);
  const claimType = claimTypeOf(g("Claim type")) ?? row?.claimType ?? "Collision";
  const channel = channelOf(g("Intake channel")) ?? row?.intakeChannel ?? "E-Portal";
  const state = (g("Loss state") ?? row?.state ?? "").toUpperCase();
  const amountUsd = parseUsd(g("Claim amount")) ?? row?.claimAmountUsd ?? null;
  const regulatory = claimsPro.requiresHumanByRegulation ?? row?.requiresHumanByRegulation ?? null;

  const header: PacketHeader = {
    claimId: claimsPro.claimId,
    claimType,
    state,
    country: snowflake.policy.country,
    channel,
    filedDate: g("Filed date") ?? row?.filedDate ?? "",
    dateOfLoss: g("Date of loss") ?? edi?.dateOfLoss ?? null,
    amountUsd,
    policyNumber: snowflake.policy.policyNumber,
    policyholderToken: snowflake.policy.policyholder ? "[POLICYHOLDER]" : "(not on file)",
    claimantToken: snowflake.policy.claimant ? "[CLAIMANT]" : null,
    vehicle: snowflake.policy.vehicle,
    complexity: complexityOf(g("Complexity")) ?? row?.complexity ?? null,
    regulatoryReviewRequired: regulatory,
    policyStatus: snowflake.policyStatus,
    priorClaimsOnPolicy: snowflake.priorClaimsOnPolicy,
    adjusterId: g("Assigned adjuster") ?? row?.adjusterId ?? null,
  };

  const structuredFields: RawField[] = [...claimsPro.intake, ...claimsPro.cycle, ...snowflake.fields, ...(edi?.fields ?? [])];
  return { folder, claimsPro, snowflake, databricks, ocr, edi, header, names, structuredFields };
}

export function loadClaimById(claimId: string, root = process.cwd()): LoadedClaim | null {
  const f = findClaimFolder(claimId, root);
  return f ? loadClaim(f, root) : null;
}

export function loadAllClaims(root = process.cwd()): LoadedClaim[] {
  return listClaimFolders(root).map((f) => loadClaim(f, root));
}

/** A stable hash of the inputs, for the audit record. */
export function hashInputs(parts: (string | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => p ?? "").join("\n\u0000")).digest("hex");
}

export const sourceOfDocument = (name: string): Source => (/^(intake|status_history)\.md$/.test(name) ? "claimspro" : "databricks");

export function photoPaths(c: LoadedClaim): string[] {
  return c.databricks.photos.map((p) => p.path);
}

export const relative = (p: string) => path.normalize(p).replace(/\\/g, "/");
