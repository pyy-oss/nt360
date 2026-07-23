import { describe, it, expect } from "vitest";
const { enrichBu, enrichLinks, clientBuMap } = require("../lib/enrich");

describe("enrichBu — reconstruction BU (jointure FP puis client)", () => {
  const orders = [
    { fp: "FP/2026/1", client: "ACME", bu: "ICT" },
    { fp: "FP/2026/2", client: "ACME", bu: "ICT" },
    { fp: "FP/2026/3", client: "BETA", bu: "CLOUD" },
  ];
  it("BU majoritaire par client", () => {
    expect(clientBuMap(orders)).toEqual({ ACME: "ICT", BETA: "CLOUD" });
  });
  it("corrige AUTRE par FP puis par client", () => {
    const invoices = [
      { fp: "FP/2026/1", client: "ACME", bu: "AUTRE" }, // via FP → ICT
      { fp: "FP/9999/9", client: "BETA", bu: "AUTRE" }, // FP inconnu → client BETA → CLOUD
      { fp: "FP/0/0", client: "INCONNU", bu: "AUTRE" }, // ni FP ni client → reste AUTRE
      { fp: "FP/2026/1", client: "ACME", bu: "ICT" },   // déjà classé → inchangé
    ];
    const opps = [{ fp: "FP/2026/3", client: "BETA", bu: "AUTRE" }];
    const res = enrichBu({ orders, invoices, opportunities: opps });
    expect(invoices[0].bu).toBe("ICT");
    expect(invoices[1].bu).toBe("CLOUD");
    expect(invoices[2].bu).toBe("AUTRE");
    expect(opps[0].bu).toBe("CLOUD");
    expect(res.buFixedInvoices).toBe(2);
    expect(res.buFixedOpps).toBe(1);
  });
});

describe("enrichLinks — rattachement facture↔commande", () => {
  it("marque linked / prePo et compte les orphelines", () => {
    const orders = [{ fp: "FP/2026/1", yearPo: 2026 }];
    const invoices = [
      { fp: "FP/2026/1", amountHt: 100, date: "2026-02-01" },  // rattachée
      { fp: "FP/2026/1", amountHt: 50, date: "2025-02-01" },   // rattachée mais AVANT le PO
      { fp: "FP/9999/9", amountHt: 200, date: "2026-01-01" },  // orpheline
    ];
    const res = enrichLinks({ orders, invoices });
    expect(invoices[0].linked).toBe(true);
    expect(invoices[1].prePo).toBe(true);
    expect(invoices[2].linked).toBe(false);
    expect(res.orphanCount).toBe(1);
    expect(res.orphanAmount).toBe(200);
  });
  it("marque preCmd : facture datée AVANT la date de commande (au jour près)", () => {
    const orders = [{ fp: "FP/2026/1", yearPo: 2026, dateCommande: "2026-03-15" }];
    const invoices = [
      { fp: "FP/2026/1", amountHt: 100, date: "2026-03-10" }, // avant dateCommande → preCmd
      { fp: "FP/2026/1", amountHt: 100, date: "2026-04-01" }, // après → non
      { fp: "FP/2026/1", amountHt: 100, date: "2026-03-15" }, // même jour → non (pas strictement avant)
    ];
    enrichLinks({ orders, invoices });
    expect(invoices[0].preCmd).toBe(true);
    expect(invoices[1].preCmd).toBe(false);
    expect(invoices[2].preCmd).toBe(false);
  });
  it("preCmd = false quand la commande n'a pas de date de commande", () => {
    const orders = [{ fp: "FP/2026/1", yearPo: 2026 }]; // pas de dateCommande
    const invoices = [{ fp: "FP/2026/1", amountHt: 100, date: "2020-01-01" }];
    enrichLinks({ orders, invoices });
    expect(invoices[0].preCmd).toBe(false);
  });
});
