import { describe, it, expect } from "vitest";
import { parseTimesheetPaste } from "../domain/timesheetImport.js";

const map = { alice: "c1", bob: "c2" };

describe("parseTimesheetPaste (Lot 19 import CRA)", () => {
  it("parse des lignes tabulées et résout le nom → id", () => {
    const { rows, errors } = parseTimesheetPaste("Alice\t2026-01\t18\t2\t0\nBob\t2026-01\t20\t0\t0", map);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { consultantId: "c1", month: "2026-01", billedDays: 18, leaveDays: 2, internalDays: 0 },
      { consultantId: "c2", month: "2026-01", billedDays: 20, leaveDays: 0, internalDays: 0 },
    ]);
  });
  it("accepte le séparateur ; et la virgule décimale FR (la virgule n'est PAS un séparateur)", () => {
    const { rows } = parseTimesheetPaste("Alice;2026-02;17,5;0;2", map);
    expect(rows[0].billedDays).toBe(17.5);
  });
  it("ignore l'en-tête et signale les erreurs (consultant inconnu, mois invalide)", () => {
    const { rows, errors } = parseTimesheetPaste("Nom;Mois;Facturés\nCharlie;2026-01;10\nAlice;jan;10", map);
    expect(rows.length).toBe(0);
    expect(errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("consultant inconnu"),
      expect.stringContaining("mois invalide"),
    ]);
  });
  it("borne les jours à 31 et refuse les négatifs → 0", () => {
    const { rows } = parseTimesheetPaste("Alice\t2026-01\t99\t-3\tx", map);
    expect(rows[0].billedDays).toBe(31);
    expect(rows[0].leaveDays).toBe(0);
    expect(rows[0].internalDays).toBe(0);
  });
});
