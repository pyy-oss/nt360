import { describe, it, expect } from "vitest";
const { slippageFromHistory } = require("../domain/oppSlippage");

describe("slippageFromHistory — glissement des deals (net par opp)", () => {
  it("mouvement NET par opp : plus ancienne fromDate → plus récente toDate (ordre atMs)", () => {
    const events = [
      // Opp A glisse deux fois : 03-01 → 04-01 puis 04-01 → 06-01. Net = 03-01 → 06-01 (un seul deal).
      { oppId: "A", fromDate: "2026-03-01", toDate: "2026-04-01", amount: 100, am: "KOUAME", stage: 5, forecastCategory: "commit", atMs: 10 },
      { oppId: "A", fromDate: "2026-04-01", toDate: "2026-06-01", amount: 100, am: "KOUAME", stage: 5, forecastCategory: "commit", atMs: 20 },
      // Opp B avancée (pull-in) : 05-01 → 04-01.
      { oppId: "B", fromDate: "2026-05-01", toDate: "2026-04-01", amount: 50, am: "DIALLO", stage: 4, atMs: 5 },
    ];
    const r = slippageFromHistory(events);
    expect(r.slipCount).toBe(1);        // A compté une seule fois (net)
    expect(r.slipAmount).toBe(100);
    expect(r.pullCount).toBe(1);        // B avancée
    expect(r.pullAmount).toBe(50);
    expect(r.byCategory.commit).toBe(100);
    expect(r.avgSlipDays).toBe(92);     // 01/03 → 01/06 = 92 j
    expect(r.byAm).toEqual([{ am: "KOUAME", amount: 100, count: 1 }]);
    expect(r.items[0]).toMatchObject({ oppId: "A", fromDate: "2026-03-01", toDate: "2026-06-01", days: 92 });
  });

  it("mouvement net NUL (retour à la date d'origine) n'est pas un glissement", () => {
    const events = [
      { oppId: "A", fromDate: "2026-03-01", toDate: "2026-05-01", amount: 100, atMs: 1 },
      { oppId: "A", fromDate: "2026-05-01", toDate: "2026-03-01", amount: 100, atMs: 2 }, // revenu à 03-01
    ];
    const r = slippageFromHistory(events);
    expect(r.slipCount).toBe(0);
    expect(r.pullCount).toBe(0);
  });

  it("catégorie dérivée de l'étape si non posée (5 → commit, 4 → best_case, 1-3 → pipeline)", () => {
    const events = [
      { oppId: "P", fromDate: "2026-01-01", toDate: "2026-02-01", amount: 10, stage: 2, atMs: 1 }, // pipeline
      { oppId: "Q", fromDate: "2026-01-01", toDate: "2026-02-01", amount: 20, stage: 4, atMs: 1 }, // best_case
    ];
    const r = slippageFromHistory(events);
    expect(r.byCategory).toEqual({ commit: 0, best_case: 20, pipeline: 10 });
  });

  it("une opp close (Perdue 7 / Gagnée 6) ne glisse plus → exclue, slipAmount = Σ byCategory", () => {
    const events = [
      { oppId: "L", fromDate: "2026-01-01", toDate: "2026-03-01", amount: 999, am: "KOUAME", stage: 7, atMs: 1 }, // Perdue → omise
      { oppId: "A", fromDate: "2026-01-01", toDate: "2026-03-01", amount: 100, am: "DIALLO", stage: 5, forecastCategory: "commit", atMs: 1 }, // active
    ];
    const r = slippageFromHistory(events);
    expect(r.slipCount).toBe(1);      // seule l'opp active glisse
    expect(r.slipAmount).toBe(100);   // 999 (Perdue) exclu
    const catSum = r.byCategory.commit + r.byCategory.best_case + r.byCategory.pipeline;
    expect(catSum).toBe(r.slipAmount); // invariant de cohérence : ligne de tête = Σ des catégories
    expect(r.byAm).toEqual([{ am: "DIALLO", amount: 100, count: 1 }]);
  });

  it("dates invalides ou liste vide → agrégats nuls", () => {
    expect(slippageFromHistory([{ oppId: "X", fromDate: "n/a", toDate: "2026-01-01" }]).slipCount).toBe(0);
    expect(slippageFromHistory([]).slipAmount).toBe(0);
    expect(slippageFromHistory(undefined).byAm).toEqual([]);
  });
});
