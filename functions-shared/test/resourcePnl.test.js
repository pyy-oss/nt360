import { describe, it, expect } from "vitest";
import { consultantPnl, computeResourcePnl } from "../domain/resourcePnl.js";

describe("consultantPnl (Lot 17)", () => {
  it("CA = jours facturés × TJM ; coût = mois × 20 × CJM ; marge = CA − coût", () => {
    const p = consultantPnl({ id: "c1", tjmTarget: 700, cjm: 400, bu: "DATA", grade: "senior" }, { billedDays: 30, months: 2 });
    expect(p.caReal).toBe(21000);      // 30 × 700
    expect(p.cost).toBe(16000);        // 2 × 20 × 400
    expect(p.margin).toBe(5000);
    expect(p.marginPct).toBe(24);      // 5000/21000 ≈ 24%
  });
  it("sans CJM : coût/marge null (confidentialité / donnée manquante)", () => {
    const p = consultantPnl({ id: "c2", tjmTarget: 600 }, { billedDays: 10, months: 1 });
    expect(p.caReal).toBe(6000);
    expect(p.cost).toBeNull();
    expect(p.margin).toBeNull();
  });
  it("CA au TAUX CONTRACTUALISÉ (parité pré-facturation) : le tjmBilled de l'affectation prime sur le TJM cible", () => {
    // Consultant vendu 900/j (affectation confirmée) alors que son TJM cible annuaire est 700 → le CA réel
    // doit refléter le taux réellement facturé, comme la pré-facturation (sinon deux « CA » divergents).
    const ctx = {
      byMonth: { c1: [{ month: "2026-01", billedDays: 20 }] },
      assignments: [{ consultantId: "c1", startMonth: "2026-01", endMonth: "2026-06", tjmBilled: 900, status: "confirmed" }],
    };
    const p = consultantPnl({ id: "c1", tjmTarget: 700, cjm: 400 }, { billedDays: 20, months: 1 }, ctx);
    expect(p.caReal).toBe(18000); // 20 × 900 (contrat), PAS 20 × 700 (cible)
    expect(p.missingTjm).toBe(false);
  });
  it("repli TJM cible quand aucune affectation ne couvre le mois (ou taux ambigu)", () => {
    const ctx = { byMonth: { c1: [{ month: "2026-01", billedDays: 20 }] }, assignments: [] };
    const p = consultantPnl({ id: "c1", tjmTarget: 700, cjm: 400 }, { billedDays: 20, months: 1 }, ctx);
    expect(p.caReal).toBe(14000); // 20 × 700 (cible)
  });
  it("aucun taux (ni contrat ni cible) → missingTjm=true, CA=0", () => {
    const ctx = { byMonth: { c1: [{ month: "2026-01", billedDays: 20 }] }, assignments: [] };
    const p = consultantPnl({ id: "c1", cjm: 400 }, { billedDays: 20, months: 1 }, ctx);
    expect(p.caReal).toBe(0);
    expect(p.missingTjm).toBe(true);
  });
  it("marge NETTE (ADR-P22) : sans taux de structure, nette = brute (aucun impact)", () => {
    const p = consultantPnl({ id: "c1", tjmTarget: 700, cjm: 400 }, { billedDays: 30, months: 2 });
    expect(p.structureCost).toBe(0);
    expect(p.marginNette).toBe(p.margin);         // 5000
    expect(p.marginNettePct).toBe(p.marginPct);   // 24
  });
  it("marge NETTE : taux 0.1 (10% du CA) → frais de structure retranchés de la marge brute", () => {
    // CA 21000, marge brute 5000. Frais structure = 10% × 21000 = 2100. Marge nette = 5000 − 2100 = 2900.
    const p = consultantPnl({ id: "c1", tjmTarget: 700, cjm: 400 }, { billedDays: 30, months: 2 }, undefined, 0.1);
    expect(p.structureCost).toBe(2100);
    expect(p.marginNette).toBe(2900);
    expect(p.marginNettePct).toBe(14);            // 2900/21000 ≈ 13.8 → 14
  });
  it("marge NETTE : taux borné [0..1] et ignoré si non fini/négatif", () => {
    const clamp = consultantPnl({ id: "c1", tjmTarget: 700, cjm: 400 }, { billedDays: 30, months: 2 }, undefined, 5);
    expect(clamp.structureCost).toBe(21000);      // taux 5 borné à 1 → 100% du CA
    const neg = consultantPnl({ id: "c1", tjmTarget: 700, cjm: 400 }, { billedDays: 30, months: 2 }, undefined, -0.2);
    expect(neg.structureCost).toBe(0);            // taux négatif ignoré → 0
  });
  it("marge NETTE : sans coût (CJM absent), marge nette reste null (population à coût connu)", () => {
    const p = consultantPnl({ id: "c2", tjmTarget: 600 }, { billedDays: 10, months: 1 }, undefined, 0.1);
    expect(p.marginNette).toBeNull();
  });
});

