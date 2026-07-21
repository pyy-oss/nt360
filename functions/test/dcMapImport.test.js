import { describe, it, expect } from "vitest";
const { planDcMapImport, MAX_ROWS } = require("../domain/dcMapImport");
const { fpKey } = require("../lib/ids");

describe("dcMapImport — plan d'import de la table FP–DC (seed config/dcAliases)", () => {
  it("détecte FP et DC PAR CONTENU (ordre de colonnes libre), écarte l'entête naturellement", () => {
    const aoa = [
      ["N° FP", "DC"],                       // entête : aucun FP résoluble → écartée
      ["FP/2026/12", "DC00123"],             // ordre FP, DC
      ["DC00456", "FP/2025/7"],              // ordre inversé — même résultat
    ];
    const plan = planDcMapImport(aoa, {}, fpKey);
    expect(plan.toAdd).toEqual([
      { dc: "DC00123", fp: "FP/2026/12" },
      { dc: "DC00456", fp: "FP/2025/7" },
    ]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toContain("aucun N° FP");
  });

  it("écarte les lignes ambiguës (deux FP, plusieurs colonnes non-FP), sans DC, et dédoublonne par DC", () => {
    const aoa = [
      ["FP/2026/1", "FP/2026/2"],            // deux FP → ambigu
      ["FP/2026/3", ""],                     // DC absent
      ["FP/2026/4", "DC1"],
      ["FP/2026/5", "DC1"],                  // DC en double → écartée
      ["Client SA", "FP/2026/6", "DC9"],     // export 3 colonnes : deviner le DC = mapping faux → écartée
    ];
    const plan = planDcMapImport(aoa, {}, fpKey);
    expect(plan.toAdd).toEqual([{ dc: "DC1", fp: "FP/2026/4" }]);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      expect.stringContaining("plusieurs N° FP"),
      expect.stringContaining("DC absent"),
      expect.stringContaining("DC en double"),
      expect.stringContaining("plusieurs colonnes non-FP"),
    ]);
  });

  it("l'existant PRIME : conflit signalé jamais écrasé ; identique = « déjà en place »", () => {
    const existing = { DC1: "FP/2026/10", DC2: "FP/2026/20" };
    const aoa = [
      ["FP/2026/99", "DC1"],                 // ≠ existant → conflit (existant conservé)
      ["FP/2026/20", "DC2"],                 // identique → unchanged
      ["FP/2026/30", "DC3"],                 // nouveau → ajouté
    ];
    const plan = planDcMapImport(aoa, existing, fpKey);
    expect(plan.conflicts).toEqual([{ dc: "DC1", existing: "FP/2026/10", incoming: "FP/2026/99" }]);
    expect(plan.unchanged).toBe(1);
    expect(plan.toAdd).toEqual([{ dc: "DC3", fp: "FP/2026/30" }]);
  });

  it("canonicalise le FP (zéros de tête) et borne le volume (truncated signalé)", () => {
    const one = planDcMapImport([["FP/2026/0012", "DCX"]], {}, fpKey);
    expect(one.toAdd).toEqual([{ dc: "DCX", fp: "FP/2026/12" }]); // fpKey normalise
    const big = Array.from({ length: MAX_ROWS + 5 }, (_, i) => [`FP/2026/${i + 1}`, `DC${i + 1}`]);
    const plan = planDcMapImport(big, {}, fpKey);
    expect(plan.truncated).toBe(true);
    expect(plan.toAdd).toHaveLength(MAX_ROWS);
  });
});
