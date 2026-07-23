import { describe, it, expect } from "vitest";
const { toXof } = require("../lib/fx");

const rates = { EUR: 655.957, USD: 610 };

describe("toXof — conversion devise → XOF (BC)", () => {
  it("XOF → montant inchangé (arrondi)", () => {
    expect(toXof("XOF", 1000.4, "", rates)).toEqual({ amountXof: 1000, fxRate: null, fxSource: "xof" });
  });
  it("devise avec taux → conversion", () => {
    const r = toXof("EUR", 100, "", rates);
    expect(r.amountXof).toBe(65596); // 100 × 655.957 arrondi
    expect(r.fxRate).toBe(655.957);
    expect(r.fxSource).toBe("taux");
  });
  it("contre-valeur XOF saisie → override prioritaire sur le taux", () => {
    const r = toXof("USD", 100, 50000, rates);
    expect(r).toEqual({ amountXof: 50000, fxRate: null, fxSource: "manuel" });
  });
  it("devise SANS taux → 0 (à saisir), jamais le montant brut", () => {
    const r = toXof("GBP", 100, "", rates);
    expect(r.amountXof).toBe(0);
    expect(r.fxSource).toBe("a_saisir");
  });
  it("EUR sans taux paramétré → repli sur la parité fixe légale (655,957)", () => {
    const r = toXof("EUR", 100, "", {}); // aucun taux configuré
    expect(r.amountXof).toBe(65596);
    expect(r.fxRate).toBe(655.957);
    expect(r.fxSource).toBe("peg");
  });
  it("normalisation de la casse de la devise", () => {
    expect(toXof("eur", 10, "", rates).amountXof).toBe(6560); // 10 × 655.957 = 6559.57 → 6560
  });
});
