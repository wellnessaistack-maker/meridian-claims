// Builds the variant claims under sample_claims_variants/ from the three
// provided claims. Each variant is the parent folder with one documented
// change, a provenance.json and its own extract.csv row. Never hand-edit a
// variant: change this script and run `npm run make-variants`.
//
//   node scripts/make-variants.ts

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

import { loadExtract, parseExtractCsv, rowToCsvLine, EXTRACT_HEADER, type ExtractRow } from "../lib/extract/csv.ts";

const SRC = path.join("meridian", "sample_claims");
const OUT = "sample_claims_variants";

interface Variant {
  id: string;
  parent: string;
  /** Where the parent lives; the three provided claims by default. */
  src?: string;
  change: string;
  /** Edits to the extract row for this variant. */
  row: (r: ExtractRow) => ExtractRow;
  /** Edits to the copied folder. */
  apply: (dir: string) => Promise<void> | void;
}

const textFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return textFiles(p);
    return /\.(md|txt|csv|json)$/.test(n) ? [p] : [];
  });

const edit = (file: string, fn: (s: string) => string) => {
  const before = readFileSync(file, "utf8");
  const after = fn(before);
  if (after === before) throw new Error(`${file}: the edit changed nothing; the variant would be a plain copy.`);
  writeFileSync(file, after);
};

