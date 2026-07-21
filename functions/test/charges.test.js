// SUPPRESSION DE CHARGE (ADR-069) — la ligne planifiée de fiche supprimée sort des lignes BC et son
// montant est retiré du coût planifié de l'affaire (costTotal ↓, marge ↑, %MB recalculé) : retrait
// TOTAL y compris du P&L, sans toucher aux docs (overlay non destructif, rétablissable).
import { describe, it, expect } from "vitest";
const { applyChargeDrops } = require("../domain/charges");

describe("applyChargeDrops — retrait d'une charge planifiée y compris du P&L (ADR-069)", () => {
  it("exclut la ligne fiche supprimée et ajuste costTotal/margin/marginPct de la fiche du même FP (fpKey)", () => {
    const bcLines = [
      { id: "l1", source: "fiche", fp: "FP/2026/007", amountXof: 30_000 }, // supprimée (graphie ≠ : fpKey fusionne)
      { id: "l2", source: "fiche", fp: "FP/2026/7", amountXof: 20_000 },   // conservée
      { id: "l3", source: "logistics", fp: "FP/2026/7", amountXof: 30_000, status: "emis" }, // BC RÉEL : jamais par overlay
    ];
    const sheets = [{ fp: "FP/2026/7", saleTotal: 100_000, costTotal: 60_000, margin: 40_000, marginPct: 0.4 }];
    expect(applyChargeDrops(bcLines, sheets, new Set(["l1", "l3"]))).toBe(1); // l3 réelle → intacte
    expect(bcLines.map((b) => b.id)).toEqual(["l2", "l3"]);
    expect(sheets[0].costTotal).toBe(30_000);  // 60k − 30k
    expect(sheets[0].margin).toBe(70_000);     // 40k + 30k (marge = vente − coût)
    expect(sheets[0].marginPct).toBe(0.7);     // recalculé sur la vente
  });
  it("plancher costTotal 0 ; fiche sans marge numérique intacte ; overlay vide = no-op", () => {
    const bcLines = [{ id: "l1", source: "fiche", fp: "FP/2026/1", amountXof: 90_000 }];
    const sheets = [{ fp: "FP/2026/1", costTotal: 50_000 }]; // margin absente → non inventée
    applyChargeDrops(bcLines, sheets, new Set(["l1"]));
    expect(sheets[0].costTotal).toBe(0);
    expect(sheets[0].margin).toBeUndefined();
    const untouched = [{ id: "x", source: "fiche", fp: "FP/2026/2", amountXof: 5_000 }];
    expect(applyChargeDrops(untouched, [], new Set())).toBe(0);
    expect(untouched).toHaveLength(1);
  });
});
