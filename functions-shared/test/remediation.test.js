import { describe, it, expect } from "vitest";
const { recommendCorrection, remediationPlan } = require("../domain/remediation");

describe("recommendCorrection — recommandation concrète déterministe", () => {
  const ctx = {
    orderByFp: new Map([["FP/2026/1", { cas: 4200000, casPnl: 3800000 }]]),
    billedByFp: new Map([["FP/2026/2", 9000000]]),
  };
  it("fiche sans prix → prix = CAS de la commande rattachée (pré-remplissable)", () => {
    const r = recommendCorrection("fiches_sans_vente", { fp: "FP/2026/1" }, ctx);
    expect(r).toEqual({ field: "saleTotal", value: 4200000, basis: expect.stringContaining("CAS de la commande rattachée") });
  });
  it("opp sans montant → montant = CAS de la commande de même FP", () => {
    const r = recommendCorrection("opps_sans_montant", { fp: "FP/2026/1" }, ctx);
    expect(r.field).toBe("amount");
    expect(r.value).toBe(4200000);
  });
  it("écart de valorisation → recommandation TEXTUELLE (casPnl), pas de champ pré-rempli", () => {
    const r = recommendCorrection("ecart_valorisation", { fp: "FP/2026/1", cas: 5000000 }, ctx);
    expect(r.field).toBeNull();
    expect(r.value).toBe(3800000);
    expect(r.basis).toContain("P&L d'origine");
  });
  it("surfacturation → écart chiffré Σ factures vs CAS (textuel)", () => {
    const r = recommendCorrection("surfacturation", { fp: "FP/2026/2", cas: 6000000 }, ctx);
    expect(r.field).toBeNull();
    expect(r.basis).toContain("Σ factures");
    expect(r.basis).toContain("écart");
  });
  it("aucun candidat (FP inconnu) → null", () => {
    expect(recommendCorrection("fiches_sans_vente", { fp: "FP/9999/9" }, ctx)).toBeNull();
    expect(recommendCorrection("opps_sans_montant", {}, ctx)).toBeNull();
  });
  it("type sans recommandation déterministe → null", () => {
    expect(recommendCorrection("commandes_sans_am", { fp: "FP/2026/1" }, ctx)).toBeNull();
  });
});

describe("remediationPlan — priorisation par impact FCFA", () => {
  const buckets = [
    { type: "commandes_sans_am", label: "AM", severity: "low", count: 347, items: [{}, {}] }, // impact 0
    { type: "factures_orphelines", label: "Orphelines", severity: "high", count: 2, items: [{ amountHt: 5000000 }, { amountHt: 3000000 }] },
    { type: "surfacturation", label: "Surfac", severity: "high", count: 1, items: [{ cas: 1000000 }] },
  ];
  it("classe par impact décroissant ; l'échantillon plafonné est extrapolé", () => {
    const p = remediationPlan(buckets);
    expect(p.top.type).toBe("factures_orphelines"); // 8M > 1M > 0
    expect(p.rows[0].impact).toBe(8000000);
    expect(p.rows[2].type).toBe("commandes_sans_am"); // impact 0 → dernier
  });
  it("extrapolation honnête quand count > items.length", () => {
    const p = remediationPlan([{ type: "x", label: "X", severity: "medium", count: 100, items: [{ cas: 1000000 }, { cas: 3000000 }] }]);
    // moyenne 2M × 100 = 200M, `estimated` levé
    expect(p.rows[0].impact).toBe(200000000);
    expect(p.rows[0].estimated).toBe(true);
  });
  it("total impact + total count agrégés ; liste vide → tout à zéro", () => {
    const p = remediationPlan(buckets);
    expect(p.totalCount).toBe(350);
    expect(remediationPlan([])).toEqual({ rows: [], totalImpact: 0, totalCount: 0, top: null });
  });
});