const VARIANTS: Variant[] = [
  {
    id: "IS-CLM-2025900001-F",
    parent: "IS-CLM-2025900001",
    src: "sample_claims_mock",
    change: "repair estimate missing",
    row: (r) => ({ ...r, documentCount: 3 }),
    apply: (dir) => {
      rmSync(path.join(dir, "repair_estimate.md"));
      edit(path.join(dir, "intake.md"), (s) => s.replace("- Repair estimate (Boulder Valley Euro Works, est. BV-7718) — `repair_estimate.md`\n", "").replace("All required E-Portal fields were populated at submission.", "The estimate field was left empty at submission; the portal accepted the filing without it."));
      edit(path.join(dir, "status_history.md"), (s) => s.replace("| Documents on file | 4 |", "| Documents on file | 3 |").replace("## Documents on file (4)", "## Documents on file (3)").replace("2. Repair estimate — Boulder Valley Euro Works (BV-7718)\n3. Damage photograph — rear three-quarter, vehicle in standing water\n4. Weather notice", "2. Damage photograph — rear three-quarter, vehicle in standing water\n3. Weather notice").replace("E-Portal FNOL; package complete", "E-Portal FNOL; estimate not attached"));
      edit(path.join(dir, "adjuster_notes.md"), (s) => s.replace("One photo, car sitting in water to the sills. Est BV-7718\n$4,480 reads like a flood clean-up, no bodywork.", "One photo, car sitting in water to the sills. No estimate\nin the package; $4,480 claimed with nothing behind it yet.").replace("Nothing to chase.", "Need the shop's estimate before this moves."));
    },
  },
  {
    id: "IS-CLM-2025900001-G",
    parent: "IS-CLM-2025900001",
    src: "sample_claims_mock",
    change: "damage photo missing",
    row: (r) => ({ ...r, documentCount: 3 }),
    apply: (dir) => {
      rmSync(path.join(dir, "photos"), { recursive: true });
      edit(path.join(dir, "intake.md"), (s) => s.replace("- Damage photograph (1) — see `photos/`\n", "").replace("All required E-Portal fields were populated at submission.", "No photograph was attached at submission; the portal accepted the filing without one."));
      edit(path.join(dir, "status_history.md"), (s) => s.replace("| Documents on file | 4 |", "| Documents on file | 3 |").replace("## Documents on file (4)", "## Documents on file (3)").replace("3. Damage photograph — rear three-quarter, vehicle in standing water\n4. Weather notice", "3. Weather notice").replace("E-Portal FNOL; package complete", "E-Portal FNOL; no photograph attached"));
      edit(path.join(dir, "adjuster_notes.md"), (s) => s.replace("One photo, car sitting in water to the sills. Est BV-7718", "No photo in the package. Est BV-7718").replace("Nothing to chase.", "Need a photo of the car before this moves."));
    },
  },
  {
    id: "IS-CLM-2025000300-A",
    parent: "IS-CLM-2025000300",
    change: "repair estimate missing",
    row: (r) => ({ ...r, documentCount: 3, disposition: "Pending Review" }),
    apply: (dir) => {
      rmSync(path.join(dir, "repair_estimate.pdf"));
      rmSync(path.join(dir, "pages"), { recursive: true });
      edit(path.join(dir, "intake.md"), (s) => s.replace(/- Repair estimate \(Gulf Coast Collision Center, est\. GC-24418\) — `repair_estimate\.pdf`\n/, "").replace("All required E-Portal fields were populated at submission. No follow-up requested.", "The estimate field was left empty at submission; the portal accepted the filing without it."));
      edit(path.join(dir, "status_history.md"), (s) => s.replace("| Documents on file | 4 |", "| Documents on file | 3 |").replace("## Documents on file (4)", "## Documents on file (3)").replace("2. Repair estimate — Gulf Coast Collision Center (GC-24418)\n3. Damage photograph — front left\n4. Damage photograph — LH headlamp", "2. Damage photograph — front left\n3. Damage photograph — LH headlamp").replace(/\| 2025-06-20 14:36 \| In Review \|.*\n\| 2025-06-20 16:00 \|.*\n\| 2025-06-20 18:30 \|.*\n\| 2025-06-20 18:54 \|.*\n/, ""));
      edit(path.join(dir, "adjuster_notes.md"), (s) => s.replace(/Photos \+ shop est in package at FNOL, all\nfields populated\. Nice change of pace\./, "Photos in package at FNOL but no shop estimate\nattached; estimate field empty.").replace(/Est GC-24418 \$2,825\.07, line items reasonable for\nFL market on first pass\. Queuing for coverage review\.\n\n[\s\S]*$/, "Claimed $2,825.07 with nothing to support the\nnumber yet. Need the estimate before this goes anywhere.\n"));
    },
  },
  {
    id: "IS-CLM-2025000300-B",
    parent: "IS-CLM-2025000300",
    change: "claim amount $10,100",
    row: (r) => ({ ...r, claimAmountUsd: 10100, complexity: "Moderate", disposition: "Pending Review" }),
    apply: (dir) => {
      edit(path.join(dir, "intake.md"), (s) => s.replace("| Claim amount | $2,825.07 |", "| Claim amount | $10,100.00 |").replace("| Complexity | Simple |", "| Complexity | Moderate |"));
      edit(path.join(dir, "status_history.md"), (s) => s.replace(/\| 2025-06-20 14:36 \| In Review \|.*\n\| 2025-06-20 16:00 \|.*\n\| 2025-06-20 18:30 \|.*\n\| 2025-06-20 18:54 \|.*\n/, ""));
      edit(path.join(dir, "adjuster_notes.md"), (s) => s.replace(/Est GC-24418 \$2,825\.07, line items reasonable for\nFL market on first pass\. Queuing for coverage review\.\n\n[\s\S]*$/, "Claim amount keyed as $10,100.00 at FNOL; est GC-24418 on\nfile reads $2,825.07. Not touching this until the number is explained.\n"));
    },
  },
  {
    id: "IS-CLM-2025000300-C",
    parent: "IS-CLM-2025000300",
    change: "loss state Texas, regulatory flag blank",
    row: (r) => ({ ...r, state: "TX", requiresHumanByRegulation: null, disposition: "Pending Review" }),
    apply: (dir) => {
      edit(path.join(dir, "intake.md"), (s) => s.replace("| Loss state | FL |", "| Loss state | TX |").replace("| Plate | FL SLX-4471 |", "| Plate | TX SLX-4471 |"));
      edit(path.join(dir, "status_history.md"), (s) => s.replace("| Requires human by regulation | No |", "| Requires human by regulation | |").replace(/\| 2025-06-20 14:36 \| In Review \|.*\n\| 2025-06-20 16:00 \|.*\n\| 2025-06-20 18:30 \|.*\n\| 2025-06-20 18:54 \|.*\n/, ""));
      edit(path.join(dir, "adjuster_notes.md"), (s) => s.replace("line items reasonable for\nFL market", "line items reasonable for\nTX market").replace(/\n2025-06-20 — [\s\S]*$/, "\n"));
    },
  },
  {
    id: "IS-CLM-2025002993-D",
    parent: "IS-CLM-2025002993",
    change: "clean OCR of the same fax",
    row: (r) => ({ ...r }),
    apply: (dir) => {
      edit(path.join(dir, "ocr_output.txt"), () => CLEAN_OCR);
      edit(path.join(dir, "adjuster_notes.md"), (s) => s.replace("OCR est is a mess — re-keying line items against the fax by hand.\nRear bumper line came through garbled, confirmed 1,800.00 off the original.", "OCR est came through clean this time; line items match the fax.\nRear bumper line reads 1,800.00."));
    },
  },
  {
    id: "IS-CLM-2025004222-E",
    parent: "IS-CLM-2025004222",
    change: "medical visit on the day of loss",
    row: (r) => ({ ...r }),
    apply: async (dir) => {
      // The medical summary is an image-only PDF; the date of service is repainted on the page image and the PDF rebuilt from it.
      const page = path.join(dir, "pages", "medical_summary-1.png");
      const img = sharp(page);
      const { width, height } = await img.metadata();
      const svg = `<svg width="${width}" height="${height}"><rect x="${0.197 * width!}" y="${0.232 * height!}" width="${0.1 * width!}" height="${0.016 * height!}" fill="white"/><text x="${0.198 * width!}" y="${0.2455 * height!}" font-family="Courier New, Courier, monospace" font-size="${0.0128 * height!}" fill="#222">2025-09-19</text></svg>`;
      const out = await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
      writeFileSync(page, out);
      execFileSync("python3", ["-c", `from PIL import Image; Image.open(${JSON.stringify(page)}).convert("RGB").save(${JSON.stringify(path.join(dir, "medical_summary.pdf"))}, resolution=110)`]);
      edit(path.join(dir, "call_excerpt.md"), (s) => s.replace("I went in to the\northopedic place a couple days after,", "I went in to the\northopedic place that same afternoon,"));
      edit(path.join(dir, "adjuster_notes.md"), (s) => s.replace("Clmt says onset day-of; med summary\nDOS is 3 days post, chief complaint consistent but the causation link isn't\nairtight on the docs I have.", "Clmt says onset day-of; med summary\nDOS is the same day, chief complaint consistent. Causation link reads clean\non the docs I have.").replace("Onset gap explained (clmt worked through it before seeking care — common).\n", ""));
    },
  },
];

