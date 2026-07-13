import { describe, it, expect } from "vitest";
const { computeTaceTrend, monthPoint } = require("../domain/taceTrend");

describe("taceTrend — historisation TACE + tendance (Lot 22)", () => {
  const consultants = [
    { id: "c1", bu: "ICT" },
    { id: "c2", bu: "CLOUD" },
  ];
  // 3 mois : TACE en progression (16/18/19 j facturés pour c1 sans congé → 80/90/95 %).
  const timesheets = [
    { consultantId: "c1", month: "2026-04", billedDays: 16, leaveDays: 0, internalDays: 4 },
    { consultantId: "c1", month: "2026-05", billedDays: 18, leaveDays: 0, internalDays: 2 },
    { consultantId: "c1", month: "2026-06", billedDays: 19, leaveDays: 0, internalDays: 1 },
    { consultantId: "c2", month: "2026-06", billedDays: 9, leaveDays: 10, internalDays: 0 }, // congés → dénominateur réduit
  ];
  const months = ["2026-03", "2026-04", "2026-05", "2026-06"]; // mars sans CRA
  const r = computeTaceTrend(timesheets, consultants, months);

  it("TACE mensuel = jours facturés ÷ jours ouvrables (congés exclus)", () => {
    const apr = r.series.find((s) => s.month === "2026-04");
    expect(apr.tacePct).toBe(80);  // 16/20
    const may = r.series.find((s) => s.month === "2026-05");
    expect(may.tacePct).toBe(90);  // 18/20
  });
  it("congés exclus du dénominateur : c2 en juin (9 facturés / (20−10)=10 ouvrables) = 90 %, agrégé avec c1", () => {
    const jun = r.series.find((s) => s.month === "2026-06");
    // c1: 19 fact / 20 ouvrables ; c2: 9 fact / (20−10)=10 ouvrables → Σfact 28 / Σouvrables 30 = 93 %.
    expect(jun.tacePct).toBe(Math.round(28 / 30 * 100)); // 93
    expect(jun.headcount).toBe(2);
    // par BU présent
    const ict = jun.byBu.find((b) => b.bu === "ICT");
    expect(ict.tacePct).toBe(95); // 19/20
    const cloud = jun.byBu.find((b) => b.bu === "CLOUD");
    expect(cloud.tacePct).toBe(90); // 9/10
  });
  it("mois sans CRA → point vide (tacePct null), exclu du résumé", () => {
    const mar = r.series.find((s) => s.month === "2026-03");
    expect(mar.tacePct).toBe(null);
    expect(r.summary.points).toBe(3); // avr, mai, juin
  });
  it("résumé de tendance : dernier, moyenne, delta, pente positive, direction up", () => {
    expect(r.summary.latest).toBe(93);      // juin
    expect(r.summary.previous).toBe(90);    // mai
    expect(r.summary.delta).toBe(3);        // 93 − 90
    expect(r.summary.avg).toBe(Math.round((80 + 90 + 93) / 3)); // 88
    expect(r.summary.slope).toBeGreaterThan(1);
    expect(r.summary.direction).toBe("up");
  });
  it("occupation inclut l'interne : avril (16 fact + 4 internes) / 20 = 100 %", () => {
    const apr = r.series.find((s) => s.month === "2026-04");
    expect(apr.occupancyPct).toBe(100);
  });
  it("aucun CRA → série pleine de vides, résumé neutre (pas de crash)", () => {
    const empty = computeTaceTrend([], consultants, ["2026-01", "2026-02"]);
    expect(empty.summary.points).toBe(0);
    expect(empty.summary.latest).toBe(null);
    expect(empty.summary.slope).toBe(null);
    expect(empty.summary.direction).toBe("flat");
  });
  it("monthPoint isolé : dénominateur nul → null (pas de division par zéro)", () => {
    const p = monthPoint([{ consultantId: "x", billedDays: 0, leaveDays: 20 }]); // 20 ouvrés − 20 congés = 0
    expect(p.tacePct).toBe(null);
  });
});
