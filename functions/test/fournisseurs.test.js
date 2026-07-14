import { describe, it, expect } from "vitest";
const { suppliers } = require("../domain/fournisseurs");

// Récupère l'agrégat d'un fournisseur par nom (normalisé majuscules dans le domaine).
const sup = (res, name) => res.bySupplier.find((s) => s.name === name.toUpperCase());

describe("suppliers — BC en devise non convertie (SOA indéterminé)", () => {
  it("BC réel (N° BC) à montant XOF nul → fournisseur `unvalued` + état « indetermine » (pas « ok » à tort)", () => {
    const orders = [];
    const bcLines = [{ bcNumber: "BC-USD-1", supplier: "DELL", amountXof: 0, status: "emis" }]; // devise non convertie
    const credit = [{ id: "DELL", authorized: 100_000, openingBalance: 0 }];
    const r = suppliers(orders, bcLines, credit);
    const c = sup(r, "DELL");
    expect(c.unvalued).toBe(true);
    expect(c.state).toBe("indetermine"); // le disponible « ok » ne doit pas rassurer à tort
    expect(r.indeterminate).toContain("DELL");
  });
  it("BC valorisé → PAS de flag ; état normal", () => {
    const r = suppliers([], [{ bcNumber: "BC1", supplier: "DELL", amountXof: 50_000, status: "emis" }], [{ id: "DELL", authorized: 100_000, openingBalance: 0 }]);
    const c = sup(r, "DELL");
    expect(c.unvalued).toBe(false);
    expect(c.state).toBe("ok");
  });
  it("saturation réelle prime sur « indetermine » (état pire conservé)", () => {
    const r = suppliers([], [
      { bcNumber: "BC1", supplier: "DELL", amountXof: 120_000, status: "facture" }, // dépasse déjà le plafond
      { bcNumber: "BC2", supplier: "DELL", amountXof: 0, status: "emis" },           // + un non converti
    ], [{ id: "DELL", authorized: 100_000, openingBalance: 0 }]);
    expect(sup(r, "DELL").state).toBe("saturation");
  });
});

describe("suppliers — netting BC ↔ achat commande (anti double-compte)", () => {
  it("BC du même FP+fournisseur : l'achat commande est netté (pas de double engagement)", () => {
    const orders = [{ fp: "FP/2026/1", raf: 10, suppliers: [{ name: "CISCO", amount: 40000 }] }];
    const bcLines = [{ fp: "FP/2026/1", supplier: "CISCO", amountXof: 40000, status: "emis" }];
    const r = suppliers(orders, bcLines, []);
    const c = sup(r, "CISCO");
    expect(c.engagement).toBe(40000); // BC engagé, achat commande entièrement couvert → open 0
  });
  it("BC SANS FP du même fournisseur : nette quand même l'achat (repli fournisseur) — cf. audit P0-B", () => {
    const orders = [{ fp: "FP/2026/1", raf: 10, suppliers: [{ name: "CISCO", amount: 40000 }] }];
    const bcLines = [{ fp: "", supplier: "CISCO", amountXof: 40000, status: "emis" }]; // BC saisi sans N° FP
    const r = suppliers(orders, bcLines, []);
    const c = sup(r, "CISCO");
    // AVANT le correctif : engagement = 40000 (BC) + 40000 (open non netté) = 80000 (double compte).
    expect(c.engagement).toBe(40000);
  });
  it("BC sans FP inférieur à l'achat : le reliquat reste en prévisionnel (open)", () => {
    const orders = [{ fp: "FP/2026/2", raf: 5, suppliers: [{ name: "DELL", amount: 100000 }] }];
    const bcLines = [{ fp: "", supplier: "DELL", amountXof: 30000, status: "emis" }];
    const r = suppliers(orders, bcLines, []);
    const c = sup(r, "DELL");
    expect(c.engagement).toBe(100000); // 30000 (BC) + 70000 (reliquat open)
  });
});
