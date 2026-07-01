import { describe, it, expect } from "vitest";
const { overview } = require("../domain/chaine");
const { backlogFy } = require("../domain/backlog");
const { pipeline } = require("../domain/pipeline");
const { suppliers } = require("../domain/fournisseurs");
const { facturation, rentabilite, byEntity } = require("../domain/reporting");
const { filterInvoices } = require("../lib/aggregate");

const ORDERS = [
  { fp: "FP/2026/1", client: "ACME", bu: "ICT", yearPo: 2026, cas: 1000, raf: 400, mb: 210, suppliers: [{ name: "HIPERDIST", amount: 300 }] },
  { fp: "FP/2025/2", client: "BETA", bu: "CLOUD", yearPo: 2025, cas: 500, raf: 0, mb: 100, suppliers: [{ name: "WESTCON", amount: 200 }] },
  { fp: "FP/2026/3", client: "ACME", bu: "ICT", yearPo: 2026, cas: 800, raf: 800, mb: 160, suppliers: [{ name: "HIPERDIST", amount: 100 }] },
];
const INVOICES = [
  { numero: "A1", fp: "FP/2026/1", client: "ACME", bu: "ICT", date: "2026-01-10", amountHt: 600 },
  { numero: "A2", fp: "FP/2026/1", client: "ACME", bu: "ICT", date: "2026-02-10", amountHt: 300 },
  { numero: "B1", fp: "FP/2025/2", client: "BETA", bu: "CLOUD", date: "2025-06-10", amountHt: 500 },
];
const OPPS = [
  { oppId: "o1", client: "ACME", am: "DATCHA", bu: "ICT", amount: 1000, stage: 4, probability: 0.6, weighted: 600, closingDate: "2026-03-01" },
  { oppId: "o2", client: "BETA", am: "KOUADIO", bu: "CLOUD", amount: 2000, stage: 2, probability: 0.25, weighted: 500, closingDate: "2026-04-01" },
  { oppId: "o3", client: "GAMMA", am: "DATCHA", bu: "ICT", amount: 5000, stage: 8, probability: 0.05, weighted: 250 },
  { oppId: "o4", client: "D", am: "X", bu: "ICT", amount: 100, stage: 6, probability: 1, weighted: 100 },
  { oppId: "o5", client: "E", am: "Y", bu: "ICT", amount: 100, stage: 7, probability: 0, weighted: 0 },
  // Éligible au pondéré : actif (stage 3) + IdC ≥ 90 %.
  { oppId: "o6", client: "ACME", am: "DATCHA", bu: "ICT", amount: 1000, stage: 3, probability: 0.95, weighted: 950, closingDate: "2026-05-01" },
];

describe("overview — chaîne (§7)", () => {
  const ov = overview(ORDERS, INVOICES, OPPS);
  it("commandes / facturé CAF (Σ factures, orphelines incluses) / RAF période", () => {
    expect(ov.commandes).toBe(2300);
    expect(ov.facture).toBe(1400); // CAF = Σ factures datées (non additif avec CAS/Backlog)
    expect(ov.rafPeriode).toBe(1200);
    expect(ov.backlog).toBe(1200); // sans opts → RAF période (rétro-compat)
    expect(ov.backlogCount).toBe(2); // FP/2026/1 (raf 400) + FP/2026/3 (raf 800)
  });
  it("facturé = CAF (Σ factures), orphelines incluses (facturation réelle)", () => {
    const ov2 = overview(ORDERS, [...INVOICES, { numero: "X", fp: "FP/9999/9", amountHt: 777 }], OPPS);
    expect(ov2.facture).toBe(2177); // 1400 + 777 : une facture orpheline reste du CA facturé
  });
  it("backlog GLISSANT fourni via opts (indépendant de la période)", () => {
    const ov3 = overview(ORDERS, INVOICES, OPPS, { backlog: 9999, backlogCount: 42 });
    expect(ov3.backlog).toBe(9999);
    expect(ov3.backlogCount).toBe(42);
    expect(ov3.rafPeriode).toBe(1200); // le taux reste sur la cohorte période
    expect(ov3.ratios.tauxFacturation).toBeCloseTo((2300 - 1200) / 2300, 6);
  });
  it("certitudes = pondéré certain (IdC≥90%) seul ; commandes suivies à part", () => {
    expect(ov.pondCertain).toBe(950); // o6 éligible
    expect(ov.certitudes).toBe(950); // pondéré quasi-certain seul (hors commandes signées)
  });
  it("avancement facturation = (CAS − RAF période)/CAS", () => {
    expect(ov.ratios.tauxFacturation).toBeCloseTo((2300 - 1200) / 2300, 6);
  });
});

