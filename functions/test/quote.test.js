import { describe, it, expect } from "vitest";
const { sanitizeLines, lineTotal, computeLines } = require("../domain/quote");

describe("sanitizeLines", () => {
  it("écarte les lignes sans désignation, borne remise et quantités", () => {
    const r = sanitizeLines([
      { product: "Serveur", qty: 2, unitPrice: 1000, discountPct: 10 },
      { product: "", qty: 5, unitPrice: 100 },                 // sans produit → écartée
      { product: "Licence", qty: -3, unitPrice: -50, discountPct: 200 }, // clampés
    ]);
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ product: "Licence", qty: 0, unitPrice: 0, discountPct: 100 });
  });
  it("borne à 50 lignes", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ product: `P${i}`, qty: 1, unitPrice: 1 }));
    expect(sanitizeLines(many)).toHaveLength(50);
  });
});

describe("lineTotal — quantité × prix × (1 − remise)", () => {
  it("applique la remise, arrondit à l'unité", () => {
    expect(lineTotal({ qty: 2, unitPrice: 1000, discountPct: 10 })).toBe(1800);
    expect(lineTotal({ qty: 3, unitPrice: 333, discountPct: 0 })).toBe(999);
    expect(lineTotal({ qty: 1, unitPrice: 100, discountPct: 100 })).toBe(0);
  });
});

describe("computeLines — total dérivé des lignes", () => {
  it("somme les totaux de ligne", () => {
    const r = computeLines([
      { product: "A", qty: 2, unitPrice: 1000, discountPct: 10 }, // 1800
      { product: "B", qty: 1, unitPrice: 500, discountPct: 0 },   // 500
    ]);
    expect(r.total).toBe(2300);
    expect(r.lines[0].lineTotal).toBe(1800);
  });
  it("liste vide → total 0", () => {
    expect(computeLines([]).total).toBe(0);
    expect(computeLines(null).lines).toEqual([]);
  });
});
