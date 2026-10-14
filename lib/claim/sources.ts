// Three typed loaders, one per system the production product would read from.
// In the prototype each claim folder stands in for all three. The loaders stay
// separate so it is obvious which system each field came from; every field they
// return is tagged with its source and the document it was read from.
//
//   claimspro   intake.md, status_history.md           (REST reads in production)
//   snowflake   the claim's row in the extract, plus the policy fields on intake.md
//   databricks  adjuster_notes.md, call_excerpt.md, ocr_output.txt, edi_record.txt,
//               the PDFs (as pre-rendered page images) and the photos

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { findExtractRow, type Channel, type ClaimType, type Complexity, type ExtractRow } from "../extract/csv.ts";
import type { Source } from "./schema.ts";

export interface RawField {
  key: string;
  label: string;
  value: string;
  source: Source;
  document: string;
}

// ---------------------------------------------------------------------------
// Markdown helpers. The ClaimsPro exports are markdown tables with a fixed shape.
// ---------------------------------------------------------------------------

/** Rows of the first markdown table after an optional heading, as label/value pairs. */
export function parseKvTable(md: string, afterHeading?: RegExp): { label: string; value: string }[] {
  const body = afterHeading ? sectionAfter(md, afterHeading) : md;
  const rows: { label: string; value: string }[] = [];
  let inTable = false;
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|")) {
      if (inTable) break;
      continue;
    }
    const cells = t.slice(1, t.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
    if (cells.every((c) => /^-+$/.test(c))) continue;
    if (!inTable) {
      inTable = true;
      // Header row (Field | Value, Metric | Value): skip it.
      if (/^(field|metric)$/i.test(cells[0])) continue;
    }
    if (cells.length >= 2) rows.push({ label: cells[0], value: cells[1] });
  }
  return rows;
}

/** The first markdown table with a header row after a heading, as objects keyed by header. */
export function parseTable(md: string, afterHeading?: RegExp): Record<string, string>[] {
  const body = afterHeading ? sectionAfter(md, afterHeading) : md;
  const out: Record<string, string>[] = [];
  let header: string[] | null = null;
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|")) {
      if (header) break;
      continue;
    }
    const cells = t.slice(1, t.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
    if (cells.every((c) => /^-+$/.test(c))) continue;
    if (!header) {
      header = cells;
      continue;
    }
    out.push(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
  }
  return out;
}

