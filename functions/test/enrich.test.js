import { describe, it, expect } from "vitest";
const { enrichBu, clientBuMap } = require("../lib/enrich");

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
