// Semaine ISO 8601 (AAAA-Www) — granularité hebdo du closing (byWeek du pipeline). Cf. domain/pipeline.js.
// On vérifie les cas limites classiques de l'ISO 8601 (bascule d'année de semaine autour du 1er janvier).
import { describe, it, expect } from "vitest";
const { isoWeek, pipeline } = require("../domain/pipeline");

describe("isoWeek — semaine ISO 8601", () => {
  it("numérote correctement les semaines en cours d'année", () => {
    expect(isoWeek("2026-01-05")).toBe("2026-W02"); // lundi de la S2 2026
    expect(isoWeek("2026-06-15")).toBe("2026-W25");
    expect(isoWeek("2026-12-28")).toBe("2026-W53"); // 2026 compte 53 semaines ISO
  });
  it("rattache les jours de bascule à la bonne année de semaine (règle du jeudi)", () => {
    // 2027-01-01 est un vendredi → appartient à la semaine 53 de 2026 (millésime de SEMAINE, pas civil).
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    // 2026-01-01 est un jeudi → semaine 1 de 2026.
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
  });
  it("renvoie « ? » pour une date absente ou invalide (pas d'invention)", () => {
    expect(isoWeek("")).toBe("?");
    expect(isoWeek("nawak")).toBe("?");
  });
  it("les clés hebdo se trient lexicographiquement (zéro-padées)", () => {
    expect(isoWeek("2026-01-05") < isoWeek("2026-06-15")).toBe(true);
  });
});

describe("pipeline.byWeek — écoulement hebdo du closing", () => {
  it("ventile le pondéré des opps projetables par semaine ISO de D Prev", () => {
    const opps = [
      { oppId: "a", stage: 5, probability: 95, amount: 1000, closingDate: "2026-06-15" },
      { oppId: "b", stage: 5, probability: 95, amount: 2000, closingDate: "2026-06-16" }, // même semaine que a
      { oppId: "c", stage: 5, probability: 95, amount: 4000, closingDate: "2026-01-05" },
    ];
    const s = pipeline(opps, "2026-06-01", undefined, []);
    expect(s.byWeek["2026-W25"]).toBeGreaterThan(0); // a + b regroupés
    expect(s.byWeek["2026-W02"]).toBeGreaterThan(0); // c
    // Cohérence : la somme des semaines = la somme des mois (même population/pondération).
    const sumWeek = Object.values(s.byWeek).reduce((x, y) => x + y, 0);
    const sumMonth = Object.values(s.byMonth).reduce((x, y) => x + y, 0);
    expect(Math.round(sumWeek)).toBe(Math.round(sumMonth));
  });
});
