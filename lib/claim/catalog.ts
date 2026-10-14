// Where claim folders live, and which kind each one is. Three roots, so the
// case's own folder stays untouched and nobody wonders which claims are real.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { Provenance, ProvenanceKind } from "./schema.ts";

export interface ClaimRoot {
  dir: string;
  kind: Exclude<ProvenanceKind, "extract">;
}

export const CLAIM_ROOTS: ClaimRoot[] = [
  { dir: path.join("meridian", "sample_claims"), kind: "provided" },
  { dir: "sample_claims_variants", kind: "variant" },
  { dir: "sample_claims_mock", kind: "mock" },
];

export const PROVENANCE_LABELS: Record<ProvenanceKind, string> = {
  provided: "Meridian sample claim",
  variant: "Variant",
  mock: "Mock claim (made up for the demo)",
  extract: "From the extract (no documents)",
};

export interface ClaimFolder {
  claimId: string;
  /** Relative to the repo root. */
  dir: string;
  provenance: Provenance;
}

/** Reads provenance.json for variants and mock claims; provided claims need none. */
export function provenanceFor(dir: string, kind: ClaimRoot["kind"], root = process.cwd()): Provenance {
  const p = path.join(root, dir, "provenance.json");
  if (existsSync(p)) {
    const j = JSON.parse(readFileSync(p, "utf8")) as Partial<Provenance>;
    const parentId = j.parentId ?? null;
    const change = j.change ?? null;
    const label =
      j.label ?? (kind === "variant" && parentId ? `Variant of ${parentId}${change ? ` (${change})` : ""}` : PROVENANCE_LABELS[kind]);
    return { kind: j.kind ?? kind, label, parentId, change };
  }
  return { kind, label: PROVENANCE_LABELS[kind], parentId: null, change: null };
}

export function listClaimFolders(root = process.cwd()): ClaimFolder[] {
  const out: ClaimFolder[] = [];
  for (const r of CLAIM_ROOTS) {
    const abs = path.join(root, r.dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs).sort()) {
      const dir = path.join(r.dir, name);
      if (!statSync(path.join(root, dir)).isDirectory()) continue;
      if (!existsSync(path.join(root, dir, "intake.md"))) continue;
      out.push({ claimId: name, dir, provenance: provenanceFor(dir, r.kind, root) });
    }
  }
  return out;
}

export function findClaimFolder(claimId: string, root = process.cwd()): ClaimFolder | null {
  return listClaimFolders(root).find((c) => c.claimId === claimId) ?? null;
}
