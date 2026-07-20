import { describe, it, expect } from "vitest";
import { mntCalendar, slaCalendar, isPlausibleDay } from "./mntCalendar";

// Miroir FRONT de functions/domain/mntCalendar.js — mêmes attentes (parité de normalisation).
describe("mntCalendar (front, miroir) — normalisation de l'overlay", () => {
  it("document absent : calendrier neutre (UTC, aucun férié, 8–18)", () => {
    expect(mntCalendar(null)).toEqual({ offMin: 0, pays: null, holidays: [], b2b: { start: 8, end: 18 } });
  });
  it("fuseau borné [-720..+840] ; fériés filtrés/dédupliqués/triés ; B2B validée", () => {
    expect(mntCalendar({ tzOffsetMinutes: 5000 }).offMin).toBe(840);
    expect(mntCalendar({ tzOffsetMinutes: -5000 }).offMin).toBe(-720);
    expect(mntCalendar({ holidays: ["2026-05-01", "2026-01-01", "2026-05-01", "x", "1800-01-01"] }).holidays).toEqual(["2026-01-01", "2026-05-01"]);
    expect(mntCalendar({ b2b: { start: 18, end: 8 } }).b2b).toEqual({ start: 8, end: 18 });
    expect(mntCalendar({ b2b: { start: 9, end: 17 } }).b2b).toEqual({ start: 9, end: 17 });
  });
  it("slaCalendar : fériés en Set", () => {
    const c = slaCalendar({ holidays: ["2026-01-01"] });
    expect(c.holidays instanceof Set).toBe(true);
    expect((c.holidays as Set<string>).has("2026-01-01")).toBe(true);
  });
  it("isPlausibleDay : borne 2000..2100, format strict", () => {
    expect(isPlausibleDay("2026-07-14")).toBe(true);
    expect(isPlausibleDay("1999-12-31")).toBe(false);
    expect(isPlausibleDay("2026-7-4")).toBe(false);
  });
});