describe("computeResourcePnl — agrégats global / BU / grade", () => {
  const consultants = [
    { id: "c1", tjmTarget: 700, cjm: 400, bu: "DATA", grade: "senior" },
    { id: "c2", tjmTarget: 600, cjm: 350, bu: "DATA", grade: "junior" },
    { id: "c3", tjmTarget: 800, cjm: 500, bu: "CLOUD", grade: "expert" }, // pas de CRA → exclu
  ];
  const constat = { c1: { billedDays: 20, months: 1 }, c2: { billedDays: 18, months: 1 } };
  it("n'inclut que les consultants ayant un CRA", () => {
    const r = computeResourcePnl(consultants, constat);
    expect(r.rows.length).toBe(2);
    expect(r.global.headcount).toBe(2);
    // CA global = 20×700 + 18×600 = 14000 + 10800 = 24800
    expect(r.global.caReal).toBe(24800);
    expect(r.byBu.find((b) => b.key === "DATA").caReal).toBe(24800);
    expect(r.byGrade.length).toBe(2);
  });

  it("taux de marge NON dilué : dénominateur = CA de la seule population à coût connu", () => {
    // c1 a coût (CA 14000, marge 6000 → 43%). c4 a du CA mais AUCUN CJM → hors calcul de marge.
    const cons = [
      { id: "c1", tjmTarget: 700, cjm: 400, bu: "DATA" }, // CA 14000, coût 8000, marge 6000
      { id: "c4", tjmTarget: 1000, bu: "DATA" },          // CA 20000, sans coût
    ];
    const r = computeResourcePnl(cons, { c1: { billedDays: 20, months: 1 }, c4: { billedDays: 20, months: 1 } });
    // marginPct = 6000 / 14000 (CA à coût connu) = 43%, PAS 6000 / 34000 = 18% (dilué).
    expect(r.global.marginPct).toBe(43);
    expect(r.byBu.find((b) => b.key === "DATA").marginPct).toBe(43);
    expect(r.rows.find((x) => x.id === "c4").missingCjm).toBe(true);
  });

  it("marge NETTE agrégée (ADR-P22) : global + BU + grade retranchent les frais de structure", () => {
    // c1 : CA 14000, coût 8000, marge 6000. c2 : CA 10800, coût 7000, marge 3800.
    // Taux 0.1 → frais = 10% du CA de chaque. Marge nette globale = (6000+3800) − 10%×24800 = 9800 − 2480 = 7320.
    const r = computeResourcePnl(consultants, constat, undefined, { structureRate: 0.1 });
    expect(r.global.structureCost).toBe(2480);
    expect(r.global.marginNette).toBe(7320);
    // Taux net global : 7320 / 24800 (CA à coût connu) ≈ 29.5 → 30.
    expect(r.global.marginNettePct).toBe(30);
    // BU DATA porte les deux → mêmes agrégats nets que le global.
    const data = r.byBu.find((b) => b.key === "DATA");
    expect(data.structureCost).toBe(2480);
    expect(data.marginNette).toBe(7320);
    // Sans taux : agrégats nets == bruts.
    const r0 = computeResourcePnl(consultants, constat);
    expect(r0.global.marginNette).toBe(r0.global.margin);
    expect(r0.global.structureCost).toBe(0);
  });
});
