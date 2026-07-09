import { describe, it, expect } from "vitest";
import { validateTimesheet, tace, occupancy, computeConstat } from "../domain/timesheet.js";

describe("validateTimesheet (Lot 15 CRA)", () => {
  it("consultant + mois requis", () => {
    expect(validateTimesheet({}).ok).toBe(false);
    expect(validateTimesheet({ consultantId: "c1" }).ok).toBe(false);
    expect(validateTimesheet({ consultantId: "c1", month: "2026-01" }).ok).toBe(true);
  });
  it("borne les jours et tolère une date ISO", () => {
    const v = validateTimesheet({ consultantId: "c1", month: "2026-01-15", billedDays: 18, leaveDays: -2, internalDays: "x" }).value;
    expect(v.month).toBe("2026-01");
    expect(v.billedDays).toBe(18);
    expect(v.leaveDays).toBe(0);   // négatif → 0
    expect(v.internalDays).toBe(0); // NaN → 0
  });
});

describe("tace / occupancy — congés exclus", () => {
  it("TACE = facturé ÷ (ouvrés − congés)", () => {
    expect(tace({ billedDays: 15, leaveDays: 0 }, 20)).toBeCloseTo(0.75, 5);
    expect(tace({ billedDays: 15, leaveDays: 5 }, 20)).toBeCloseTo(1, 5);   // 15/(20-5)=1
    expect(tace({ billedDays: 0, leaveDays: 20 }, 20)).toBeNull();          // aucun jour ouvrable
  });
  it("occupation inclut l'interne", () => {
    expect(occupancy({ billedDays: 12, internalDays: 4 }, 20)).toBeCloseTo(0.8, 5);
  });
});

describe("computeConstat — agrégat constaté", () => {
  const months = ["2026-01", "2026-02"];
  const ts = [
    { consultantId: "c1", month: "2026-01", billedDays: 18, leaveDays: 2, internalDays: 0 },
    { consultantId: "c1", month: "2026-02", billedDays: 20, leaveDays: 0, internalDays: 0 },
    { consultantId: "c2", month: "2026-01", billedDays: 5, leaveDays: 0, internalDays: 10 },
    { consultantId: "cX", month: "2025-12", billedDays: 20, leaveDays: 0, internalDays: 0 }, // hors plage → ignoré
  ];
  it("ignore les mois hors plage et calcule le TACE par consultant", () => {
    const r = computeConstat(ts, months);
    expect(r.rows.length).toBe(2);
    const c1 = r.rows.find((x) => x.consultantId === "c1");
    // c1 : 38 facturés / (2×20 − 2 congés = 38) = 100%
    expect(c1.tacePct).toBe(100);
    expect(r.global.reportedConsultants).toBe(2);
  });
});
