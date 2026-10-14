// What has to be on file before a claim of each type can be decided. Compared
// against the ClaimsPro document index and the files in the claim folder. Plain
// code: this is the fourth agent tool, check_completeness, and it never calls a model.

import type { ClaimType } from "../extract/csv.ts";
import type { LoadedClaim } from "../claim/load.ts";
import type { EvidenceItem, MissingItem, Source } from "../claim/schema.ts";

export interface ChecklistContext {
  claimType: ClaimType;
  /** The intake says vehicle damage is claimed as well as injury. */
  vehicleDamageClaimed: boolean;
  theft: boolean;
}

interface Found {
  document: string | null;
  source: Source;
  note?: string;
}

export interface ChecklistItemDef {
  id: string;
  label: string;
  why: string;
  from: MissingItem["from"];
  appliesTo: (ctx: ChecklistContext) => boolean;
  detect: (c: LoadedClaim) => Found | null;
}

const ALL = () => true;
const VEHICLE: ClaimType[] = ["Collision", "Comprehensive", "Property Damage"];

const inIndex = (c: LoadedClaim, re: RegExp): Found | null => {
  const hit = c.claimsPro.documentsOnFile.find((d) => re.test(d));
  return hit ? { document: "status_history.md", source: "claimspro", note: `Listed in the ClaimsPro document index: "${hit}"` } : null;
};
const file = (c: LoadedClaim, re: RegExp): Found | null => {
  const hit = c.databricks.documents.find((d) => re.test(d.name));
  return hit ? { document: hit.name, source: "databricks" } : null;
};
const intakeRow = (c: LoadedClaim, re: RegExp): Found | null => {
  const hit = c.claimsPro.intake.find((f) => re.test(f.label) && f.value.trim() && !/^(none|n\/a|-|blank|not on file)$/i.test(f.value.trim()));
  return hit ? { document: "intake.md", source: "claimspro", note: `${hit.label}: ${hit.value}` } : null;
};

