// Reads specific fields out of the fax OCR text, in code, with a measured
// confidence per field. No model here. The vision re-read (an agent tool) is
// only allowed on fields whose confidence is below the threshold or blank.
//
// How per-field confidence is measured. The 2022 OCR engine reports one number
// for the whole document (0.69 on the sample fax). A field's confidence starts
// there and moves with a plausibility check in code:
//   parses in its expected format            engine + 0.6 x (1 - engine)   0.69 -> 0.88
//   a letter where a digit is expected       engine x 0.5                   0.69 -> 0.35
//   cut off or partly blank                  engine x 0.3                   0.69 -> 0.21
//   blank                                    0
// In production the engine's own per-word confidence replaces the first term.
// Nothing in this file is a model's opinion of itself.

export type OcrFieldKind = "amount" | "date" | "policy" | "id" | "contact" | "text" | "hours";
export type OcrIssue = "blank" | "partial" | "out_of_class" | null;

export interface OcrField {
  key: string;
  label: string;
  kind: OcrFieldKind;
  /** As the OCR engine wrote it. */
  raw: string | null;
  /** After glyph normalisation in code (O/0, l/1, I/1). Letters that are not glyph twins stay as read. */
  value: string | null;
  confidence: number;
  issue: OcrIssue;
  basis: string;
  page: number;
  section: string;
  /** Rough location on the page, for the crop shown next to the re-read. Fractions of width and height. */
  region: { x: number; y: number; w: number; h: number } | null;
}

export interface OcrLineItem {
  n: number | null;
  description: string;
  op: string | null;
  hours: number | null;
  amountRaw: string;
  amount: number | null;
  field: OcrField;
}

export interface OcrExtraction {
  document: string;
  engineConfidence: number;
  sections: { name: string; page: number; raw: string; cleaned: string }[];
  fields: OcrField[];
  lineItems: OcrLineItem[];
  /** Arithmetic the code could do without a model, in plain words. */
  codeChecks: { field: string; check: string; candidate: string | null; passed: boolean | null }[];
  cleanedText: string;
}

// ---------------------------------------------------------------------------
// Glyph normalisation
// ---------------------------------------------------------------------------

const CONFUSABLE = new Set(["O", "l", "I", "B", "S", "Z"]);

/** Normalises one whitespace-delimited token. See the rules at the top of the file. */
export function cleanToken(tok: string): string {
  const chars = [...tok];
  const letters = chars.filter((c) => /[A-Za-z]/.test(c));
  const digits = chars.filter((c) => /[0-9]/.test(c));
  const numericShape = /^[(]?[0-9OlI][0-9OlI.,\-/]*[)]?$/.test(tok);
  if (letters.length === 0) return tok;
  if (digits.length === 0 && !(numericShape && /[OlI]{2,}|^[OlI]\.[0-9OlI]$/.test(tok))) return tok;
  const outside = letters.filter((c) => !CONFUSABLE.has(c));
  const onlyZeroOne = digits.every((d) => d === "0" || d === "1");
  if (outside.length > 0 && onlyZeroOne && digits.length > 0) {
    // A word with digits read for letters.
    const caps = letters.every((c) => c === c.toUpperCase());
    return chars
      .map((c, i) => {
        if (c === "0") return caps ? "O" : "o";
        if (c === "1") return i === 0 ? (caps || /[nA-Z]/.test(chars[1] ?? "") ? "I" : "l") : caps ? "I" : "l";
        return c;
      })
      .join("");
  }
  if (numericShape) {
    return tok.replace(/O/g, "0").replace(/[lI]/g, "1");
  }
  // Mixed token: only fix glyph twins that sit next to a real digit.
  return chars
    .map((c, i) => {
      if (c !== "O" && c !== "l" && c !== "I") return c;
      const near = (j: number) => j >= 0 && j < chars.length && /[0-9]/.test(chars[j]);
      if (near(i - 1) || near(i + 1)) return c === "O" ? "0" : "1";
      return c;
    })
    .join("");
}

export function cleanOcrText(text: string): string {
  return text.replace(/\S+/g, (t) => cleanToken(t));
}

// ---------------------------------------------------------------------------
// Sections and pages
// ---------------------------------------------------------------------------

