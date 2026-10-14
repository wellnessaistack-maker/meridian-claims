// The amount check: what is claimed against what the documents on file
// support, every number with its source. A code check, not a valuation:
// there is no rate card and no model estimate in this prototype. The
// supporting totals come from fields the packet already carries (OCR, EDI,
// what the agent read) and from totals code finds in text documents.

import type { ClaimPacket, Source } from "../claim/schema.ts";

export type AmountKind = "claimed" | "estimate" | "medical" | "demand" | "quote" | "other";

export interface AmountLine {
  label: string;
  amount: number;
  kind: AmountKind;
  source: Source;
  document: string | null;
  /** How the number was found, in plain words. */
  basis: string;
  /** Whether this line counts toward the supported total (one total per document). */
  counted: boolean;
}

export interface AmountCheck {
  claimed: number | null;
  supported: number;
  gap: number | null;
  lines: AmountLine[];
  note: string;
}

const TOTAL_FIELD = /net total|vehicle total|estimate total|total claimed|total demanded|grand total|charges|mri estimate|quote/i;
const CLAIMED_FIELD = /^claim_amount$|claim amount/i;
const TOTAL_LINE = /\b(net total|total claimed|total demanded|vehicle total|grand total|total)\b[^\d\n]{0,24}\$?\s*([\d,]+\.\d{2})/gi;

const parseMoney = (s: string | null): number | null => {
  const m = s?.match(/\$?\s*([\d,]{1,12}\.\d{2})/) ?? s?.match(/\$\s*([\d,]{1,12})/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function kindOf(text: string): AmountKind {
  const t = text.toLowerCase();
  if (/claim amount|amount claimed|total claimed/.test(t)) return "claimed";
  if (/medical|charges|mri|visit|provider bill/.test(t)) return "medical";
  if (/demand/.test(t)) return "demand";
  if (/quote/.test(t)) return "quote";
  if (/estimate|parts|labor|labour|repair|vehicle total|net total/.test(t)) return "estimate";
  return "other";
}

export function amountCheck(packet: ClaimPacket, docs: { name: string; text: string | null }[]): AmountCheck {
  const lines: AmountLine[] = [];
  for (const f of packet.fields) {
    const text = `${f.key} ${f.label}`;
    if (CLAIMED_FIELD.test(text) && f.value) {
      const n = parseMoney(f.value);
      if (n !== null) lines.push({ label: f.label, amount: n, kind: "claimed", source: f.source, document: f.document, basis: f.source === "code" ? "parsed by code" : f.source === "vision" ? "vision re-read" : "field in the record", counted: false });
      continue;
    }
    if (!TOTAL_FIELD.test(text) || !f.value) continue;
    const n = parseMoney(f.value);
    if (n === null) continue;
    const kind = kindOf(text);
    if (kind === "claimed") continue;
    lines.push({ label: f.label, amount: n, kind, source: f.source, document: f.document, basis: f.key.startsWith("ocr_") ? "OCR field, confidence measured" : f.key.startsWith("edi_") ? "EDI segment" : f.key.startsWith("model_") ? "read by the agent from the document" : "field in the record", counted: false });
  }
  for (const d of docs) {
    if (!d.text) continue;
    for (const m of d.text.matchAll(TOTAL_LINE)) {
      const n = Number(m[2].replace(/,/g, ""));
      if (!Number.isFinite(n)) continue;
      const label = m[1].replace(/\b\w/g, (c) => c.toUpperCase());
      const kind = /total claimed|total demanded/i.test(m[1]) ? (/demand/i.test(d.name) ? "demand" : "quote") : kindOf(`${d.name} ${m[1]}`);
      if (lines.some((l) => l.document === d.name && Math.abs(l.amount - n) < 0.005)) continue;
      lines.push({ label: `${label} on ${d.name}`, amount: n, kind: kind === "claimed" ? "other" : kind, source: "code", document: d.name, basis: `code found "${m[0].trim()}" in the document text`, counted: false });
    }
  }
  // One supporting total per document: the largest, so subtotals and line items are not added twice.
  const byDoc = new Map<string, AmountLine>();
  for (const l of lines) {
    if (l.kind === "claimed" || !l.document) continue;
    const key = l.document;
    const cur = byDoc.get(key);
    if (!cur || l.amount > cur.amount) byDoc.set(key, l);
  }
  for (const l of byDoc.values()) l.counted = true;
  const claimed = packet.header.amountUsd ?? lines.find((l) => l.kind === "claimed")?.amount ?? null;
  const supported = Math.round([...byDoc.values()].reduce((a, l) => a + l.amount, 0) * 100) / 100;
  const gap = claimed === null ? null : Math.round((claimed - supported) * 100) / 100;
  const note =
    claimed === null
      ? "No claim amount in the record."
      : byDoc.size === 0
        ? "Nothing on file carries a total to set against the amount claimed."
        : gap !== null && Math.abs(gap) < 1
          ? "The documents on file support the amount claimed."
          : gap !== null && gap > 0
            ? `${usd(gap)} of the amount claimed is not supported by any total on file.`
            : `The documents on file add up to ${usd(-gap!)} more than the amount claimed.`;
  return { claimed, supported, gap, lines, note };
}

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
