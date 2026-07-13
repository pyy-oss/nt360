import { describe, it, expect } from "vitest";
const { normalizeMilestones, milestonesTotal, reportedFromMilestones, plannedInMonth, defaultMilestones, MAX_MILESTONES } = require("../domain/milestones");

describe("milestones — jalons de facturation (module pur)", () => {
  it("normalise : dates ISO, montants > 0, tri par date, plafond 15, idempotent", () => {
    const raw = [
      { date: "2026-08-15", amount: 100 },
      { date: "2026-03-01T12:00:00Z", amount: 50.4 }, // date tronquée, montant arrondi
      { date: "bad", amount: 10 },                     // date invalide → exclue
      { date: "2026-05-01", amount: 0 },               // montant nul → exclu
    ];
    const n = normalizeMilestones(raw);
    expect(n).toEqual([{ date: "2026-03-01", amount: 50 }, { date: "2026-08-15", amount: 100 }]);
    expect(normalizeMilestones(n)).toEqual(n); // idempotent
    expect(normalizeMilestones(null)).toEqual([]);
  });
  it("plafonne à 15 jalons", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, amount: 1 }));
    expect(normalizeMilestones(many)).toHaveLength(MAX_MILESTONES);
  });
  it("total = Σ des montants normalisés", () => {
    expect(milestonesTotal([{ date: "2026-01-01", amount: 300 }, { date: "2026-07-01", amount: 200 }])).toBe(500);
  });
  it("report N+1 dérivé = Σ jalons après le 31/12 de l'exercice", () => {
    const ms = [
      { date: "2026-11-30", amount: 400 }, // dans l'exercice 2026 → non reporté
      { date: "2026-12-31", amount: 100 }, // pile le 31/12 → non reporté (borne incluse dans N)
      { date: "2027-01-15", amount: 250 }, // N+1 → reporté
      { date: "2028-06-01", amount: 50 },  // N+2 → reporté aussi (après le 31/12/2026)
    ];
    expect(reportedFromMilestones(ms, 2026)).toBe(300); // 250 + 50
  });
  it("report borné au RAF projetable (sûreté dérive)", () => {
    const ms = [{ date: "2027-02-01", amount: 999 }];
    expect(reportedFromMilestones(ms, 2026, 300)).toBe(300); // plafonné
    expect(reportedFromMilestones(ms, 2026, 0)).toBe(0);
  });
  it("planifié par mois (tendance)", () => {
    const ms = [{ date: "2026-07-05", amount: 100 }, { date: "2026-07-20", amount: 50 }, { date: "2026-08-01", amount: 30 }];
    expect(plannedInMonth(ms, "2026-07")).toBe(150);
    expect(plannedInMonth(ms, "2026-08")).toBe(30);
    expect(plannedInMonth(ms, "2026-09")).toBe(0);
  });
});

describe("defaultMilestones — échéancier auto-généré (repli sans jalons saisis)", () => {
  const ms = (ym) => Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 15); // epoch ms au 15 du mois

  it("date de clôture réelle À VENIR dans l'exercice → UN seul jalon sur ce mois (tout le RAF)", () => {
    const d = defaultMilestones(300, "2026-07-15", 2026, { closeMs: ms("2026-10") });
    expect(d).toEqual([{ date: "2026-10-28", amount: 300 }]);
    expect(reportedFromMilestones(d, 2026)).toBe(0);
  });
  it("date de clôture PASSÉE → repli : courbe pondérée croissante du mois courant au 31/12 (pas de plateau)", () => {
    const d = defaultMilestones(300, "2026-07-15", 2026, { closeMs: ms("2026-03") });
    expect(d.map((m) => m.date)).toEqual(["2026-07-28", "2026-08-28", "2026-09-28", "2026-10-28", "2026-11-28", "2026-12-28"]);
    const amts = d.map((m) => m.amount);
    expect(amts[0]).toBeLessThan(amts[amts.length - 1]);       // croissant → décembre le plus fourni
    expect(new Set(amts).size).toBeGreaterThan(1);             // pas de plateau uniforme
    expect(milestonesTotal(d)).toBe(300);
  });
  it("aucune date → repli croissant, juillet non nul, sans trou sept/nov", () => {
    const d = defaultMilestones(300, "2026-07-15", 2026);
    expect(d.map((m) => m.date.slice(0, 7))).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(d[0].amount).toBeGreaterThan(0);                    // juillet (mois courant) non nul
    expect(milestonesTotal(d)).toBe(300);
    expect(reportedFromMilestones(d, 2026)).toBe(0);
  });
  it("date de clôture d'un AUTRE exercice → ignorée, repli in-year", () => {
    const d = defaultMilestones(300, "2026-07-15", 2026, { closeMs: ms("2027-02") });
    expect(d.every((m) => m.date.slice(0, 4) === "2026")).toBe(true);
    expect(milestonesTotal(d)).toBe(300);
  });
  it("Σ des jalons = montant exact (reliquat d'arrondi sur décembre)", () => {
    expect(milestonesTotal(defaultMilestones(100, "2026-07-15", 2026))).toBe(100);
    expect(milestonesTotal(defaultMilestones(1001, "2026-07-15", 2026))).toBe(1001);
  });
  it("déterministe : même entrée → même échéancier (cohérence des recalculs)", () => {
    expect(defaultMilestones(500, "2026-04-01", 2026)).toEqual(defaultMilestones(500, "2026-04-01", 2026));
    expect(defaultMilestones(500, "2026-04-01", 2026, { closeMs: ms("2026-09") })).toEqual(defaultMilestones(500, "2026-04-01", 2026, { closeMs: ms("2026-09") }));
  });
  it("montant nul ou négatif → aucun jalon", () => {
    expect(defaultMilestones(0, "2026-07-15", 2026)).toEqual([]);
    expect(defaultMilestones(-10, "2026-07-15", 2026)).toEqual([]);
  });
  it("asOf en décembre → repli sur le 31/12 (aucun mois futur dans l'exercice)", () => {
    const d = defaultMilestones(300, "2026-12-10", 2026);
    expect(d.every((m) => m.date.slice(0, 7) === "2026-12")).toBe(true);
    expect(milestonesTotal(d)).toBe(300);
  });
  it("asOf avant l'exercice → étalé sur toute l'année cible (mois courant = janvier)", () => {
    const d = defaultMilestones(1200, "2025-11-01", 2026);
    expect(d).toHaveLength(12);
    expect(d[0].date).toBe("2026-01-28");
    expect(d[11].date).toBe("2026-12-28");
    expect(milestonesTotal(d)).toBe(1200);
  });
});
