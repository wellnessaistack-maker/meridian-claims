// Reads the fields the EDI 837 record carries, in code. The parser Meridian runs
// drops missing fields silently (about one submission in eight); this one says
// which segments are empty.

import type { RawField } from "./sources.ts";

export interface EdiExtraction {
  fields: RawField[];
  claimAmount: number | null;
  dateOfLoss: string | null;
  estimateRef: string | null;
  serviceAmount: number | null;
  claimantAddressPresent: boolean;
  claimantContactPresent: boolean;
  emptySegments: string[];
  policyNumber: string | null;
}

const d8 = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);

export function parseEdi(text: string, document = "edi_record.txt"): EdiExtraction {
  const segs = text
    .split("~")
    .map((s) => s.trim())
    .filter((s) => /^[A-Z0-9]{2,3}\*/.test(s) || /^[A-Z0-9]{2,3}$/.test(s));
  const fields: RawField[] = [];
  const add = (key: string, label: string, value: string) => fields.push({ key, label, value, source: "databricks", document });
  let claimAmount: number | null = null;
  let dateOfLoss: string | null = null;
  let estimateRef: string | null = null;
  let serviceAmount: number | null = null;
  let policyNumber: string | null = null;
  let claimantAddressPresent = false;
  let claimantContactPresent = false;
  const emptySegments: string[] = [];
  let inClaimantLoop = false;

  for (const seg of segs) {
    const e = seg.split("*");
    const id = e[0];
    if (id === "CLM") {
      claimAmount = Number(e[2]) || null;
      if (claimAmount !== null) add("edi_claim_amount", "Claim amount (EDI CLM02)", claimAmount.toFixed(2));
    } else if (id === "DTP" && e[1] === "439") {
      dateOfLoss = d8(e[3] ?? "");
      add("edi_date_of_loss", "Accident date (EDI DTP*439)", dateOfLoss);
    } else if (id === "REF" && e[1] === "D9") {
      estimateRef = e[2] ?? null;
      if (estimateRef) add("edi_estimate_ref", "Estimate reference (EDI REF*D9)", estimateRef);
    } else if (id === "SV1") {
      serviceAmount = Number(e[2]) || null;
      if (serviceAmount !== null) add("edi_service_amount", "Service line amount (EDI SV1)", serviceAmount.toFixed(2));
    } else if (id === "NM1" && e[1] === "IL") {
      policyNumber = e[9] ?? null;
      if (policyNumber) add("edi_policy_number", "Policy number (EDI NM1*IL)", policyNumber);
      inClaimantLoop = false;
    } else if (id === "NM1" && e[1] === "QC") {
      inClaimantLoop = true;
      add("edi_claimant_present", "Claimant segment (EDI NM1*QC)", "present");
    } else if (id === "N3") {
      const addr = e.slice(1).join("*").trim();
      if (inClaimantLoop) {
        claimantAddressPresent = addr.length > 0;
        if (!addr) emptySegments.push("N3 (claimant address)");
      }
    } else if (id === "PER" && inClaimantLoop) {
      claimantContactPresent = e.length > 4 && Boolean(e[4]);
    } else if (id === "DMG" && inClaimantLoop) {
      if (/0000$/.test(e[2] ?? "")) emptySegments.push("DMG (claimant date of birth, partial)");
    } else if (id === "HL") {
      // A new hierarchical level ends the claimant name loop unless it is the claimant level itself.
      if (e[3] !== "22") inClaimantLoop = false;
    }
  }
  if (!claimantContactPresent) emptySegments.push("PER (claimant contact)");
  add("edi_claimant_address", "Claimant address (EDI N3)", claimantAddressPresent ? "present" : "blank");
  add("edi_claimant_contact", "Claimant contact (EDI PER)", claimantContactPresent ? "present" : "absent");
  return { fields, claimAmount, dateOfLoss, estimateRef, serviceAmount, claimantAddressPresent, claimantContactPresent, emptySegments, policyNumber };
}