/** The text from a heading matching `re` up to the next heading of the same or higher level. */
export function sectionAfter(md: string, re: RegExp): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && re.test(l));
  if (start === -1) return "";
  const level = lines[start].match(/^(#+)/)![1].length;
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = l.match(/^(#+)\s/);
    if (m && m[1].length <= level) break;
    out.push(l);
  }
  return out.join("\n");
}

function bullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(-|\d+\.)\s/.test(l))
    .map((l) => l.replace(/^(-|\d+\.)\s+/, ""));
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

// ---------------------------------------------------------------------------
// ClaimsPro
// ---------------------------------------------------------------------------

export interface StatusEvent {
  at: string;
  status: string;
  actor: string;
  note: string;
}

export interface ClaimsProSource {
  system: "claimspro";
  claimId: string;
  intake: RawField[];
  lossDescription: string | null;
  intakePackage: string[];
  statusHistory: StatusEvent[];
  cycle: RawField[];
  documentsOnFile: string[];
  receivedAt: string | null;
  firstTouchAt: string | null;
  closedAt: string | null;
  queueWaitHours: number | null;
  handlingHours: number | null;
  totalCycleHours: number | null;
  flaggedForHumanReview: boolean | null;
  requiresHumanByRegulation: boolean | null;
  files: string[];
  /** Look up an intake field by its label, case-insensitively. */
  get(label: string): string | null;
}

const hours = (s: string | undefined) => {
  if (!s) return null;
  const m = s.match(/([\d.]+)\s*h/);
  return m ? Number(m[1]) : null;
};

const yesNoUnknown = (s: string | undefined): boolean | null => {
  if (!s) return null;
  if (/^yes$/i.test(s)) return true;
  if (/^no$/i.test(s)) return false;
  return null;
};

export function loadClaimsPro(dir: string, root = process.cwd()): ClaimsProSource {
  const abs = path.join(root, dir);
  const intakeMd = readFileSync(path.join(abs, "intake.md"), "utf8");
  const historyPath = path.join(abs, "status_history.md");
  const historyMd = existsSync(historyPath) ? readFileSync(historyPath, "utf8") : "";

  const intakeRows = parseKvTable(intakeMd);
  const intake: RawField[] = intakeRows.map((r) => ({ key: slug(r.label), label: r.label, value: r.value, source: "claimspro", document: "intake.md" }));
  const lossDescription = sectionAfter(intakeMd, /loss description/i).trim() || null;
  const intakePackage = bullets(sectionAfter(intakeMd, /package|intake package/i));

  const statusHistory: StatusEvent[] = parseTable(historyMd).map((r) => ({
    at: r["Timestamp"] ?? "",
    status: r["Status"] ?? "",
    actor: r["Actor"] ?? "",
    note: r["Note"] ?? "",
  }));
  const cycleRows = parseKvTable(historyMd, /cycle metrics/i);
  const cycle: RawField[] = cycleRows.map((r) => ({ key: slug(r.label), label: r.label, value: r.value, source: "claimspro", document: "status_history.md" }));
  const cycleGet = (re: RegExp) => cycleRows.find((r) => re.test(r.label))?.value;
  const documentsOnFile = bullets(sectionAfter(historyMd, /documents on file/i));

  const received = statusHistory.find((e) => /received/i.test(e.status));
  const firstTouch = statusHistory.find((e) => !/^system$/i.test(e.actor) && !/received|assigned/i.test(e.status));
  const closed = statusHistory.find((e) => /closed/i.test(e.status));

  const claimId = intakeRows.find((r) => /^claim id$/i.test(r.label))?.value ?? path.basename(dir);
  const files = readdirSync(abs).filter((f) => statSync(path.join(abs, f)).isFile());

  return {
    system: "claimspro",
    claimId,
    intake,
    lossDescription,
    intakePackage,
    statusHistory,
    cycle,
    documentsOnFile,
    receivedAt: received?.at ?? null,
    firstTouchAt: firstTouch?.at ?? null,
    closedAt: closed?.at ?? null,
    queueWaitHours: hours(cycleGet(/queue wait/i)),
    handlingHours: hours(cycleGet(/handling/i)),
    totalCycleHours: hours(cycleGet(/total cycle/i)),
    flaggedForHumanReview: yesNoUnknown(cycleGet(/flagged for human review/i)),
    requiresHumanByRegulation: yesNoUnknown(cycleGet(/requires human by regulation/i)),
    files,
    get(label: string) {
      const hit = intakeRows.find((r) => r.label.toLowerCase() === label.toLowerCase());
      return hit ? hit.value : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Snowflake
// ---------------------------------------------------------------------------

export interface SnowflakeSource {
  system: "snowflake";
  claimId: string;
  row: ExtractRow | null;
  /** Which file the row came from, or null when the claim has no row. */
  rowFrom: string | null;
  fields: RawField[];
  policy: {
    policyNumber: string | null;
    policyholder: string | null;
    claimant: string | null;
    vehicle: string | null;
    vin: string | null;
    plate: string | null;
    policyEffective: string | null;
    policyExpiry: string | null;
    country: "US" | "CA" | "other";
  };
  policyStatus: "in_force" | "lapsed" | "unknown";
  policyStatusBasis: string;
  priorClaimsOnPolicy: number;
  priorClaimsBasis: string;
  priorClaimIds: string[];
}

const CANADIAN_PROVINCES = new Set(["ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"]);

function cmpDate(a: string, b: string) {
  return a.slice(0, 10).localeCompare(b.slice(0, 10));
}

export function loadSnowflake(dir: string, claimsPro: ClaimsProSource, root = process.cwd()): SnowflakeSource {
  const found = findExtractRow(claimsPro.claimId, path.join(root, dir), root);
  const row = found?.row ?? null;
  const fields: RawField[] = [];
  const doc = found?.from ?? "(no extract row)";
  if (row) {
    const add = (key: string, label: string, value: string | number | boolean | null) => {
      if (value !== null) fields.push({ key, label, value: typeof value === "boolean" ? (value ? "Yes" : "No") : String(value), source: "snowflake", document: doc });
    };
    add("claim_amount_usd", "Claim amount (USD)", row.claimAmountUsd);
    add("state", "State", row.state);
    add("claim_type", "Claim type", row.claimType);
    add("intake_channel", "Intake channel", row.intakeChannel);
    add("filed_date", "Filed date", row.filedDate);
    add("complexity", "Complexity", row.complexity);
    add("flagged_for_human_review", "Flagged for human review (today's rules engine)", row.flaggedForHumanReview);
    add("requires_human_by_regulation", "Requires human by regulation", row.requiresHumanByRegulation);
    add("queue_wait_hours", "Queue wait (hours)", row.queueWaitHours);
    add("document_count", "Documents on file", row.documentCount);
    add("automation_eligibility_score", "2021 eligibility score (not used)", row.automationEligibilityScore);
  }
  // Policy fields live on the policy record in Snowflake; the intake export carries the same values.
  const pol = (label: string) => claimsPro.get(label);
  const policyField = (key: string, ...labels: string[]) => {
    for (const l of labels) {
      const v = pol(l);
      if (v) {
        fields.push({ key, label: l, value: v, source: "snowflake", document: "intake.md (policy fields)" });
        return v;
      }
    }
    return null;
  };
  const policyNumber = policyField("policy_number", "Policy #", "Policy number");
  const policyholder = policyField("policyholder", "Policyholder");
  const claimant = policyField("claimant", "Claimant");
  const vehicle = policyField("vehicle", "Vehicle", "Vehicle (insured)");
  const vin = policyField("vin", "VIN");
  const plate = policyField("plate", "Plate");
  const policyEffective = policyField("policy_effective", "Policy effective", "Policy effective date");
  const policyExpiry = policyField("policy_expiry", "Policy expiry", "Policy expiry date", "Policy expires");
  const countryRaw = pol("Country") ?? pol("Policyholder country");
  const state = pol("Loss state") ?? row?.state ?? "";
  const country: SnowflakeSource["policy"]["country"] = countryRaw
    ? /canada|^ca$/i.test(countryRaw)
      ? "CA"
      : /united states|^us$|^usa$/i.test(countryRaw)
        ? "US"
        : "other"
    : CANADIAN_PROVINCES.has(state.toUpperCase())
      ? "CA"
      : "US";
  if (countryRaw) fields.push({ key: "country", label: "Country", value: countryRaw, source: "snowflake", document: "intake.md (policy fields)" });

  const dol = pol("Date of loss");
  let policyStatus: SnowflakeSource["policyStatus"] = "unknown";
  let policyStatusBasis = "Policy period not in the sample export; coverage is verified on the ClaimsPro Coverage screen.";
  if (policyEffective && policyExpiry && dol) {
    const inForce = cmpDate(policyEffective, dol) <= 0 && cmpDate(dol, policyExpiry) <= 0;
    policyStatus = inForce ? "in_force" : "lapsed";
    policyStatusBasis = `Date of loss ${dol} against policy period ${policyEffective} to ${policyExpiry}.`;
  }

  const prior = pol("Prior claims on policy") ?? pol("Prior claims");
  const priorIds = prior ? (prior.match(/IS-CLM-\d+/g) ?? []) : [];
  const priorCount = prior ? (Number(prior.match(/^\d+/)?.[0] ?? priorIds.length) || priorIds.length) : 0;

  return {
    system: "snowflake",
    claimId: claimsPro.claimId,
    row,
    rowFrom: found?.from ?? null,
    fields,
    policy: { policyNumber, policyholder, claimant, vehicle, vin, plate, policyEffective, policyExpiry, country },
    policyStatus,
    policyStatusBasis,
    priorClaimsOnPolicy: priorCount,
    priorClaimsBasis: prior ? `From the policy record: ${prior}` : "The extract is masked on policyholder fields, so prior claims cannot be joined; none on file in the sample.",
    priorClaimIds: priorIds,
  };
}

// ---------------------------------------------------------------------------
// Databricks
// ---------------------------------------------------------------------------

export type DocumentKind = "adjuster_notes" | "call_transcript" | "ocr_text" | "edi_record" | "pdf" | "photo" | "other";

export interface ClaimDocument {
  name: string;
  /** Relative to the repo root. */
  path: string;
  kind: DocumentKind;
  text: string | null;
  /** The producing engine's own confidence, where the document states one (OCR, ASR). */
  engineConfidence: number | null;
  confidenceBasis: string | null;
  pages: { page: number; image: string }[];
  bytes: number;
}

export interface DatabricksSource {
  system: "databricks";
  claimId: string;
  documents: ClaimDocument[];
  notes: ClaimDocument | null;
  transcript: ClaimDocument | null;
  ocr: ClaimDocument | null;
  edi: ClaimDocument | null;
  pdfs: ClaimDocument[];
  photos: ClaimDocument[];
}

function kindOf(name: string): DocumentKind {
  const n = name.toLowerCase();
  if (n === "adjuster_notes.md") return "adjuster_notes";
  if (n === "call_excerpt.md" || n.includes("transcript")) return "call_transcript";
  if (n === "ocr_output.txt") return "ocr_text";
  if (n === "edi_record.txt") return "edi_record";
  if (n.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp)$/.test(n)) return "photo";
  return "other";
}

function engineConfidence(kind: DocumentKind, text: string | null): { value: number | null; basis: string | null } {
  if (!text) return { value: null, basis: null };
  if (kind === "ocr_text") {
    const m = text.match(/conf\s+([0-9.]+)/);
    return m ? { value: Number(m[1]), basis: "Reported by the OCR engine for the whole document" } : { value: null, basis: null };
  }
  if (kind === "call_transcript") {
    const m = text.match(/avg confidence\s+([0-9.]+)/);
    const low = (text.match(/\[\*\]/g) ?? []).length;
    return m ? { value: Number(m[1]), basis: `Reported by the ASR engine; ${low} token${low === 1 ? "" : "s"} marked low-confidence` } : { value: null, basis: null };
  }
  return { value: null, basis: null };
}

export function loadDatabricks(dir: string, claimId: string, root = process.cwd()): DatabricksSource {
  const abs = path.join(root, dir);
  const documents: ClaimDocument[] = [];
  const skip = new Set(["intake.md", "status_history.md", "provenance.json", "extract.csv", "SOURCES.md"]);
  for (const name of readdirSync(abs).sort()) {
    const p = path.join(abs, name);
    if (!statSync(p).isFile() || skip.has(name)) continue;
    const kind = kindOf(name);
    const textual = kind === "adjuster_notes" || kind === "call_transcript" || kind === "ocr_text" || kind === "edi_record" || (kind === "other" && /\.(md|txt)$/.test(name));
    const text = textual ? readFileSync(p, "utf8") : null;
    const conf = engineConfidence(kind, text);
    const pages: ClaimDocument["pages"] = [];
    if (kind === "pdf") {
      const base = name.replace(/\.pdf$/i, "");
      const pagesDir = path.join(abs, "pages");
      if (existsSync(pagesDir)) {
        for (const f of readdirSync(pagesDir).sort()) {
          const m = f.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.png$`));
          if (m) pages.push({ page: Number(m[1]), image: path.join(dir, "pages", f) });
        }
        pages.sort((a, b) => a.page - b.page);
      }
    }
    documents.push({ name, path: path.join(dir, name), kind, text, engineConfidence: conf.value, confidenceBasis: conf.basis, pages, bytes: statSync(p).size });
  }
  const photosDir = path.join(abs, "photos");
  if (existsSync(photosDir)) {
    for (const name of readdirSync(photosDir).sort()) {
      if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
      documents.push({ name, path: path.join(dir, "photos", name), kind: "photo", text: null, engineConfidence: null, confidenceBasis: null, pages: [], bytes: statSync(path.join(photosDir, name)).size });
    }
  }
  const one = (k: DocumentKind) => documents.find((d) => d.kind === k) ?? null;
  return {
    system: "databricks",
    claimId,
    documents,
    notes: one("adjuster_notes"),
    transcript: one("call_transcript"),
    ocr: one("ocr_text"),
    edi: one("edi_record"),
    pdfs: documents.filter((d) => d.kind === "pdf"),
    photos: documents.filter((d) => d.kind === "photo"),
  };
}

// ---------------------------------------------------------------------------
// Typed views of the intake fields, used by the header builder.
// ---------------------------------------------------------------------------

export function claimTypeOf(s: string | null): ClaimType | null {
  const t = (s ?? "").trim().toLowerCase();
  if (t === "collision") return "Collision";
  if (t === "comprehensive") return "Comprehensive";
  if (t === "bodily injury") return "Bodily Injury";
  if (t === "property damage") return "Property Damage";
  if (t === "liability") return "Liability";
  return null;
}

export function channelOf(s: string | null): Channel | null {
  const t = (s ?? "").trim().toLowerCase();
  if (t === "e-portal" || t === "portal") return "E-Portal";
  if (t === "phone") return "Phone";
  if (t === "fax/edi" || t === "fax" || t === "edi") return "Fax/EDI";
  return null;
}

export function complexityOf(s: string | null): Complexity | null {
  const t = (s ?? "").trim().toLowerCase();
  if (t === "simple") return "Simple";
  if (t === "moderate") return "Moderate";
  if (t === "complex") return "Complex";
  return null;
}

export function parseUsd(s: string | null): number | null {
  if (!s) return null;
  const m = s.replace(/[$,\s]/g, "").match(/^-?\d+(\.\d+)?$/);
  return m ? Number(m[0]) : null;
}
