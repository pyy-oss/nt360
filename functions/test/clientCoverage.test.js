import { describe, it, expect } from "vitest";
const { clientCoverage } = require("../domain/clientCoverage");

// TAUX DE COUVERTURE DE LA BASE CLIENT (B4) — prouve : (1) couverture = actifs / base de référence ;
// (2) prospects = vus sans commande ; (3) inactifs = base − vus (churn / Odoo sans activité) ;
// (4) les clés hors base sont ignorées ; (5) base vide → 0, aucune division par zéro.
describe("clientCoverage — taux de couverture de la base client", () => {
  it("couverture = actifs / base ; prospects et inactifs ventilés", () => {
    // base A,B,C,D ; A,B ont une commande ; C vu (facture/opp) sans commande ; D jamais vu (churn/Odoo).
    const r = clientCoverage(["A", "B", "C", "D"], ["A", "B"], ["A", "B", "C"]);
    expect(r).toEqual({ base: 4, actifs: 2, prospects: 1, inactifs: 1, couverture: 0.5 });
  });

  it("ignore les clés actives/vues HORS base (la base est le seul dénominateur)", () => {
    const r = clientCoverage(["A", "B"], ["A", "Z"], ["A", "B", "Z"]); // Z pas dans la base
    expect(r.base).toBe(2);
    expect(r.actifs).toBe(1);           // Z ignoré
    expect(r.couverture).toBeCloseTo(0.5, 6);
  });

  it("base vide → couverture 0, pas de division par zéro", () => {
    expect(clientCoverage([], [], [])).toEqual({ base: 0, actifs: 0, prospects: 0, inactifs: 0, couverture: 0 });
  });

  it("tous actifs → couverture 100 %", () => {
    const r = clientCoverage(["A", "B"], ["A", "B"], ["A", "B"]);
    expect(r.couverture).toBe(1);
    expect(r.inactifs).toBe(0);
    expect(r.prospects).toBe(0);
  });
});
