import { describe, it, expect } from "vitest";
import { WORKING_DAYS_PER_MONTH, consultantKpi, computeActivity } from "../domain/activityKpi.js";

const months = ["2026-01", "2026-02"];

describe("consultantKpi (Lot 13)", () => {
  it("occupation moyenne + jours facturables + CA prévisionnel", () => {
    const c = { id: "c1", name: "Alice", status: "active" };
    const a = [{ consultantId: "c1", startMonth: "2026-01", endMonth: "2026-02", allocationPct: 50, tjmBilled: 700 }];
    const k = consultantKpi(c, a, months, null);
    expect(k.occupancyPct).toBe(50);                 // 50% sur 2 mois
    expect(k.billableDays).toBe(WORKING_DAYS_PER_MONTH); // 0.5*20 * 2 mois = 20
    expect(k.revenueForecast).toBe(20 * 700);        // 20 j × 700
    expect(k.marginForecast).toBeNull();             // pas de coût fourni
  });
  it("intercontrat : consultant actif non staffé", () => {
    const k = consultantKpi({ id: "c2", status: "active" }, [], months, null);
    expect(k.occupancyPct).toBe(0);
    expect(k.idleMonths).toBe(2);
  });
  it("marge prévisionnelle intègre le coût de banc (actif = coût même non staffé)", () => {
    const k = consultantKpi({ id: "c3", status: "active" }, [], months, 400);
    // revenue 0 − (400 × 20 × 2) = −16000 (banc pur)
    expect(k.marginForecast).toBe(-16000);
  });
  it("plafonne l'occupation à 100 en cas de sur-affectation", () => {
    const a = [
      { consultantId: "c1", startMonth: "2026-01", endMonth: "2026-01", allocationPct: 80 },
      { consultantId: "c1", startMonth: "2026-01", endMonth: "2026-01", allocationPct: 60 },
    ];
    const k = consultantKpi({ id: "c1", status: "active" }, a, ["2026-01"], null);
    expect(k.occupancyPct).toBe(100);
  });
});

describe("computeActivity — agrégats global + par BU", () => {
  const consultants = [
    { id: "c1", name: "Alice", bu: "DATA", status: "active" },
    { id: "c2", name: "Bob", bu: "DATA", status: "active" },
    { id: "c3", name: "Old", bu: "CLOUD", status: "inactive" },
  ];
  const assignments = [{ consultantId: "c1", startMonth: "2026-01", endMonth: "2026-02", allocationPct: 100, tjmBilled: 600 }];
  it("occupation globale sur les actifs + taux d'intercontrat", () => {
    const r = computeActivity(consultants, assignments, months, {}, false);
    expect(r.global.active).toBe(2);
    expect(r.global.occupancyPct).toBe(50);       // c1=100, c2=0 → moyenne 50
    expect(r.global.intercontratPct).toBe(50);    // c2 idle 2 mois sur 2 actifs × 2 mois = 2/4
    expect(r.global.marginForecast).toBeNull();   // canCost=false
  });
  it("expose la marge quand canCost", () => {
    const r = computeActivity(consultants, assignments, months, { c1: 300 }, true);
    expect(r.global.marginForecast).not.toBeNull();
    expect(r.byBu.find((b) => b.bu === "DATA")).toBeTruthy();
  });
});