/** The 2993 fax as a 0.96-confidence OCR engine would read it: same layout, no glyph confusion. The scan edge still cuts the claimant contact. */
const CLEAN_OCR = `--- ClaimsPro OCR extract | source: inbound fax | claim IS-CLM-2025002993-D | conf 0.96 ---

--- fax cover / claimant block ---
* * * FACSIMILE TRANSMITTAL * * * INLAND AUTO BODY -- FONTANA CA
TO Meridian Claims Intake FROM R Salcedo Inland Auto Body FAX (877) 555-0100
RE New claim -- Policy CA-CA-88123-18 DATE 09/08/2025 PAGES 7 incl cover
Estimate + supplement for the above claim Damage photos to follow under separate cover
CLAIMANT GLORIA MENDEZ  DOL 09/08/2025  CLAIMANT CONTACT ____________ [scan edge]
POLICYHOLDER PACIFIC FREIGHT PARTNERS INC POLICY CA-CA-88123-18

--- estimate p.1 vehicle / claim ---
INLAND AUTO BODY 1155 S Cucamonga Ave Fontana CA 92337 (909) 555-0173 BAR AB-204471
VEHICLE REPAIR ESTIMATE Estimate # IAB-9930 Written 2025-09-05 Claim # pending assignment
Adjuster -- Estimator R Salcedo Type Original Insured Pacific Freight Partners Inc
Policy CA-CA-88123-18 Claimant Gloria Mendez bodily injury claim
Vehicle 2018 Freightliner M2 106 Medium Duty Unit PFP-114 Odometer 128,540 Loss rear impact

--- estimate p.2 damage assessment ---
DAMAGE ASSESSMENT Point of impact rear 6 o'clock offset right Inspection in-shop unit on ground
Rear bumper cover deformed and torn at RH mount reinforcement bar to be R&I and inspected
RH cargo door skin creased hinge alignment off door to be replaced RH tail lamp lens cracked
housing separated replace assembly NOTE rear quarter shows corrosion and prior paint edges
not consistent with a fresh impact flagged for adjuster review photographs on file
rear bumper rear quarter cargo door

--- estimate p.3 line items ---
LN DESCRIPTION OPER HRS AMOUNT 1 Bumper cover rear R&R 1,800.00 2 Cargo door rear RH R&R 640.00
3 Tail lamp assembly RH R&R 288.50 Paint & materials -- 120.00 4 R&I rear bumper reinf BODY 1.5
93.00 5 R&R cargo door rear RH BODY 2.5 155.00 6 Align fit rear body BODY 2.0 124.00
7 Refinish rear panel door REFN 3.0 186.00 Parts & materials 2,848.50 Labor 558.00

--- estimate p.4 parts detail ---
PARTS DETAIL LN DESCRIPTION PART NO QTY PRICE 1 Bumper cover rear A66-11288-000 1
2 Cargo door rear RH A18-66341-002 1 640.00 3 Tail lamp assembly RH A66-06327-001 1 288.50
OEM parts via Freightliner Daimler dealer feed part numbers per unit VIN build

--- estimate p.5 labor + materials ---
LABOR OPERATIONS LN DESCRIPTION OPER HRS RATE AMOUNT 4 R&I rear bumper reinf BODY 1.5 62.00 93.00
5 R&R cargo door rear RH BODY 2.5 62.00 155.00 6 Align fit rear body BODY 2.0 62.00 124.00
7 Refinish rear panel door REFN 3.0 62.00 186.00 Body 6.0 hr Refinish 3.0 hr Labor total 558.00
PAINT & MATERIALS Color base coat 48.00 Clearcoat 30.00 Primer sealer 22.00
Hazardous waste disposal 12.00 Masking fine line 8.00 Paint & materials total 120.00

--- estimate p.6 recap ---
ESTIMATE RECAP Parts 2,728.50 Paint & materials 120.00 Labor 558.00 Sales tax 8.75% 249.24
VEHICLE TOTAL 3,655.74 Vehicle damage only Bodily injury medical handled separately
Estimator R Salcedo Shop Inland Auto Body BAR AB-204471 Date 2025-09-05

--- end OCR extract ---
`;

