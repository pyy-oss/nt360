import { describe, it, expect } from "vitest";
import { DEFAULT_TARGET, validateTargets, targetFor, evaluate } from "../domain/staffingTarget.js";

describe("validateTargets (Lot 18)", () => {
  it("défauts + bornage [0,100]", () => {
    const t = validateTargets({ occupancy: 150, tace: -5, byGrade: { senior: 90, bad: 999 }, byBu: { DATA: 80 } });
    expect(t.occupancy).toBe(DEFAULT_TARGET); // 150 hors borne → défaut
    expect(t.tace).toBe(DEFAULT_TARGET);
    expect(t.byGrade).toEqual({ senior: 90 }); // 'bad' 999 rejeté
    expect(t.byBu).toEqual({ DATA: 80 });
  });
});

describe("targetFor — priorité grade > BU > global", () => {
  const t = { occupancy: 85, byGrade: { junior: 70 }, byBu: { DATA: 80 } };
  it("grade prioritaire", () => { expect(targetFor(t, { grade: "junior", bu: "DATA" })).toBe(70); });
  it("BU si pas de grade", () => { expect(targetFor(t, { bu: "DATA" })).toBe(80); });
  it("global sinon", () => { expect(targetFor(t, { grade: "senior", bu: "CLOUD" })).toBe(85); });
});

describe("evaluate — dérive vs objectif", () => {
  it("marque les ressources sous l'objectif et compte la dérive", () => {
    const rows = [
      { id: "c1", grade: "senior", bu: "DATA", occupancyPct: 90 },
      { id: "c2", grade: "junior", bu: "DATA", occupancyPct: 60 },
    ];
    const t = { occupancy: 85, byGrade: { junior: 70 } };
    const r = evaluate(rows, t);
    expect(r.rows[0].isBelow).toBe(false); // 90 ≥ 85
    expect(r.rows[1].isBelow).toBe(true);  // 60 < 70 (cible junior)
    expect(r.rows[1].belowBy).toBe(10);
    expect(r.belowCount).toBe(1);
  });
});