export const CHECKLIST: ChecklistItemDef[] = [
  {
    id: "fnol_record",
    label: "First notice of loss record",
    why: "The claim cannot be worked without the intake record.",
    from: "internal",
    appliesTo: ALL,
    detect: (c) => (c.claimsPro.intake.length ? { document: "intake.md", source: "claimspro" } : null),
  },
  {
    id: "loss_description",
    label: "Description of the loss",
    why: "What happened, in the claimant's or agent's words, is the basis for every coverage check.",
    from: "claimant",
    appliesTo: ALL,
    detect: (c) => (c.claimsPro.lossDescription ? { document: "intake.md", source: "claimspro" } : null),
  },
  {
    id: "vehicle_identified",
    label: "Insured vehicle identified",
    why: "Coverage attaches to a specific vehicle on the policy.",
    from: "internal",
    appliesTo: (x) => VEHICLE.includes(x.claimType) || x.vehicleDamageClaimed,
    detect: (c) => intakeRow(c, /^VIN$/i) ?? intakeRow(c, /^vehicle/i),
  },
  {
    id: "damage_photos",
    label: "Damage photographs",
    why: "Photos are the evidence that the damage matches the loss described.",
    from: "claimant",
    appliesTo: (x) => VEHICLE.includes(x.claimType) || x.vehicleDamageClaimed,
    detect: (c) => (c.databricks.photos.length ? { document: "photos/", source: "databricks", note: `${c.databricks.photos.length} photo${c.databricks.photos.length === 1 ? "" : "s"}` } : inIndex(c, /photograph|photo\b/i)),
  },
  {
    id: "repair_estimate",
    label: "Repair estimate",
    why: "The amount claimed has to be supported by a shop estimate or an invoice.",
    from: "provider",
    appliesTo: (x) => (VEHICLE.includes(x.claimType) && !x.theft) || x.vehicleDamageClaimed,
    detect: (c) => file(c, /estimate/i) ?? (c.ocr ? { document: c.ocr.document, source: "databricks", note: "Faxed estimate, OCR text" } : null) ?? inIndex(c, /estimate|invoice|appraisal|quote/i),
  },
  {
    id: "claimant_contact",
    label: "Claimant contact details",
    why: "Nothing can be requested or paid without a way to reach the claimant.",
    from: "claimant",
    appliesTo: (x) => ["Bodily Injury", "Property Damage", "Liability"].includes(x.claimType),
    detect: (c) => {
      const row = intakeRow(c, /claimant (contact|phone|email)/i);
      if (row) return row;
      const ocr = c.ocr?.fields.find((f) => f.key === "ocr_claimant_contact");
      if (ocr?.value) return { document: c.ocr!.document, source: "databricks", note: ocr.value };
      if (c.edi?.claimantContactPresent) return { document: "edi_record.txt", source: "databricks", note: "PER segment" };
      if (c.header.channel === "Phone" && c.databricks.transcript?.text && /best number|reach you/i.test(c.databricks.transcript.text)) {
        return { document: c.databricks.transcript.name, source: "databricks", note: "Call-back number captured at FNOL" };
      }
      return null;
    },
  },
  {
    id: "claimant_account",
    label: "Claimant's account of the injury",
    why: "The injury timeline starts from the claimant's own account: a statement or the FNOL call.",
    from: "claimant",
    appliesTo: (x) => ["Bodily Injury", "Liability"].includes(x.claimType),
    detect: (c) => (c.databricks.transcript ? { document: c.databricks.transcript.name, source: "databricks" } : inIndex(c, /statement|transcript|recorded/i)),
  },
  {
    id: "medical_documentation",
    label: "Medical documentation",
    why: "Injury and treatment have to be documented by a provider before causation can be assessed.",
    from: "provider",
    appliesTo: (x) => x.claimType === "Bodily Injury",
    detect: (c) => file(c, /medical/i) ?? inIndex(c, /medical/i),
  },
  {
    id: "police_report",
    label: "Police or incident report",
    why: "An independent account of the incident: who was involved, where, and when.",
    from: "provider",
    appliesTo: (x) => ["Bodily Injury", "Liability"].includes(x.claimType) || x.theft,
    detect: (c) => file(c, /police|incident/i) ?? inIndex(c, /police|incident report|theft report/i),
  },
  {
    id: "third_party_details",
    label: "Third party details",
    why: "A property damage or liability claim needs the other party identified.",
    from: "claimant",
    appliesTo: (x) => ["Property Damage", "Liability"].includes(x.claimType),
    detect: (c) => intakeRow(c, /third party/i),
  },
  {
    id: "third_party_demand",
    label: "Claim or demand from the third party",
    why: "A liability claim is decided against what the third party is asking for.",
    from: "provider",
    appliesTo: (x) => x.claimType === "Liability",
    detect: (c) => file(c, /demand|claim_letter/i) ?? inIndex(c, /demand|claim letter|attorney/i),
  },
];

export function checklistContext(c: LoadedClaim): ChecklistContext {
  const text = `${c.claimsPro.lossDescription ?? ""} ${c.claimsPro.intakePackage.join(" ")}`.toLowerCase();
  return {
    claimType: c.header.claimType,
    vehicleDamageClaimed: c.header.claimType === "Bodily Injury" && /vehicle damage|damage to the (insured|claimant)|estimate/.test(text),
    theft: /theft|stolen/.test(text),
  };
}

export interface CompletenessResult {
  items: EvidenceItem[];
  completeness: number;
  missing: MissingItem[];
  present: number;
  required: number;
}

export function checkCompleteness(c: LoadedClaim): CompletenessResult {
  const ctx = checklistContext(c);
  const items: EvidenceItem[] = [];
  const missing: MissingItem[] = [];
  for (const def of CHECKLIST) {
    if (!def.appliesTo(ctx)) continue;
    const found = def.detect(c);
    items.push({ id: def.id, label: def.label, present: Boolean(found), document: found?.document ?? null, source: found?.source ?? null, note: found?.note ?? null });
    if (!found) missing.push({ id: def.id, label: def.label, why: def.why, from: def.from });
  }
  const present = items.filter((i) => i.present).length;
  return { items, completeness: items.length ? present / items.length : 1, missing, present, required: items.length };
}
