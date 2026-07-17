import { describe, it, expect } from "vitest";
const { defaultCategory, effectiveCategory, rollupForecast, rollupForecastByAm, FORECAST_CATEGORIES } = require("../domain/forecast");

describe("defaultCategory / effectiveCategory", () => {
  it("défaut dérivé de l'étape : 5→commit, 4→best_case, 1-3→pipeline ; reste hors prévision", () => {
    expect(defaultCategory({ stage: 6 })).toBe("commit");     // gagné (porté par le carnet dans le rollup)
    expect(defaultCategory({ stage: 5 })).toBe("commit");     // Contractualisation → engagé
    expect(defaultCategory({ stage: 4 })).toBe("best_case");  // Négociation → best case
    expect(defaultCategory({ stage: 3 })).toBe("pipeline");
    expect(defaultCategory({ stage: 1 })).toBe("pipeline");
    expect(defaultCategory({ stage: 7 })).toBe("omitted");    // perdu
    expect(defaultCategory({ stage: 8 })).toBe("omitted");    // suspendu — AVANT retombait à tort sur pipeline
    expect(defaultCategory({ stage: 9 })).toBe("omitted");    // annulé — idem
  });
  it("catégorie posée prioritaire, sinon défaut ; valeur invalide → défaut", () => {
    expect(effectiveCategory({ stage: 3, forecastCategory: "commit" })).toBe("commit");
    expect(effectiveCategory({ stage: 3, forecastCategory: "xxx" })).toBe("pipeline");
    expect(effectiveCategory({ stage: 3 })).toBe("pipeline");
  });
});

describe("rollupForecast — cumul Salesforce, GAGNÉ fourni par le carnet (yearPo)", () => {
  const opps = [
    { stage: 6, amount: 100 },                                  // gagné → IGNORÉ (le carnet porte le gagné)
    { stage: 3, amount: 50, forecastCategory: "commit" },       // commit
    { stage: 2, amount: 30, forecastCategory: "best_case" },    // best case
    { stage: 1, amount: 20, forecastCategory: "pipeline" },     // pipeline
    { stage: 2, amount: 999, forecastCategory: "omitted" },     // exclu explicite
    { stage: 7, amount: 999 },                                  // perdu → exclu
    { stage: 9, amount: 999 },                                  // annulé → exclu (n'inflate plus le pipeline)
  ];
  // closed = carnet de l'exercice (CAS des commandes), fourni par l'appelant : 100, sur 3 commandes.
  it("cumule les paliers au-dessus du gagné-carnet, sans recompter les opps gagnées", () => {
    const r = rollupForecast(opps, 100, 3);
    expect(r.closed).toBe(100);
    expect(r.commit).toBe(150);      // 100 (carnet) + 50
    expect(r.bestCase).toBe(180);    // 150 + 30
    expect(r.pipeline).toBe(200);    // 180 + 20
    expect(r.counts.closed).toBe(3); // nombre de COMMANDES de l'exercice
  });
  it("compte les ouvertes par palier ; perdu/omitted/annulé exclus ; gagnées ignorées", () => {
    const r = rollupForecast(opps, 100, 3);
    expect(r.counts).toEqual({ closed: 3, commit: 1, bestCase: 1, pipeline: 1, omitted: 3 });
  });
  it("sans carnet ni opps → zéros", () => {
    const r = rollupForecast([]);
    expect(r.closed).toBe(0);
    expect(r.pipeline).toBe(0);
  });
  it("carnet seul (aucune ouverte) → tous les paliers = carnet", () => {
    const r = rollupForecast([], 500, 12);
    expect(r.closed).toBe(500);
    expect(r.commit).toBe(500);
    expect(r.bestCase).toBe(500);
    expect(r.pipeline).toBe(500);
  });
  it("expose 4 catégories", () => {
    expect(FORECAST_CATEGORIES).toEqual(["omitted", "pipeline", "best_case", "commit"]);
  });
});

describe("rollupForecastByAm — ventilation forecast par commercial", () => {
  it("cumule par AM (Pipeline ⊇ Best Case ⊇ Commit ⊇ Gagné), gagnées ignorées, trie par pipeline", () => {
    const opps = [
      { am: "KOUAME", stage: 5, amount: 100, forecastCategory: null },   // commit (défaut étape 5)
      { am: "KOUAME", stage: 4, amount: 50, forecastCategory: null },    // best_case
      { am: "kouame", stage: 2, amount: 30, forecastCategory: null },    // pipeline (même AM, casse)
      { am: "DIALLO", stage: 2, amount: 200, forecastCategory: null },   // pipeline
      { am: "DIALLO", stage: 6, amount: 999, forecastCategory: null },   // gagné → ignoré (carnet)
      { am: "", stage: 7, amount: 40, forecastCategory: null },          // omitted (perdu)
    ];
    const closedByAm = new Map([["KOUAME", { amount: 500, count: 2 }], ["Diallo", { amount: 300, count: 1 }]]);
    const out = rollupForecastByAm(opps, closedByAm);
    const k = out.find((r) => r.am === "KOUAME");
    expect(k.closed).toBe(500);
    expect(k.commit).toBe(600);      // 500 + 100
    expect(k.bestCase).toBe(650);    // + 50
    expect(k.pipeline).toBe(680);    // + 30 (casse fusionnée)
    expect(k.counts).toEqual({ closed: 2, commit: 1, bestCase: 1, pipeline: 1 });
    const d = out.find((r) => r.am === "DIALLO");
    expect(d.closed).toBe(300);
    expect(d.pipeline).toBe(500);    // 300 + 200 (gagné 999 ignoré)
    // Trié par pipeline décroissant : KOUAME (680) avant DIALLO (500).
    expect(out.map((r) => r.am)).toEqual(["KOUAME", "DIALLO"]);
  });
  it("un commercial SANS opp mais avec du réalisé apparaît (Gagné seul)", () => {
    const out = rollupForecastByAm([], new Map([["SOLO", { amount: 100, count: 1 }]]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ am: "SOLO", closed: 100, commit: 100, bestCase: 100, pipeline: 100 });
  });
});
