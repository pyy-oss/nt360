import { describe, it, expect } from "vitest";
const { dataQuality } = require("../domain/dataQuality");

describe("dataQuality — hygiène d'ingestion", () => {
  const orders = [
    { fp: "FP/2026/1", client: "ACME", am: "DATCHA", cas: 1000, yearPo: 2026 },
    { fp: "FP/2026/2", client: "", am: "", cas: 500, yearPo: 0 }, // sans client/am/année
    { fp: "FP/2026/3", client: "BETA", am: "X", cas: 200, yearPo: 2026 }, // surfacturée (300 > 200)
  ];
  const invoices = [
    { numero: "A1", fp: "FP/2026/1", amountHt: 600, date: "2026-01-10", dueDate: "2026-02-10", linked: true },
    { numero: "A2", fp: "FP/2026/3", amountHt: 300, date: "2026-02-10", linked: true }, // sans échéance
    { numero: "OR", fp: "FP/9999/9", amountHt: 100, linked: false }, // orpheline + sans date
  ];
  const opps = [
    { client: "GAMMA", stage: 3, amount: 1000, closingDate: "2026-05-01" },
    { client: "DELTA", stage: 4, amount: 0, closingDate: null }, // active sans D Prev + sans montant
    { client: "OMEGA", stage: 6, amount: 500 }, // gagnée SANS FP → non transformable
  ];
  const bcLines = [{ fp: "FP/2026/1", supplier: "HDF", amountXof: 100 }, { fp: "", supplier: "", bcNumber: "BC1" }];
  const sheets = [{ fp: "FP/2026/1", saleTotal: 900 }, { fp: "FP/2026/9", saleTotal: 0 }];
  const q = dataQuality(orders, invoices, opps, bcLines, sheets);
  const byType = Object.fromEntries(q.issues.map((i) => [i.type, i]));

  it("factures orphelines + surfacturation en sévérité haute", () => {
    expect(byType.factures_orphelines.count).toBe(1); // OR
    expect(byType.surfacturation.count).toBe(1); // FP/2026/3
    expect(byType.factures_orphelines.severity).toBe("high");
  });
  it("commandes : sans année / sans client / sans AM", () => {
    expect(byType.commandes_sans_annee.count).toBe(1); // FP/2026/2
    expect(byType.commandes_sans_client.count).toBe(1);
    expect(byType.commandes_sans_am.count).toBe(1);
  });
  it("opps actives sans D Prev / sans montant (gagnées exclues)", () => {
    expect(byType.opps_sans_dprev.count).toBe(1); // DELTA (OMEGA gagnée exclue)
    expect(byType.opps_sans_montant.count).toBe(1);
  });
  it("opp GAGNÉE sans N° FP signalée (sévérité haute)", () => {
    expect(byType.opps_gagnees_sans_fp.count).toBe(1); // OMEGA (stage 6, pas de fp)
    expect(byType.opps_gagnees_sans_fp.severity).toBe("high");
  });
  it("factures sans échéance + BC/fiches incomplets", () => {
    expect(byType.factures_sans_echeance.count).toBe(2); // A2 + OR
    expect(byType.bc_sans_fp.count).toBe(1);
    expect(byType.fiches_sans_vente.count).toBe(1);
    // BC1 a un N° BC mais aucun montant XOF → BC émis à montant nul (devise à convertir ?).
    expect(byType.bc_montant_zero.count).toBe(1);
    expect(byType.bc_montant_zero.severity).toBe("medium");
  });
  it("opp GAGNÉE avec FP mais SANS ligne P&L → à réconcilier (sévérité haute)", () => {
    // FP/2026/1 est une commande (P&L) ; FP/2026/8 ne l'est pas → réconciliation à faire.
    const q2 = dataQuality(
      [{ fp: "FP/2026/1", client: "ACME", cas: 1000, yearPo: 2026 }],
      [],
      [
        { fp: "FP/2026/1", client: "ACME", stage: 6, amount: 1000 }, // réconciliée → OK
        { fp: "FP/2026/8", client: "MTN", stage: 6, amount: 500 },   // sans P&L → signalée
      ],
      [], [],
    );
    const t = Object.fromEntries(q2.issues.map((i) => [i.type, i]));
    expect(t.opps_gagnees_sans_pnl.count).toBe(1);
    expect(t.opps_gagnees_sans_pnl.refs).toContain("FP/2026/8");
    expect(t.opps_gagnees_sans_pnl.severity).toBe("high");
  });
  it("issues triées par sévérité (high avant medium avant low)", () => {
    const ranks = q.issues.map((i) => ({ high: 0, medium: 1, low: 2 }[i.severity]));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
  it("score de complétude borné [0,1] et counts renvoyés", () => {
    expect(q.score).toBeGreaterThanOrEqual(0);
    expect(q.score).toBeLessThanOrEqual(1);
    expect(q.counts.orders).toBe(3);
    expect(q.counts.invoices).toBe(3);
  });
});