describe("backlogFy — ancré FY, indépendant de la période (§7)", () => {
  it("total = Σ RAF des commandes ouvertes", () => {
    const b = backlogFy(ORDERS, 2026);
    expect(b.total).toBe(1200); // 400 + 800 (FP/2025/2 a raf=0 → exclu)
    expect(b.count).toBe(2);
    expect(b.byBu.ICT).toBe(1200);
    expect(b.byVintage["2026"]).toBe(1200);
    expect(b.fy).toBe(2026);
  });
  it("inchangé quelle que soit la période (pas de filtre période)", () => {
    expect(backlogFy(ORDERS, 2026).total).toBe(backlogFy(ORDERS, 2025).total);
  });
});

describe("pipeline — pondéré = éligibles (IdC ≥ 90 %), conversion", () => {
  const p = pipeline(OPPS);
  it("brut = toute la funnel active ; pondéré = éligibles ≥90%", () => {
    expect(p.tot.brut).toBe(4000); // active 1-5 : 1000 + 2000 + 1000
    expect(p.tot.weighted).toBe(950); // seul o6 (IdC 0.95) éligible
    expect(p.tot.countConf).toBe(1);
    expect(p.confianceMin).toBe(0.9);
  });
  it("suspendu (8) séparé", () => {
    expect(p.susp.brut).toBe(5000);
    expect(p.susp.count).toBe(1);
  });
  it("conversion = gagné/(gagné+perdu)", () => {
    expect(p.conv).toBe(0.5);
  });
  it("pondéré par AM = éligibles seulement", () => {
    expect(p.byAM.DATCHA).toBe(950); // o6
    expect(p.byAM.KOUADIO).toBeUndefined(); // o2 non éligible (proba 0.25)
  });
});

describe("suppliers — exposition/encours/couverture (§18.6)", () => {
  const bc = [
    { fp: "FP/2026/1", supplier: "HIPERDIST", amountXof: 250, status: "emis" },
    { fp: "FP/2026/1", supplier: "HIPERDIST", amountXof: 100, status: "solde" }, // soldé → exclu encours
  ];
  const credit = [{ id: "WESTCON", authorized: 1000, outstanding: 150 }];
  const s = suppliers(ORDERS, bc, credit);
  it("exposition = Σ suppliers.amount", () => {
    expect(s.totalExpo).toBe(600); // 300 + 200 + 100
  });
  it("achat commandes ouvertes = Σ sur RAF>0", () => {
    // HIPERDIST : 300 (FP/2026/1 raf>0) + 100 (FP/2026/3 raf>0) = 400 ; WESTCON raf=0 → 0
    expect(s.openTotal).toBe(400);
  });
  it("encours calculé = Σ BC non soldés (HIPERDIST=250) ; saisi prioritaire (WESTCON=150)", () => {
    const hip = s.bySupplier.find((x) => x.name === "HIPERDIST");
    const wes = s.bySupplier.find((x) => x.name === "WESTCON");
    expect(hip.encours).toBe(250);
    expect(wes.encours).toBe(150);
  });
  it("sans ligne de crédit (authorized=0) → non_suivi (pas de faux saturation)", () => {
    const hip = s.bySupplier.find((x) => x.name === "HIPERDIST");
    expect(hip.state).toBe("non_suivi"); // aucune creditLine → non statué
    const wes = s.bySupplier.find((x) => x.name === "WESTCON");
    expect(wes.state).toBe("ok"); // authorized 1000, couverture positive
  });
});

describe("reporting — facturation/rentabilité/entités", () => {
  it("facturation mensuelle + top clients", () => {
    const f = facturation(INVOICES);
    expect(f.total).toBe(1400);
    expect(f.monthly["2026-01"]).toBe(600);
    expect(f.topClients[0]).toEqual({ key: "ACME", value: 900 });
  });
  it("rentabilité %MB", () => {
    const r = rentabilite(ORDERS);
    expect(r.mb).toBe(470);
    expect(r.cas).toBe(2300);
    expect(r.pmb).toBeCloseTo(470 / 2300, 6);
  });
  it("byEntity client agrège cas/facturé/backlog", () => {
    const rows = byEntity(ORDERS, INVOICES, (x) => x.client);
    const acme = rows.find((r) => r.key === "ACME");
    expect(acme.cas).toBe(1800);
    expect(acme.facture).toBe(900);
    expect(acme.backlog).toBe(1200);
  });
});

describe("filterInvoices — période", () => {
  it("all vs année", () => {
    expect(filterInvoices(INVOICES, "all")).toHaveLength(3);
    expect(filterInvoices(INVOICES, "2026")).toHaveLength(2);
    expect(filterInvoices(INVOICES, "2025")).toHaveLength(1);
  });
});
