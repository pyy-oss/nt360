import { describe, it, expect } from "vitest";
const { finiteInRange, validateYearPo, clampStage, oppWeighted, computeFicheMargin } = require("../domain/mutations");

describe("mutations — logique pure des correctifs (create*/patch*)", () => {
  it("finiteInRange : borne, tronque, rejette non-fini", () => {
    expect(finiteInRange(5, { min: 0, max: 10 })).toEqual({ ok: true, value: 5 });
    expect(finiteInRange("7", { min: 0, max: 10 })).toEqual({ ok: true, value: 7 });
    expect(finiteInRange(2026.9, { int: true })).toEqual({ ok: true, value: 2026 });
    expect(finiteInRange(-1, { min: 0 }).ok).toBe(false);
    expect(finiteInRange(11, { max: 10 }).ok).toBe(false);
    expect(finiteInRange("abc").ok).toBe(false);
    expect(finiteInRange(NaN).ok).toBe(false);
  });

  it("validateYearPo : [2015, année+3], entier ; rejette 0 / hors borne", () => {
    expect(validateYearPo(2026, 2026)).toEqual({ ok: true, value: 2026 });
    expect(validateYearPo(2029, 2026)).toEqual({ ok: true, value: 2029 }); // +3 OK
    expect(validateYearPo(2030, 2026).ok).toBe(false); // +4 hors borne
    expect(validateYearPo(2014, 2026).ok).toBe(false);
    expect(validateYearPo(0, 2026).ok).toBe(false);
    expect(validateYearPo("pas une année", 2026).ok).toBe(false);
  });

  it("clampStage : borne 1..9, défaut 1 sur saisie invalide", () => {
    expect(clampStage(6)).toBe(6);
    expect(clampStage("3")).toBe(3);
    expect(clampStage(0)).toBe(1);
    expect(clampStage(12)).toBe(9);
    expect(clampStage("xxx")).toBe(1);
    expect(clampStage(4.8)).toBe(4);
  });

  it("oppWeighted : montant × probabilité, coercition et défaut 0", () => {
    expect(oppWeighted(1000, 0.6)).toBe(600);
    expect(oppWeighted("500", "0.2")).toBe(100);
    expect(oppWeighted(undefined, 0.5)).toBe(0);
    expect(oppWeighted(1000, undefined)).toBe(0);
  });

  it("computeFicheMargin : marge = vente − revient, %MB = marge / vente", () => {
    expect(computeFicheMargin({ saleTotal: 1000, costTotal: 600 }))
      .toEqual({ saleTotal: 1000, costTotal: 600, margin: 400, marginPct: 0.4 });
  });

  it("computeFicheMargin : saisie PARTIELLE → complète avec les valeurs courantes", () => {
    // On ne fournit que la vente ; le revient vient de la fiche existante.
    const r = computeFicheMargin({ saleTotal: 1200, costTotal: undefined, prev: { costTotal: 600, saleTotal: 1000, margin: 400, marginPct: 0.4 } });
    expect(r.saleTotal).toBe(1200);
    expect(r.costTotal).toBe(600);
    expect(r.margin).toBe(600); // 1200 − 600
    expect(r.marginPct).toBeCloseTo(0.5, 5);
  });

  it("computeFicheMargin : vente nulle → marginPct retombe sur le courant (pas de division par 0)", () => {
    const r = computeFicheMargin({ saleTotal: 0, costTotal: 0, prev: { marginPct: null } });
    expect(r.margin).toBe(0);
    expect(r.marginPct).toBeNull();
  });

  it("computeFicheMargin : aucun des deux connu → marge/‰ conservés (null)", () => {
    const r = computeFicheMargin({ saleTotal: undefined, costTotal: undefined, prev: {} });
    expect(r.saleTotal).toBeNull();
    expect(r.costTotal).toBeNull();
    expect(r.margin).toBeNull();
    expect(r.marginPct).toBeNull();
  });
});
