import { describe, it, expect } from "vitest";
const { mergeCommandes } = require("../domain/commandes");

describe("mergeCommandes — précédence fiche > opp gagnée > P&L", () => {
  const orders = [
    { fp: "FP/2026/1", client: "PNL", bu: "ICT", am: "X", cas: 500, raf: 200, mb: 50, yearPo: 2026, source: "pnl", suppliers: [{ name: "S", amount: 100 }] },
    { fp: "FP/2026/9", client: "PNLONLY", bu: "CLOUD", cas: 300, raf: 300, mb: 30, yearPo: 2026, source: "pnl" },
  ];
  const opps = [
    { fp: "FP/2026/1", client: "OPP", am: "AM1", bu: "ICT", amount: 800, stage: 6, closingDate: "2026-05-01" }, // gagnée → écrase P&L
    { fp: "FP/2026/2", client: "BETA", am: "AM2", bu: "CLOUD", amount: 1000, stage: 6, closingDate: "2026-06-01" }, // nouvelle commande
    { fp: "FP/2026/3", client: "GAMMA", amount: 400, stage: 4, closingDate: "2026-07-01" }, // pas gagnée → ignorée
  ];
  const sheets = [
    { fp: "FP/2026/1", client: "SAFINE", commercial: "AF", affaire: "RESEAUX", saleTotal: 900, margin: 90, costTotal: 810, marginPct: 0.1 }, // écrase tout
  ];
  const invoices = [{ fp: "FP/2026/2", amountHt: 250 }]; // facturé sur FP/2026/2
  const cmd = mergeCommandes(orders, opps, sheets, invoices);
  const byFp = Object.fromEntries(cmd.map((c) => [c.fp, c]));

  it("fiche écrase opp gagnée et P&L (CAS=vente, marge, client, AM, affaire)", () => {
    const c = byFp["FP/2026/1"];
    expect(c.source).toBe("fiche");
    expect(c.cas).toBe(900);
    expect(c.mb).toBe(90);
    expect(c.client).toBe("SAFINE");
    expect(c.am).toBe("AF");
    expect(c.affaire).toBe("RESEAUX");
  });
  it("opp gagnée crée une commande (CAS=montant, marge 0)", () => {
    const c = byFp["FP/2026/2"];
    expect(c.source).toBe("opp_won");
    expect(c.cas).toBe(1000);
    expect(c.mb).toBe(0);
    expect(c.raf).toBe(750); // 1000 − 250 facturé
  });
  it("opp NON gagnée ignorée", () => expect(byFp["FP/2026/3"]).toBeUndefined());
  it("P&L conservé si ni fiche ni opp gagnée (RAF P&L gardé)", () => {
    const c = byFp["FP/2026/9"];
    expect(c.source).toBe("pnl");
    expect(c.cas).toBe(300);
    expect(c.raf).toBe(300);
  });
  it("RAF fiche = CAS − facturé (pas de facture ici → RAF = CAS)", () => {
    expect(byFp["FP/2026/1"].raf).toBe(900);
  });
});
