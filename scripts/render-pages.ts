// Pre-renders every PDF page in every claim folder to PNG, once, so the vision
// re-read never has to rasterize a PDF at runtime on Vercel. Output goes to
// <claim folder>/pages/<pdf name>-<n>.png and is committed.
//
//   npm run render-pages            # only PDFs with no pages yet
//   npm run render-pages -- --force # re-render everything
//
// Uses pdftoppm (poppler). Install it locally; it is not needed at runtime.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import { listClaimFolders } from "../lib/claim/catalog.ts";

const DPI = 110;
const force = process.argv.includes("--force");

function hasPdftoppm() {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!hasPdftoppm()) {
  console.error("pdftoppm not found. Install poppler (apt: poppler-utils, brew: poppler) and run again.");
  process.exit(1);
}

let rendered = 0;
for (const folder of listClaimFolders()) {
  const abs = path.join(process.cwd(), folder.dir);
  const pdfs = readdirSync(abs).filter((f) => f.toLowerCase().endsWith(".pdf"));
  for (const pdf of pdfs) {
    const base = pdf.replace(/\.pdf$/i, "");
    const outDir = path.join(abs, "pages");
    mkdirSync(outDir, { recursive: true });
    const existing = readdirSync(outDir).filter((f) => f.startsWith(base + "-") && f.endsWith(".png"));
    if (existing.length && !force) continue;
    execFileSync("pdftoppm", ["-r", String(DPI), "-png", path.join(abs, pdf), path.join(outDir, base)]);
    // pdftoppm zero-pads page numbers when there are 10 or more pages; normalise to plain numbers.
    for (const f of readdirSync(outDir)) {
      const m = f.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-0*(\\d+)\\.png$`));
      if (m && f !== `${base}-${m[1]}.png`) execFileSync("mv", [path.join(outDir, f), path.join(outDir, `${base}-${m[1]}.png`)]);
    }
    const n = readdirSync(outDir).filter((f) => f.startsWith(base + "-")).length;
    console.log(`${folder.claimId}/${pdf}: ${n} page${n === 1 ? "" : "s"} at ${DPI} dpi`);
    rendered += 1;
  }
}
console.log(rendered ? `Rendered ${rendered} PDF${rendered === 1 ? "" : "s"}.` : "Nothing to render; every PDF already has pages (use --force to redo).");
if (!existsSync("meridian/sample_claims")) console.error("Warning: meridian/sample_claims not found.");
