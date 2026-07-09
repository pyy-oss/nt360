import { describe, it, expect } from "vitest";
import { availableDays, avgTjm, demandDaysOf, capacityVsPipeline } from "../domain/capacity.js";

const months = ["2026-01", "2026-02"]; // 2 mois × 20 j = 40 j ouvrés / consultant

describe("capacity helpers (Lot 14)", () => {
  it("availableDays = (1 − occupation) × jours ouvrés", () => {
    const load = { c1: { "2026-01": 50, "2026-02": 100 } };
    // mois1: 50% libre → 10j ; mois2: 0% libre → 0j → 10
    expect(availableDays("c1", load, months)).toBe(10);
    expect(availableDays("inconnu", {}, months)).toBe(40); // aucune charge → 100% dispo
  });
  it("avgTjm moyenne des TJM renseignés, sinon fallback", () => {
    expect(avgTjm([{ tjmTarget: 600 }, { tjmTarget: 800 }])).toBe(700);
    expect(avgTjm([{}, { tjmTarget: 0 }], 500)).toBe(500);
  });
  it("demandDaysOf : montant pondéré ÷ TJM", () => {
    expect(demandDaysOf({ weighted: 7000 }, 700)).toBe(10);
    expect(demandDaysOf({ amount: 14000, probability: 0.5 }, 700)).toBe(10); // pas de weighted → amount×proba
  });
});

describe("capacityVsPipeline — gap & ETP", () => {
  const consultants = [
    { id: "c1", bu: "DATA", status: "active", tjmTarget: 700 },
    { id: "c2", bu: "DATA", status: "active", tjmTarget: 700 },
    { id: "c3", bu: "CLOUD", status: "inactive", tjmTarget: 700 }, // ignoré (non actif)
  ];
  const loadByConsultant = { c1: { "2026-01": 100, "2026-02": 100 } }; // c1 plein, c2 libre
  it("capacité = actifs disponibles, demande = pipeline pondéré, gap = diff", () => {
    const opps = [{ bu: "DATA", weighted: 14000 }]; // 14000/700 = 20 j de demande
    const r = capacityVsPipeline({ consultants, loadByConsultant, months, opps });
    // capacité : c1 0j (plein) + c2 40j = 40 ; demande 20 → gap +20
    expect(r.capacityDays).toBe(40);
    expect(r.demandDays).toBe(20);
    expect(r.gapDays).toBe(20);
    expect(r.byBu.find((b) => b.bu === "DATA").gapDays).toBe(20);
  });
  it("sous-capacité → gap négatif (besoin de recrutement)", () => {
    const opps = [{ bu: "DATA", weighted: 70000 }]; // 100 j de demande > 40 capacité
    const r = capacityVsPipeline({ consultants, loadByConsultant, months, opps });
    expect(r.gapDays).toBeLessThan(0);
    expect(r.fteGap).toBeLessThan(0);
  });
});
