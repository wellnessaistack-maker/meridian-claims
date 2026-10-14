// No policyholder names in model prompts (decision 4 in meridian/memory/decisions.md).
// Everything that goes to the API passes through maskText first. The map is kept
// server-side so the screen can show the real names from ClaimsPro.

export interface MaskedName {
  /** The token that replaces the name, for example [POLICYHOLDER]. */
  token: string;
  /** The full name as it appears in ClaimsPro. */
  value: string;
}

export interface MaskResult {
  text: string;
  /** token -> original, for display only. Never sent to the model. */
  map: Record<string, string>;
  /** How many replacements were made, by token. */
  counts: Record<string, number>;
}

const GENERIC_WORDS = new Set(["inc", "llc", "ltd", "corp", "co", "company", "partners", "logistics", "freight", "carriers", "state", "the", "of", "and", "services", "express", "group"]);

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Full name, then the surname or company name alone, then a title plus surname. */
function patternsFor(value: string): RegExp[] {
  const clean = value.trim();
  if (!clean) return [];
  const words = clean.split(/\s+/);
  const out: RegExp[] = [new RegExp(`\\b${escape(clean)}\\b`, "gi")];
  // Without a corporate suffix ("Sunstate Logistics" for "Sunstate Logistics LLC").
  const noSuffix = words.filter((w) => !["inc", "inc.", "llc", "ltd", "corp", "co.", "co"].includes(w.toLowerCase())).join(" ");
  if (noSuffix && noSuffix !== clean) out.push(new RegExp(`\\b${escape(noSuffix)}\\b`, "gi"));
  // A person's surname alone, with or without a title; a company's first distinctive word alone.
  if (words.length >= 2) {
    const last = words[words.length - 1].replace(/[.,]/g, "");
    const first = words[0].replace(/[.,]/g, "");
    if (!GENERIC_WORDS.has(last.toLowerCase()) && last.length > 2) {
      out.push(new RegExp(`\\b(?:Mr\\.?|Mrs\\.?|Ms\\.?|Dr\\.?)\\s+${escape(last)}\\b`, "gi"));
      out.push(new RegExp(`\\b${escape(last)}\\b`, "gi"));
    }
    if (!GENERIC_WORDS.has(first.toLowerCase()) && first.length > 2) out.push(new RegExp(`\\b${escape(first)}\\b`, "gi"));
  }
  return out;
}

const PHONE = /(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b|\b\d{10}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
// Dates of birth: a labelled date, or the EDI DMG segment.
const DOB = /(\bDOB\s*[:]?\s*)(\d{4}-\d{2}-\d{2})/gi;
const EDI_DMG = /(DMG\*D8\*)\d{8}/g;
// Street addresses: a number then a street name and a street type, and EDI N3 segments.
const STREET = /\b\d{1,5}\s+(?:[NSEW]\.?\s+)?[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?\s+(?:Ave|Avenue|Blvd|Boulevard|St|Street|Rd|Road|Dr|Drive|Ln|Lane|Way|Pkwy|Hwy)\b\.?/g;
const EDI_N3 = /(N3\*)[^~]+(~)/g;

/**
 * Masks names, phone numbers, emails, dates of birth and street addresses.
 * Deterministic: the same inputs always give the same text, so the input hash
 * in the audit record is stable.
 */
export function maskText(text: string, names: MaskedName[]): MaskResult {
  const map: Record<string, string> = {};
  const counts: Record<string, number> = {};
  let out = text;
  const bump = (token: string, n: number) => {
    if (n > 0) counts[token] = (counts[token] ?? 0) + n;
  };
  // Longest names first so "Empire State Carriers Inc." is replaced before "Empire".
  for (const n of [...names].sort((a, b) => b.value.length - a.value.length)) {
    if (!n.value.trim()) continue;
    map[n.token] = n.value;
    for (const re of patternsFor(n.value)) {
      const before = out;
      out = out.replace(re, n.token);
      bump(n.token, before === out ? 0 : (before.match(re) ?? []).length);
    }
  }
  const sub = (re: RegExp, token: string) => {
    const before = out;
    out = out.replace(re, token);
    bump(token, before === out ? 0 : (before.match(re) ?? []).length);
  };
  sub(EMAIL, "[EMAIL]");
  sub(PHONE, "[PHONE]");
  out = out.replace(DOB, (_m, p1: string) => p1 + "[DOB]");
  out = out.replace(EDI_DMG, (_m, p1: string) => p1 + "[DOB]");
  out = out.replace(STREET, "[ADDRESS]");
  out = out.replace(EDI_N3, (_m, p1: string, p2: string) => p1 + "[ADDRESS]" + p2);
  return { text: out, map, counts };
}

/** Puts the real names back for display. The model never sees this output. */
export function unmaskText(text: string, map: Record<string, string>): string {
  let out = text;
  for (const [token, value] of Object.entries(map)) out = out.split(token).join(value);
  return out;
}

/** True if any of the names still appears in the text. Used by the tests and as a last check before an API call. */
export function containsName(text: string, names: MaskedName[]): string | null {
  for (const n of names) {
    for (const re of patternsFor(n.value)) {
      if (re.test(text)) return n.value;
    }
  }
  return null;
}
