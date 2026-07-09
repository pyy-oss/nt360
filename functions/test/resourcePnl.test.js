import { describe, it, expect } from "vitest";
import { consultantPnl, computeResourcePnl } from "../domain/resourcePnl.js";

describe("consultantPnl (Lot 17)", () => {
  it("CA = jours facturés × TJM ; coût = mois × 20 × CJM ; marge = CA − coût", () => {
    const p = consultantPnl({ id: "c1", tjmTarget: 700, cjm: 400, bu: "DATA", grade: "senior" }, { billedDays: 30, months: 2 });
    expect(p.caReal).toBe(21000);      // 30 × 700
    expect(p.cost).toBe(16000);        // 2 × 20 × 400
    expect(p.margin).toBe(5000);
    expect(p.marginPct).toBe(24);      // 5000/21000 ≈ 24%
  });
  it("sans CJM : coût/marge null (confidentialité / donnée manquante)", () => {
    const p = consultantPnl({ id: "c2", tjmTarget: 600 }, { billedDays: 10, months: 1 });
    expect(p.caReal).toBe(6000);
    expect(p.cost).toBeNull();
    expect(p.margin).toBeNull();
  });
});

describe("computeResourcePnl — agrégats global / BU / grade", () => {
  const consultants = [
    { id: "c1", tjmTarget: 700, cjm: 400, bu: "DATA", grade: "senior" },
    { id: "c2", tjmTarget: 600, cjm: 350, bu: "DATA", grade: "junior" },
    { id: "c3", tjmTarget: 800, cjm: 500, bu: "CLOUD", grade: "expert" }, // pas de CRA → exclu
  ];
  const constat = { c1: { billedDays: 20, months: 1 }, c2: { billedDays: 18, months: 1 } };
  it("n'inclut que les consultants ayant un CRA", () => {
    const r = computeResourcePnl(consultants, constat);
    expect(r.rows.length).toBe(2);
    expect(r.global.headcount).toBe(2);
    // CA global = 20×700 + 18×600 = 14000 + 10800 = 24800
    expect(r.global.caReal).toBe(24800);
    expect(r.byBu.find((b) => b.key === "DATA").caReal).toBe(24800);
    expect(r.byGrade.length).toBe(2);
  });
});
