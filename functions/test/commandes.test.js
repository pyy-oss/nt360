import { describe, it, expect } from "vitest";
const { mergeCommandes } = require("../domain/commandes");

describe("mergeCommandes — précédence fiche > opp gagnée > P&L", () => {
  const orders = [
    { fp: "FP/2026/1", client: "PNL", bu: "ICT", am: "X", cas: 500, raf: 200, mb: 50, yearPo: 2026, source: "pnl", suppliers: [{ name: "S", amount: 100 }] },
    { fp: "FP/2026/9", client: "PNLONLY", bu: "CLOUD", cas: 300, raf: 300, mb: 30, yearPo: 2026, source: "pnl" },
    { fp: "FP/2026/5", client: "PNLMB", bu: "ICT", am: "Z", cas: 600, raf: 100, mb: 120, marginPct: 0.2, costTotal: 480, yearPo: 2026, source: "pnl" },
  ];
  const opps = [
    { fp: "FP/2026/1", client: "OPP", am: "AM1", bu: "ICT", amount: 800, stage: 6, closingDate: "2026-05-01" }, // gagnée → écrase P&L
    { fp: "FP/2026/2", client: "BETA", am: "AM2", bu: "CLOUD", amount: 1000, stage: 6, closingDate: "2026-06-01" }, // nouvelle commande
    { fp: "FP/2026/3", client: "GAMMA", amount: 400, stage: 4, closingDate: "2026-07-01" }, // pas gagnée → ignorée
    { fp: "FP/2026/5", client: "OPP5", am: "AM5", bu: "ICT", amount: 700, stage: 6, closingDate: "2026-08-01" }, // gagnée sur un P&L : garde la marge P&L
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
  it("opp gagnée crée une commande (CAS=montant, marge 0, sans provenance P&L)", () => {
    const c = byFp["FP/2026/2"];
    expect(c.source).toBe("opp_won");
    expect(c.cas).toBe(1000);
    expect(c.mb).toBe(0);
    expect(c.pnlSource).toBe(null); // aucune donnée P&L d'origine
    expect(c.raf).toBe(750); // 1000 − 250 facturé
  });
  it("opp gagnée sur un P&L : CAS=opp mais marge/coût P&L CONSERVÉS (pnlSource=manuel)", () => {
    const c = byFp["FP/2026/5"];
    expect(c.source).toBe("opp_won");
    expect(c.cas).toBe(700); // CAS = montant de l'opp gagnée
    expect(c.mb).toBe(120); // marge P&L conservée
    expect(c.marginPct).toBe(0.2);
    expect(c.costTotal).toBe(480);
    expect(c.pnlSource).toBe("manuel");
  });
  it("opp NON gagnée ignorée", () => expect(byFp["FP/2026/3"]).toBeUndefined());
  it("P&L conservé si ni fiche ni opp gagnée ; RAF DÉRIVÉ = CAS − facturé (pnlSource=manuel)", () => {
    const c = byFp["FP/2026/9"];
    expect(c.source).toBe("pnl");
    expect(c.cas).toBe(300);
    expect(c.raf).toBe(300); // aucune facture sur ce FP → RAF = CAS
    expect(c.pnlSource).toBe("manuel");
  });
  it("fiche affaire → pnlSource=fiche", () => expect(byFp["FP/2026/1"].pnlSource).toBe("fiche"));
  it("RAF fiche = CAS − facturé (pas de facture ici → RAF = CAS)", () => {
    expect(byFp["FP/2026/1"].raf).toBe(900);
  });
});

describe("mergeCommandes — garde-fous contre l'écrasement par 0", () => {
  it("opp gagnée SANS montant n'écrase pas le CAS P&L existant", () => {
    const orders = [{ fp: "FP/2026/1", client: "PNL", cas: 500, raf: 200, mb: 120, yearPo: 2026, source: "pnl" }];
    const opps = [{ fp: "FP/2026/1", client: "OPP", am: "AM1", amount: 0, stage: 6, closingDate: "2026-05-01" }];
    const c = mergeCommandes(orders, opps, [], []);
    const row = c.find((x) => x.fp === "FP/2026/1");
    expect(row.cas).toBe(500); // CAS P&L conservé (pas remis à 0)
    expect(row.mb).toBe(120);
    expect(row.source).toBe("opp_won");
  });
  it("opp gagnée SANS montant NI P&L → aucune commande fantôme", () => {
    const c = mergeCommandes([], [{ fp: "FP/2026/2", client: "X", amount: 0, stage: 6 }], [], []);
    expect(c.find((x) => x.fp === "FP/2026/2")).toBeUndefined();
  });
  it("fiche SANS prix de vente (0) n'écrase pas la commande existante", () => {
    const orders = [{ fp: "FP/2026/1", client: "PNL", cas: 500, raf: 200, mb: 120, yearPo: 2026, source: "pnl" }];
    const sheets = [{ fp: "FP/2026/1", client: "SAFINE", saleTotal: 0, margin: 0 }];
    const c = mergeCommandes(orders, [], sheets, []);
    const row = c.find((x) => x.fp === "FP/2026/1");
    expect(row.cas).toBe(500); // CAS P&L préservé
    expect(row.mb).toBe(120);
    expect(row.source).toBe("pnl"); // fiche vide ignorée
  });
});

describe("mergeCommandes — RAF dérivé (CAS − facturé), facturation multi-exercices", () => {
  it("RAF P&L ne garde PLUS le RAF Excel figé : recalcule sur les factures réelles", () => {
    // P&L avec RAF Excel = 1000 (instantané avant facturation), puis 600 facturés → RAF réel = 400.
    const orders = [{ fp: "FP/2024/1", client: "ACME", cas: 1000, raf: 1000, yearPo: 2024, source: "pnl" }];
    const invoices = [{ fp: "FP/2024/1", amountHt: 600, date: "2025-02-01" }];
    const c = mergeCommandes(orders, [], [], invoices);
    expect(c[0].raf).toBe(400); // 1000 − 600 (et non 1000 figé)
  });
  it("CAS d'une année antérieure, facturation étalée sur plusieurs exercices → RAF net global", () => {
    const orders = [{ fp: "FP/2023/7", client: "BETA", cas: 1000, raf: 800, yearPo: 2023, source: "pnl" }];
    const invoices = [
      { fp: "FP/2023/7", amountHt: 300, date: "2023-11-01" },
      { fp: "FP/2023/7", amountHt: 250, date: "2024-05-01" },
      { fp: "FP/2023/7", amountHt: 200, date: "2025-03-01" },
    ];
    const c = mergeCommandes(orders, [], [], invoices);
    expect(c[0].raf).toBe(250); // 1000 − (300+250+200), toutes années confondues
  });
  it("surfacturation (Σfactures > CAS) → RAF borné à 0", () => {
    const orders = [{ fp: "FP/2026/8", client: "GAMMA", cas: 500, raf: 500, yearPo: 2026, source: "pnl" }];
    const invoices = [{ fp: "FP/2026/8", amountHt: 700, date: "2026-04-01" }];
    const c = mergeCommandes(orders, [], [], invoices);
    expect(c[0].raf).toBe(0);
  });
});
