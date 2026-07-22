import { describe, it, expect } from "vitest";
import { pipeExpectedMargin } from "./pipeMargin";

// MARGE ATTENDUE DU PIPE (Lot B, cockpit DC/DG) — prouve : (1) marge = Σ pondéré × mbPrev% ;
// (2) taux moyen PONDÉRÉ (pas moyenne simple des taux) ; (3) ventilation par BU triée par marge ;
// (4) mbPrev absent = 0 % (aucune marge inventée), ce qui dilue le taux moyen.
describe("pipeExpectedMargin — marge attendue du pipe", () => {
  it("marge = Σ (pondéré × mbPrev %) et taux moyen pondéré", () => {
    const r = pipeExpectedMargin([
      { weighted: 1000, mbPrev: 20, bu: "ICT" }, // 200
      { weighted: 500, mbPrev: 40, bu: "ICT" },  // 200
    ]);
    expect(r.weighted).toBe(1500);
    expect(r.margin).toBe(400);
    expect(r.marginRate).toBeCloseTo(400 / 1500, 6); // ≈ 26,7 % — PAS la moyenne simple (30 %)
  });

  it("mbPrev absent → 0 % (aucune marge inventée) et dilue le taux moyen", () => {
    const r = pipeExpectedMargin([
      { weighted: 1000, mbPrev: 30, bu: "ICT" }, // 300
      { weighted: 1000, bu: "ENERGIE" },         // mbPrev absent → 0
    ]);
    expect(r.margin).toBe(300);
    expect(r.marginRate).toBeCloseTo(300 / 2000, 6); // 15 % — le pipe sans MB tire le taux vers le bas
  });

  it("ventile par BU, trié par marge décroissante ; BU absente → AUTRE", () => {
    const r = pipeExpectedMargin([
      { weighted: 1000, mbPrev: 10, bu: "ICT" },     // 100
      { weighted: 1000, mbPrev: 50, bu: "ENERGIE" }, // 500
      { weighted: 200, mbPrev: 25 },                 // 50 → AUTRE
    ]);
    expect(r.byBu.map((b) => b.bu)).toEqual(["ENERGIE", "ICT", "AUTRE"]);
    expect(r.byBu[0]).toMatchObject({ bu: "ENERGIE", margin: 500 });
    expect(r.byBu[0].marginRate).toBeCloseTo(0.5, 6);
  });

  it("liste vide → zéros, aucune division par zéro", () => {
    expect(pipeExpectedMargin([])).toEqual({ weighted: 0, margin: 0, marginRate: 0, byBu: [] });
  });
});
