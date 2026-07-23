import { describe, it, expect } from "vitest";
const { mntCalendar, slaCalendar, isPlausibleDay } = require("../domain/mntCalendar");

describe("mntCalendar (ADR-P23) — normalisation de l'overlay", () => {
  it("document absent : calendrier neutre (UTC, aucun férié, fenêtre 8–18)", () => {
    const c = mntCalendar(null);
    expect(c.offMin).toBe(0);
    expect(c.holidays).toEqual([]);
    expect(c.b2b).toEqual({ start: 8, end: 18 });
  });
  it("fuseau borné [-720..+840] minutes ; valeur hors bornes/illisible → 0", () => {
    expect(mntCalendar({ tzOffsetMinutes: 60 }).offMin).toBe(60);
    expect(mntCalendar({ tzOffsetMinutes: 5000 }).offMin).toBe(840);   // +14h max
    expect(mntCalendar({ tzOffsetMinutes: -5000 }).offMin).toBe(-720); // -12h min
    expect(mntCalendar({ tzOffsetMinutes: "x" }).offMin).toBe(0);
  });
  it("fériés : filtre les dates aberrantes, déduplique et trie", () => {
    const c = mntCalendar({ holidays: ["2026-05-01", "2026-01-01", "2026-05-01", "pas-une-date", "1800-01-01"] });
    expect(c.holidays).toEqual(["2026-01-01", "2026-05-01"]);
  });
  it("fenêtre B2B : rejette start≥end ou hors [0..24] → défaut 8–18", () => {
    expect(mntCalendar({ b2b: { start: 9, end: 17 } }).b2b).toEqual({ start: 9, end: 17 });
    expect(mntCalendar({ b2b: { start: 18, end: 8 } }).b2b).toEqual({ start: 8, end: 18 }); // inversé → défaut
    expect(mntCalendar({ b2b: { start: -1, end: 30 } }).b2b).toEqual({ start: 8, end: 18 }); // hors bornes → défaut
  });
  it("slaCalendar : fériés en Set pour le moteur SLA", () => {
    const c = slaCalendar({ holidays: ["2026-01-01"], tzOffsetMinutes: 0 });
    expect(c.holidays instanceof Set).toBe(true);
    expect(c.holidays.has("2026-01-01")).toBe(true);
  });
  it("isPlausibleDay : borne d'année 2000..2100", () => {
    expect(isPlausibleDay("2026-07-14")).toBe(true);
    expect(isPlausibleDay("1999-12-31")).toBe(false);
    expect(isPlausibleDay("2026-7-4")).toBe(false); // format strict
  });
});
