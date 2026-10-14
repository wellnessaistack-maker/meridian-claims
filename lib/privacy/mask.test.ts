import { test } from "node:test";
import assert from "node:assert/strict";

import { loadAllClaims } from "../claim/load.ts";
import { containsName, maskText, unmaskText } from "./mask.ts";

test("no policyholder, claimant or third-party name survives masking in any document of any claim", () => {
  for (const c of loadAllClaims()) {
    const docs = [...c.databricks.documents.filter((d) => d.text), { name: "intake.md", text: c.claimsPro.intake.map((f) => `${f.label}: ${f.value}`).join("\n") }];
    for (const d of docs) {
      const m = maskText(d.text!, c.names);
      assert.equal(containsName(m.text, c.names), null, `${c.header.claimId} ${d.name}`);
      assert.doesNotMatch(m.text, /\(\d{3}\)\s?\d{3}-\d{4}/, `${c.header.claimId} ${d.name}: phone number`);
    }
  }
});

test("masking covers the forms names take in notes and transcripts: surname alone, with a title, company without suffix", () => {
  const names = [
    { token: "[POLICYHOLDER]", value: "Empire State Carriers Inc." },
    { token: "[CLAIMANT]", value: "Raymond Ellison" },
  ];
  const m = maskText("Thank you, Mr. Ellison. It was one of the Empire State Carriers vans. Raymond Ellison called; Ellison again. Call (716) 555-0192 or ray@example.com. DOB: 1979-04-12.", names);
  assert.equal(m.text, "Thank you, [CLAIMANT]. It was one of the [POLICYHOLDER] vans. [CLAIMANT] called; [CLAIMANT] again. Call [PHONE] or [EMAIL]. DOB: [DOB].");
  assert.equal(m.counts["[CLAIMANT]"], 3, "Mr. Ellison, Raymond Ellison and Ellison: three replacements");
  assert.equal(unmaskText(m.text, m.map), "Thank you, Raymond Ellison. It was one of the Empire State Carriers Inc. vans. Raymond Ellison called; Raymond Ellison again. Call [PHONE] or [EMAIL]. DOB: [DOB].");
});

test("EDI segments with addresses and dates of birth are masked, the record structure is kept", () => {
  const m = maskText("NM1*QC*1*MENDEZ*GLORIA****MI*CLMT-1~N3*4200 VALLEY BLVD~N4*FONTANA*CA*92335~DMG*D8*19790000*F~PER*IC*R SALCEDO*TE*9095550173~", [{ token: "[CLAIMANT]", value: "Gloria Mendez" }]);
  assert.match(m.text, /NM1\*QC\*1\*\[CLAIMANT\]\*\[CLAIMANT\]\*/);
  assert.match(m.text, /N3\*\[ADDRESS\]~/);
  assert.match(m.text, /DMG\*D8\*\[DOB\]\*F~/);
  assert.match(m.text, /TE\*\[PHONE\]~/);
});

test("masking is deterministic, so the audit input hash is stable", () => {
  const names = [{ token: "[POLICYHOLDER]", value: "Sunstate Logistics LLC" }];
  const t = "Sunstate Logistics LLC, Tampa. Sunstate Logistics again.";
  assert.equal(maskText(t, names).text, maskText(t, names).text);
});