function splitSections(text: string): { name: string; page: number; raw: string }[] {
  const lines = text.split(/\r?\n/);
  const out: { name: string; page: number; raw: string }[] = [];
  let current: { name: string; raw: string[] } | null = null;
  let page = 0;
  for (const line of lines) {
    const m = line.match(/^---\s*(.*?)\s*---$/);
    if (m) {
      if (current) out.push({ name: current.name, page: out.length + 1, raw: current.raw.join("\n") });
      const name = m[1];
      if (/^ClaimsPro OCR extract/i.test(name) || /^end OCR extract/i.test(name)) {
        current = null;
        continue;
      }
      page += 1;
      current = { name, raw: [] };
      continue;
    }
    if (current) current.raw.push(line);
  }
  if (current) out.push({ name: current.name, page: out.length + 1, raw: current.raw.join("\n") });
  return out;
}

// ---------------------------------------------------------------------------
// Field confidence
// ---------------------------------------------------------------------------

const FORMATS: Record<OcrFieldKind, RegExp> = {
  amount: /^\d{1,3}(,\d{3})*\.\d{2}$|^\d+\.\d{2}$/,
  date: /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$/,
  policy: /^[A-Z]{2}-[A-Z]{2}-\d{5}-\d{2}$/,
  id: /^[A-Z]{2,4}-\d{3,6}$/,
  contact: /\d{3}.*\d{4}|@/,
  text: /\S/,
  hours: /^\d+\.\d$/,
};

