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

  it("deux CRA d'un MÊME (consultant × mois) ne gonflent PAS le dénominateur (mois distincts, audit Lot 5)", () => {
    // CRA manuel + contribution maintenance (source « mnt », ADR-013) sur le même mois : billedDays
    // s'ADDITIONNENT (une seule vérité du temps), mais le mois ne compte QU'UNE fois (months=1).
    const r = computeConstat([
      { consultantId: "c1", month: "2026-01", billedDays: 15, leaveDays: 2, internalDays: 0 },              // CRA manuel
      { consultantId: "c1", month: "2026-01", billedDays: 3, leaveDays: 0, internalDays: 0, source: "mnt" }, // maintenance
    ], ["2026-01"]);
    const c1 = r.rows.find((x) => x.consultantId === "c1");
    expect(c1.months).toBe(1);               // un seul mois calendaire, pas deux documents
    expect(c1.billedDays).toBe(18);          // 15 + 3 additionnés
    // TACE = 18 / (1×20 − 2 congés = 18) = 100 % — et non 18 / (2×20 − 2 = 38) = 47 % (bug corrigé)
    expect(c1.tacePct).toBe(100);
  });

  it("borne le TACE constaté à 100 % (jours facturés > jours ouvrables du modèle)", () => {
    // 28 facturés sur un mois modélisé à 20 j ouvrés → 140 % non borné : doit être clampé à 100.
    const r = computeConstat([{ consultantId: "c1", month: "2026-01", billedDays: 28, leaveDays: 0, internalDays: 0 }], ["2026-01"]);
    expect(r.rows[0].tacePct).toBe(100);
    expect(r.rows[0].occupancyPct).toBe(100);
    expect(r.global.tacePct).toBe(100);
  });
});
