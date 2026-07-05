import { describe, it, expect } from "vitest";
const { relances } = require("../domain/relances");

const ASOF = "2026-07-05";

describe("relances — plan de relance daté par responsable", () => {
  const ORDERS = [
    { fp: "FP/2026/1", am: "ALICE", client: "ACME" },
    { fp: "FP/2026/2", am: "BOB", client: "BETA" },
  ];
  const INVOICES = [
    { id: "I1", numero: "F001", fp: "FP/2026/1", client: "ACME", amountHt: 1000, dueDate: "2026-05-01", paid: false }, // échue 65 j
    { id: "I2", numero: "F002", fp: "FP/2026/2", client: "BETA", amountHt: 500, dueDate: "2026-08-01", paid: false },  // à échoir
    { id: "I3", numero: "F003", fp: "FP/2026/1", client: "ACME", amountHt: 500, dueDate: "2026-04-01", paid: true },   // payée → hors créances, mais facturée (compte au facturé du FP)
    { id: "I4", numero: "F004", fp: null, client: "GAMMA", amountHt: 300, dueDate: "2026-06-01", paid: false },        // échue, non attribuée
  ];
  const BC = [
    { bcNumber: "BC1", supplier: "SUP", fp: "FP/2026/1", amountXof: 700, status: "emis", etaContrat: "2026-06-01" },  // retard
    { bcNumber: "BC2", supplier: "SUP", fp: "FP/2026/2", amountXof: 400, status: "solde", etaContrat: "2026-01-01" }, // soldé → ignoré
    { bcNumber: "BC3", supplier: "SUP2", fp: null, amountXof: 200, status: "emis", etaReel: "2026-08-01" },           // ETA future
  ];
  const MS = {
    "FP/2026/1": [{ date: "2026-03-01", amount: 2000 }, { date: "2026-09-01", amount: 500 }], // échu 2000, facturé 1500 (I1 1000 + I3 500) → gap 500
    "FP/2026/2": [{ date: "2026-02-01", amount: 300 }], // échu 300, facturé 500 (I2) → gap négatif, ignoré
  };

  const r = relances(INVOICES, ORDERS, BC, MS, ASOF);

  it("créances échues : ne retient que les factures ouvertes en retard", () => {
    expect(r.creances.count).toBe(2); // I1 + I4 (I2 à échoir, I3 payée)
    expect(r.creances.total).toBe(1300);
    expect(r.creances.items[0].numero).toBe("F001"); // la plus en retard en tête
    expect(r.creances.items[0].am).toBe("ALICE");
  });

  it("créance sans FP → responsable Non attribué", () => {
    const gamma = r.creances.items.find((x) => x.client === "GAMMA");
    expect(gamma.am).toBe("Non attribué");
  });

  it("créances par responsable : ALICE 1000, Non attribué 300", () => {
    const alice = r.creances.byResp.find((x) => x.key === "ALICE");
    expect(alice.total).toBe(1000);
    expect(alice.count).toBe(1);
  });

  it("BC en retard : ETA dépassée & non livré uniquement", () => {
    expect(r.bc.count).toBe(1); // BC1 (BC2 soldé, BC3 ETA future)
    expect(r.bc.items[0].bcNumber).toBe("BC1");
    expect(r.bc.items[0].am).toBe("ALICE"); // AM de l'affaire FP/2026/1
    expect(r.bc.total).toBe(700);
  });

  it("jalons échus non facturés : gap = attendu échu − facturé, gap>0 seulement", () => {
    expect(r.jalons.count).toBe(1); // FP/2026/1 (gap 1000) ; FP/2026/2 gap négatif ignoré
    const j = r.jalons.items[0];
    expect(j.fp).toBe("FP/2026/1");
    expect(j.expected).toBe(2000);
    expect(j.invoiced).toBe(1500);
    expect(j.gap).toBe(500);
    expect(j.am).toBe("ALICE");
  });

  it("aucune donnée → agrégats vides et cohérents", () => {
    const e = relances([], [], [], {}, ASOF);
    expect(e.creances.count).toBe(0);
    expect(e.bc.total).toBe(0);
    expect(e.jalons.byResp).toEqual([]);
  });
});
