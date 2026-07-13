import { describe, it, expect } from "vitest";
import { aggregateTime } from "../domain/clickupTime.js";

// 2026-01-15 UTC ≈ 1768435200000 ms ; 8h = 28800000 ms = 1 jour.
const JAN = Date.UTC(2026, 0, 15);
const FEB = Date.UTC(2026, 1, 10);
const DAY = 8 * 3600 * 1000;
const u2c = { "111": "c1", "222": "c2" };
const months = new Set(["2026-01", "2026-02"]);

describe("aggregateTime (Lot 20 auto-CRA)", () => {
  it("cumule le temps par consultant × mois et convertit ms → jours (8h)", () => {
    const entries = [
      { user: { id: 111 }, start: JAN, duration: DAY },          // c1 jan : 1 j
      { user: { id: 111 }, start: JAN + 3600000, duration: DAY }, // c1 jan : +1 j = 2 j
      { user: { id: 222 }, start: FEB, duration: DAY / 2 },       // c2 fév : 0.5 j
    ];
    const rows = aggregateTime(entries, u2c, months);
    expect(rows).toEqual([
      { consultantId: "c1", month: "2026-01", billedDays: 2 },
      { consultantId: "c2", month: "2026-02", billedDays: 0.5 },
    ]);
  });
  it("ignore les utilisateurs non mappés, durées nulles et mois hors plage", () => {
    const entries = [
      { user: { id: 999 }, start: JAN, duration: DAY },                    // non mappé
      { user: { id: 111 }, start: JAN, duration: 0 },                      // durée nulle
      { user: { id: 111 }, start: Date.UTC(2025, 11, 1), duration: DAY },  // hors plage
    ];
    expect(aggregateTime(entries, u2c, months)).toEqual([]);
  });
  it("arrondit au demi-jour", () => {
    const rows = aggregateTime([{ user: { id: 111 }, start: JAN, duration: DAY * 0.4 }], u2c, months);
    expect(rows[0].billedDays).toBe(0.5); // 0.4 j → arrondi 0.5
  });
});