export function measureConfidence(raw: string | null, value: string | null, kind: OcrFieldKind, engine: number): { confidence: number; issue: OcrIssue; basis: string } {
  const r1 = (n: number) => Math.round(n * 100) / 100;
  const blank = !value || /^[\s_.-]*$/.test(value);
  if (blank) return { confidence: 0, issue: "blank", basis: `Blank in the OCR text${raw && /_/.test(raw) ? " (underscores where the value should be)" : ""}.` };
  if (/_{2,}/.test(value!)) return { confidence: r1(engine * 0.3), issue: "partial", basis: `OCR engine ${engine} for the document; the value is cut off (x0.3).` };
  if (FORMATS[kind].test(value!)) return { confidence: r1(engine + 0.6 * (1 - engine)), issue: null, basis: `OCR engine ${engine} for the document; the field parses as a valid ${kind} (+${r1(0.6 * (1 - engine))}).` };
  return { confidence: r1(engine * 0.5), issue: "out_of_class", basis: `OCR engine ${engine} for the document; the value has a character outside the expected ${kind} format (x0.5).` };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface Spec {
  key: string;
  label: string;
  kind: OcrFieldKind;
  section: RegExp;
  pattern: RegExp;
  region: OcrField["region"];
}

const SPECS: Spec[] = [
  { key: "ocr_claimant_contact", label: "Claimant contact", kind: "contact", section: /cover/i, pattern: /CLAIMANT CONTACT\s*([^\n\[]*?)\s*(?:\[scan edge\]|$)/im, region: { x: 0.45, y: 0.33, w: 0.5, h: 0.05 } },
  { key: "ocr_date_of_loss", label: "Date of loss", kind: "date", section: /cover/i, pattern: /\bDOL\s+([0-9O\/_]+)/, region: { x: 0.3, y: 0.33, w: 0.25, h: 0.05 } },
  { key: "ocr_policy_number", label: "Policy number", kind: "policy", section: /cover/i, pattern: /POLICY\s+([A-Z]{2}-[A-Z]{2}-[0-9OlI]{5}-[0-9OlI]{2})/, region: { x: 0.1, y: 0.28, w: 0.6, h: 0.04 } },
  { key: "ocr_estimate_number", label: "Estimate number", kind: "id", section: /p\.1/i, pattern: /Estimate\s*#\s*([A-Z0-9]{2,4}-[0-9OlI]{3,6})/, region: { x: 0.05, y: 0.2, w: 0.5, h: 0.04 } },
  { key: "ocr_estimate_written", label: "Estimate written", kind: "date", section: /p\.1/i, pattern: /Written\s+([0-9OlI]{4}-[0-9OlI]{2}-[0-9OlI]{2})/, region: { x: 0.05, y: 0.23, w: 0.5, h: 0.04 } },
  { key: "ocr_vehicle", label: "Vehicle (per estimate)", kind: "text", section: /p\.1/i, pattern: /Vehicle\s+(.+?)\s+(?:Medium Duty|Unit\b|Odometer)/, region: { x: 0.05, y: 0.5, w: 0.6, h: 0.04 } },
  { key: "ocr_odometer", label: "Odometer", kind: "text", section: /p\.1/i, pattern: /Odometer\s+([0-9,]+)/i, region: { x: 0.05, y: 0.55, w: 0.4, h: 0.04 } },
  { key: "ocr_parts_total", label: "Parts", kind: "amount", section: /recap|p\.6/i, pattern: /\bParts\s+([0-9,BSZ]+\.\d{2})/, region: { x: 0.55, y: 0.2, w: 0.35, h: 0.04 } },
  { key: "ocr_paint_materials", label: "Paint and materials", kind: "amount", section: /recap|p\.6/i, pattern: /Paint & materials\s+([0-9,BSZ]+\.\d{2})/, region: { x: 0.55, y: 0.23, w: 0.35, h: 0.04 } },
  { key: "ocr_labor_total", label: "Labor", kind: "amount", section: /recap|p\.6/i, pattern: /\bLabor\s+([0-9,BSZ]+\.\d{2})/, region: { x: 0.55, y: 0.26, w: 0.35, h: 0.04 } },
  { key: "ocr_sales_tax", label: "Sales tax", kind: "amount", section: /recap|p\.6/i, pattern: /Sales tax\s+[0-9.]+%\s+([0-9,BSZ]+\.\d{2})/, region: { x: 0.55, y: 0.29, w: 0.35, h: 0.04 } },
  { key: "ocr_vehicle_total", label: "Vehicle total (estimate)", kind: "amount", section: /recap|p\.6/i, pattern: /VEHICLE TOTAL\s+([0-9,BSZ]+\.\d{2})/, region: { x: 0.55, y: 0.32, w: 0.35, h: 0.04 } },
];

const AMOUNT_TOKEN = /[0-9][0-9,BSZ]*\.[0-9]{2}(?![0-9])/g;
const OPS = new Set(["R&R", "R&I", "BODY", "REFN", "--"]);

const toNumber = (s: string | null) => {
  if (s === null) return null;
  const t = s.replace(/,/g, "");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

function parseLineItems(section: { name: string; page: number; cleaned: string }, engine: number): { items: OcrLineItem[]; subtotals: Record<string, number | null> } {
  const text = section.cleaned.replace(/\s+/g, " ");
  const items: OcrLineItem[] = [];
  const subtotals: Record<string, number | null> = {};
  let last = 0;
  let idx = 0;
  for (const m of text.matchAll(AMOUNT_TOKEN)) {
    const amountRaw = m[0];
    const prefix = text.slice(last, m.index).trim();
    last = m.index! + amountRaw.length;
    const toks = prefix.split(" ").filter(Boolean);
    // Drop anything before the previous item's tail (column headers and the like).
    const headerAt = toks.findIndex((t) => t === "AMOUNT");
    const body = headerAt >= 0 ? toks.slice(headerAt + 1) : toks;
    let hours: number | null = null;
    if (body.length && /^\d\.\d$/.test(body[body.length - 1])) hours = Number(body.pop());
    let op: string | null = null;
    if (body.length && OPS.has(body[body.length - 1])) op = body.pop()!;
    let n: number | null = null;
    if (body.length && /^(\d|l)$/.test(body[0])) n = body[0] === "l" ? 1 : Number(body.shift());
    if (n !== null && body[0] === "l") body.shift();
    const description = body.join(" ");
    if (op === null) {
      subtotals[description.toLowerCase()] = toNumber(amountRaw);
      continue;
    }
    idx += 1;
    const value = amountRaw;
    const c = measureConfidence(amountRaw, value, "amount", engine);
    const field: OcrField = {
      key: n !== null ? `ocr_line_${n}` : `ocr_line_x${idx}`,
      label: n !== null ? `Line ${n}: ${description}` : description,
      kind: "amount",
      raw: amountRaw,
      value,
      confidence: c.confidence,
      issue: c.issue,
      basis: c.basis,
      page: section.page,
      section: section.name,
      region: { x: 0.55, y: 0.2 + 0.035 * (n ?? idx), w: 0.3, h: 0.035 },
    };
    items.push({ n, description, op, hours, amountRaw, amount: toNumber(value), field });
  }
  return { items, subtotals };
}

/** Format-aware twins: in the letter zone of an identifier, a 1 is an I and a 0 is an O. */
function normalizeForKind(value: string, kind: OcrFieldKind): string {
  if (kind === "id") {
    const m = value.match(/^([0-9A-Z]{2,4})-(.+)$/);
    if (m) return m[1].replace(/1/g, "I").replace(/0/g, "O") + "-" + m[2];
  }
  if (kind === "policy") {
    const m = value.match(/^([0-9A-Z]{2})-([0-9A-Z]{2})-(.+)$/);
    if (m) return [m[1], m[2]].map((x) => x.replace(/1/g, "I").replace(/0/g, "O")).join("-") + "-" + m[3];
  }
  return value;
}

export function extractOcrFields(text: string, document = "ocr_output.txt"): OcrExtraction {
  const engine = Number(text.match(/conf\s+([0-9.]+)/)?.[1] ?? 0.5);
  const sections = splitSections(text).map((s) => ({ ...s, cleaned: cleanOcrText(s.raw) }));
  const fields: OcrField[] = [];
  for (const spec of SPECS) {
    const sec = sections.find((s) => spec.section.test(s.name));
    if (!sec) continue;
    const cleanedFlat = sec.cleaned.replace(/\s+/g, " ");
    const rawFlat = sec.raw.replace(/\s+/g, " ");
    const m = cleanedFlat.match(spec.pattern);
    // Glyph normalisation is one character for one, so positions line up between raw and cleaned text.
    const raw = m ? rawFlat.slice(m.index! + m[0].indexOf(m[1]), m.index! + m[0].indexOf(m[1]) + m[1].length).trim() : null;
    const value = m ? normalizeForKind(m[1].trim(), spec.kind) : null;
    const c = measureConfidence(raw, value, spec.kind, engine);
    fields.push({ key: spec.key, label: spec.label, kind: spec.kind, raw, value: c.issue === "blank" ? null : value, confidence: c.confidence, issue: c.issue, basis: m ? c.basis : "Not found in the OCR text.", page: sec.page, section: sec.name, region: spec.region });
  }
  const lineSec = sections.find((s) => /line items|p\.3/i.test(s.name));
  const { items, subtotals } = lineSec ? parseLineItems(lineSec, engine) : { items: [], subtotals: {} };
  for (const it of items) fields.push(it.field);

  // Code checks: do the numbers add up, and can arithmetic repair a garbled line?
  const codeChecks: OcrExtraction["codeChecks"] = [];
  const partsItems = items.filter((i) => i.op === "R&R" || i.op === "--");
  const partsSub = subtotals["parts & materials"] ?? null;
  if (partsSub !== null && partsItems.length) {
    const garbled = partsItems.filter((i) => i.amount === null);
    const known = partsItems.filter((i) => i.amount !== null).reduce((a, i) => a + (i.amount ?? 0), 0);
    if (garbled.length === 1) {
      const candidate = Math.round((partsSub - known) * 100) / 100;
      const txt = candidate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      // Does the candidate fit the garbled text with one glyph swapped?
      const fits = garbled[0].amountRaw.length === txt.length && [...garbled[0].amountRaw].filter((ch, k) => ch !== txt[k]).length <= 1;
      codeChecks.push({ field: garbled[0].field.key, check: `Parts and materials subtotal ${partsSub.toFixed(2)} minus the readable lines ${known.toFixed(2)} leaves ${txt} for the garbled line "${garbled[0].amountRaw}"${fits ? ", one glyph away from what the OCR read" : ""}.`, candidate: txt, passed: fits });
    } else if (garbled.length === 0) {
      const ok = Math.abs(known - partsSub) < 0.01;
      codeChecks.push({ field: "ocr_parts_subtotal", check: `Parts lines add to ${known.toFixed(2)} against a subtotal of ${partsSub.toFixed(2)}.`, candidate: null, passed: ok });
    }
  }
  const laborItems = items.filter((i) => i.op === "BODY" || i.op === "REFN");
  const laborSub = subtotals["labor"] ?? null;
  if (laborSub !== null && laborItems.length && laborItems.every((i) => i.amount !== null)) {
    const sum = laborItems.reduce((a, i) => a + (i.amount ?? 0), 0);
    codeChecks.push({ field: "ocr_labor_total", check: `Labor lines add to ${sum.toFixed(2)} against a labor subtotal of ${laborSub.toFixed(2)}.`, candidate: null, passed: Math.abs(sum - laborSub) < 0.01 });
  }
  const f = (k: string) => toNumber(fields.find((x) => x.key === k)?.value ?? null);
  const parts = f("ocr_parts_total");
  const paint = f("ocr_paint_materials");
  const labor = f("ocr_labor_total");
  const tax = f("ocr_sales_tax");
  const total = f("ocr_vehicle_total");
  if (parts !== null && paint !== null && labor !== null && tax !== null && total !== null) {
    const sum = Math.round((parts + paint + labor + tax) * 100) / 100;
    codeChecks.push({ field: "ocr_vehicle_total", check: `Recap: ${parts.toFixed(2)} + ${paint.toFixed(2)} + ${labor.toFixed(2)} + ${tax.toFixed(2)} = ${sum.toFixed(2)} against a stated total of ${total.toFixed(2)}.`, candidate: null, passed: Math.abs(sum - total) < 0.01 });
  }

  return { document, engineConfidence: engine, sections, fields, lineItems: items, codeChecks, cleanedText: sections.map((s) => `--- ${s.name} (page ${s.page}) ---\n${s.cleaned}`).join("\n\n") };
}
