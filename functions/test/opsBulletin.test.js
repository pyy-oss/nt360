import { describe, it, expect } from "vitest";
const { validateOpsBulletin, bulletinId } = require("../domain/opsBulletin");

describe("validateOpsBulletin", () => {
  it("normalise fy/semaine + trim + puces à 2 niveaux, écarte les entrées vides", () => {
    const r = validateOpsBulletin({
      fy: 2026, week: 27,
      sections: [
        { title: "  Engagements fournisseurs  ", items: [{ text: " WESTCON : BP BF 111K$ -> On Hold " }, { text: "" }] },
        { title: "Projets", items: [
          { text: "CORIS Holding", sub: ["Projet HUAWEI : contrat attendu", "", "  Licences Solarwind  "] },
          { text: "", sub: [] }, // puce vide → écartée
        ] },
        { title: "", items: [] }, // section vide → écartée
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.value.fy).toBe(2026);
    expect(r.value.week).toBe(27);
    expect(r.value.sections).toHaveLength(2);
    expect(r.value.sections[0].title).toBe("Engagements fournisseurs"); // trim
    expect(r.value.sections[0].items).toHaveLength(1);                   // puce vide écartée
    expect(r.value.sections[1].items[0].sub).toEqual(["Projet HUAWEI : contrat attendu", "Licences Solarwind"]); // trim + vide écarté
    expect(r.value.sections[1].items).toHaveLength(1);                   // 2e puce (vide) écartée
  });
  it("rejette fy / semaine invalides", () => {
    expect(validateOpsBulletin({ fy: 1990, week: 5 }).ok).toBe(false);
    expect(validateOpsBulletin({ fy: 2026, week: 0 }).ok).toBe(false);
    expect(validateOpsBulletin({ fy: 2026, week: 54 }).ok).toBe(false);
  });
  it("plafonne sections / puces / sous-puces (anti-abus)", () => {
    const big = { fy: 2026, week: 1, sections: Array.from({ length: 30 }, (_, i) => ({ title: `S${i}`, items: [{ text: "x" }] })) };
    expect(validateOpsBulletin(big).value.sections.length).toBe(12);
  });
  it("bulletinId déterministe, semaine zéro-paddée", () => {
    expect(bulletinId(2026, 7)).toBe("2026_W07");
    expect(bulletinId(2026, 27)).toBe("2026_W27");
  });
});
