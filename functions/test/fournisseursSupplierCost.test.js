import { describe, it, expect } from "vitest";
const { supplierCostByFp } = require("../domain/fournisseurs");

// RÉCONCILIATION AMONT (coût) — Lot 8b : le coût RÉEL par affaire = Σ factures fournisseur regroupées
// par N° FP CANONIQUE (fpKey). Rapprochement identique à la Σ facturé (aval), pour un rapprochement
// coût planifié ↔ réel cohérent en FP 360°.
describe("supplierCostByFp — coût réel par affaire (fpKey)", () => {
  it("regroupe par fpKey : graphies de N° FP normalisées (zéros de tête) fusionnées", () => {
    const r = supplierCostByFp([
      { fp: "FP/2026/007", amountXof: 30_000 },
      { fp: "FP/2026/7", amountXof: 20_000 }, // même affaire, graphie différente
    ]);
    expect(Object.keys(r)).toHaveLength(1);
    expect(r["FP/2026/7"]).toBe(50_000);
  });
  it("ignore les factures sans N° FP (rien à rapprocher à une affaire)", () => {
    const r = supplierCostByFp([
      { fp: "", amountXof: 10_000 },
      { fp: null, amountXof: 5_000 },
      { fp: "FP/2026/1", amountXof: 40_000 },
    ]);
    expect(r["FP/2026/1"]).toBe(40_000);
    expect(Object.values(r).reduce((s, v) => s + v, 0)).toBe(40_000); // les sans-FP n'entrent pas
  });
  it("additionne plusieurs factures d'une même affaire", () => {
    const r = supplierCostByFp([
      { fp: "FP/2025/12", amountXof: 100_000 },
      { fp: "FP/2025/12", amountXof: 25_000 },
      { fp: "FP/2025/12", amountXof: 75_000 },
    ]);
    expect(r["FP/2025/12"]).toBe(200_000);
  });
  it("robustesse : entrée vide / non tableau → objet vide", () => {
    expect(supplierCostByFp([])).toEqual({});
    expect(supplierCostByFp(undefined)).toEqual({});
    expect(supplierCostByFp(null)).toEqual({});
  });
});

// ENGAGÉ par affaire (audit BC/DC × rentabilité) : Σ BC RÉELS par fpKey, tous statuts (un BC payé
// reste un coût), lignes de fiche exclues (achats planifiés, déjà dans costTotal). Miroir front :
// FP 360° « Engagé (Σ BC) » (operations.tsx) — même assiette, même nombre.
describe("bcCostByFp — achats engagés par affaire (fpKey)", () => {
  const { bcCostByFp } = require("../domain/fournisseurs");
  it("regroupe par fpKey (graphies fusionnées), tous statuts confondus, payés compris", () => {
    const r = bcCostByFp([
      { fp: "FP/2026/007", amountXof: 30_000, status: "emis" },
      { fp: "FP/2026/7", amountXof: 20_000, status: "solde" }, // payé = toujours un coût
    ]);
    expect(r).toEqual({ "FP/2026/7": 50_000 });
  });
  it("exclut les lignes de fiche (planifié) et les BC sans N° FP résoluble", () => {
    const r = bcCostByFp([
      { fp: "FP/2026/1", amountXof: 10_000, source: "fiche" }, // planifié → exclu
      { fp: "", amountXof: 5_000 },                            // sans FP → exclu
      { fp: "FP/2026/1", amountXof: 8_000, source: "logistics" },
    ]);
    expect(r).toEqual({ "FP/2026/1": 8_000 });
  });
  it("robustesse : entrée vide / non tableau → objet vide", () => {
    expect(bcCostByFp([])).toEqual({});
    expect(bcCostByFp(undefined)).toEqual({});
  });
});
