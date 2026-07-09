import { describe, it, expect } from "vitest";
import { validateConsultant, stripConfidential, dailyMargin, GRADES } from "../domain/consultant.js";

describe("validateConsultant (Lot 11 DirOps)", () => {
  it("nom requis", () => {
    expect(validateConsultant({ name: "" }).ok).toBe(false);
    expect(validateConsultant({}).ok).toBe(false);
  });
  it("normalise grade/statut/BU + défauts sûrs", () => {
    const v = validateConsultant({ name: "Alice", grade: "gourou", status: "?", bu: "data" }).value;
    expect(v.grade).toBe("confirme"); // grade inconnu → défaut
    expect(v.status).toBe("active");  // statut inconnu → défaut
    expect(v.bu).toBe("DATA");
  });
  it("coerce TJM/CJM (négatif/non numérique → null) et borne les compétences", () => {
    const v = validateConsultant({ name: "Bob", tjmTarget: "650", cjm: -1, skills: ["Java", "", "AWS"] }).value;
    expect(v.tjmTarget).toBe(650);
    expect(v.cjm).toBeNull();
    expect(v.skills).toEqual(["Java", "AWS"]);
  });
  it("startDate ISO uniquement", () => {
    expect(validateConsultant({ name: "X", startDate: "2026-01-15" }).value.startDate).toBe("2026-01-15");
    expect(validateConsultant({ name: "X", startDate: "15/01/2026" }).value.startDate).toBeNull();
  });
  it("accepte tous les grades définis", () => {
    for (const g of GRADES) expect(validateConsultant({ name: "X", grade: g }).value.grade).toBe(g);
  });
});

describe("stripConfidential — confidentialité du coût (CJM)", () => {
  const c = { name: "Alice", tjmTarget: 700, cjm: 400 };
  it("laisse le coût si droit rentabilite", () => {
    expect(stripConfidential(c, true).cjm).toBe(400);
  });
  it("retire le coût sinon", () => {
    const s = stripConfidential(c, false);
    expect(s.cjm).toBeUndefined();
    expect(s.tjmTarget).toBe(700); // le TJM reste visible
  });
});

describe("dailyMargin", () => {
  it("TJM − CJM quand connus", () => {
    expect(dailyMargin({ tjmTarget: 700, cjm: 400 })).toBe(300);
  });
  it("null si l'un manque", () => {
    expect(dailyMargin({ tjmTarget: 700 })).toBeNull();
    expect(dailyMargin({ cjm: 400 })).toBeNull();
  });
});
