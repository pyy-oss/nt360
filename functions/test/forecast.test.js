import { describe, it, expect } from "vitest";
const { defaultCategory, effectiveCategory, rollupForecast, FORECAST_CATEGORIES } = require("../domain/forecast");

describe("defaultCategory / effectiveCategory", () => {
  it("gagné→commit, perdu→omitted, sinon pipeline", () => {
    expect(defaultCategory({ stage: 6 })).toBe("commit");
    expect(defaultCategory({ stage: 7 })).toBe("omitted");
    expect(defaultCategory({ stage: 3 })).toBe("pipeline");
  });
  it("catégorie posée prioritaire, sinon défaut ; valeur invalide → défaut", () => {
    expect(effectiveCategory({ stage: 3, forecastCategory: "commit" })).toBe("commit");
    expect(effectiveCategory({ stage: 3, forecastCategory: "xxx" })).toBe("pipeline");
    expect(effectiveCategory({ stage: 3 })).toBe("pipeline");
  });
});

describe("rollupForecast — cumul façon Salesforce (Pipeline ⊇ BestCase ⊇ Commit ⊇ Closed)", () => {
  const opps = [
    { stage: 6, amount: 100 },                                  // gagné → closed
    { stage: 3, amount: 50, forecastCategory: "commit" },       // commit
    { stage: 2, amount: 30, forecastCategory: "best_case" },    // best case
    { stage: 1, amount: 20, forecastCategory: "pipeline" },     // pipeline
    { stage: 2, amount: 999, forecastCategory: "omitted" },     // exclu
    { stage: 7, amount: 999 },                                  // perdu → exclu
  ];
  it("cumule correctement les paliers", () => {
    const r = rollupForecast(opps);
    expect(r.closed).toBe(100);
    expect(r.commit).toBe(150);     // 100 + 50
    expect(r.bestCase).toBe(180);   // 150 + 30
    expect(r.pipeline).toBe(200);   // 180 + 20
  });
  it("compte les opps par palier et exclut perdu/omitted", () => {
    const r = rollupForecast(opps);
    expect(r.counts).toEqual({ closed: 1, commit: 1, bestCase: 1, pipeline: 1, omitted: 2 });
  });
  it("liste vide → zéros", () => {
    expect(rollupForecast([]).pipeline).toBe(0);
  });
  it("expose 4 catégories", () => {
    expect(FORECAST_CATEGORIES).toEqual(["omitted", "pipeline", "best_case", "commit"]);
  });
});