const rows = loadExtract();
mkdirSync(OUT, { recursive: true });
for (const v of VARIANTS) {
  const dir = path.join(OUT, v.id);
  rmSync(dir, { recursive: true, force: true });
  const src = v.src ?? SRC;
  cpSync(path.join(src, v.parent), dir, { recursive: true });
  // The variant has its own claim ID everywhere the parent's appears, so nothing joins back to the parent by accident.
  for (const f of textFiles(dir)) {
    const s = readFileSync(f, "utf8");
    if (s.includes(v.parent)) writeFileSync(f, s.split(v.parent).join(v.id));
  }
  await v.apply(dir);
  const parentCsv = path.join(src, v.parent, "extract.csv");
  const parentRow = existsSync(parentCsv) ? parseExtractCsv(readFileSync(parentCsv, "utf8"))[0] : rows.find((r) => r.claimId === v.parent);
  if (!parentRow) throw new Error(`No extract row for ${v.parent}`);
  const row = v.row({ ...parentRow, claimId: v.id });
  writeFileSync(path.join(dir, "extract.csv"), `${EXTRACT_HEADER}\n${rowToCsvLine(row)}\n`);
  writeFileSync(path.join(dir, "provenance.json"), JSON.stringify({ kind: "variant", label: `Variant of ${v.parent} (${v.change})`, parentId: v.parent, change: v.change, generatedBy: "scripts/make-variants.ts" }, null, 2) + "\n");
  console.log(`${v.id}: ${v.change} -> ${dir}${existsSync(path.join(dir, "photos")) ? "" : " (no photos)"}`);
}
