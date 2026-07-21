import { describe, it, expect } from "vitest";
const { pipelineByPartner, wonYear } = require("../domain/parPipeline");
const { normalizeTiers } = require("../domain/projection");

// Pipeline sourcé partenaire (PAR-L1) — agrégat PUR des opps taguées parPartnerId.
describe("parPipeline — pipeline sourcé partenaire", () => {
  const tiers = normalizeTiers(); // défauts : Certitudes 100 % · Forecast 20 % · Pipe 5 %

  it("sans tag parPartnerId : aucune ligne (le pipeline général reste summaries/pipeline)", () => {
    const r = pipelineByPartner([{ stage: 3, amount: 100, probability: 80 }], { year: 2026, tiers });
    expect(r.partners).toEqual([]);
    expect(r.totalOpenXof).toBe(0);
  });

  it("ouvert (étapes 1-5) : montant + pondéré projectionWeight ; perdues (7) exclues", () => {
    const r = pipelineByPartner([
      { parPartnerId: "cisco", stage: 3, amount: 1000, probability: 80 },  // Forecast → 20 %
      { parPartnerId: "cisco", stage: 5, amount: 500, probability: 95 },   // Certitudes → 100 %
      { parPartnerId: "cisco", stage: 7, amount: 9999, probability: 10 },  // perdue : ignorée
    ], { year: 2026, tiers });
    expect(r.partners).toEqual([{ partnerId: "cisco", openXof: 1500, openWeightedXof: 700, openCount: 2, wonXof: 0, wonCount: 0 }]);
  });

  it("gagné YTD : étape 6 du millésime (closingDate) ; autre millésime écarté ; NON datée comptée", () => {
    const r = pipelineByPartner([
      { parPartnerId: "dell", stage: 6, amount: 300, closingDate: "2026-03-01" },
      { parPartnerId: "dell", stage: 6, amount: 700, closingDate: "2025-11-01" }, // millésime N-1 : écarté
      { parPartnerId: "dell", stage: 6, amount: 100 },                            // non datée : conservée
    ], { year: 2026, tiers });
    expect(r.partners[0]).toMatchObject({ partnerId: "dell", wonXof: 400, wonCount: 2 });
  });

  it("montant négatif borné à 0 ; tri par volume total décroissant", () => {
    const r = pipelineByPartner([
      { parPartnerId: "a", stage: 2, amount: -50, probability: 60 },
      { parPartnerId: "b", stage: 2, amount: 900, probability: 60 },
    ], { year: 2026, tiers });
    expect(r.partners.map((g) => g.partnerId)).toEqual(["b", "a"]);
    expect(r.partners[1].openXof).toBe(0);
  });

  it("wonYear : plausibleYear appliqué (année aberrante → 0 = non datée)", () => {
    expect(wonYear({ closingDate: "2026-05-01" })).toBe(2026);
    expect(wonYear({ closingDate: "1900-01-01" })).toBe(0);
    expect(wonYear({})).toBe(0);
  });
});
