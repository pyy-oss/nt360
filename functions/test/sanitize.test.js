import { describe, it, expect } from "vitest";
const { sanitizeForFirestore, coerceNums } = require("../lib/aggregate");
const { purgePlan } = require("../handlers/sanitize");
const { FieldValue } = require("firebase-admin/firestore");

describe("purgePlan — plan de purge (table rase, ADR-053)", () => {
  it("P&L seul → orders + chunks + overlays P&L", () => {
    const p = purgePlan(["orders"]);
    expect(p.targets).toEqual(["orders"]);
    expect(p.collections).toEqual(["orders", "commandesRows", "billingMilestones"]);
    expect(p.configDocs).toContain("config/cancelOrders");
    expect(p.configDocs).toContain("config/orderCasOverride");
    expect(p.configDocs).toContain("config/fpAliases");
  });
  it("Opportunités seul → opps + historique d'étapes + fpAliases", () => {
    const p = purgePlan(["opportunities"]);
    expect(p.collections).toEqual(["opportunities", "oppHistory", "oppDateHistory"]);
    expect(p.configDocs).toEqual(["config/fpAliases"]);
  });
  it("les deux cibles → union, fpAliases (partagé) DÉDUPLIQUÉ une seule fois", () => {
    const p = purgePlan(["orders", "opportunities"]);
    expect(p.targets).toEqual(["orders", "opportunities"]);
    expect(p.configDocs.filter((c) => c === "config/fpAliases")).toHaveLength(1);
    expect(p.collections).toContain("orders");
    expect(p.collections).toContain("opportunities");
  });
  it("cibles invalides/inconnues ignorées ; doublons compactés ; entrée vide → plan vide", () => {
    expect(purgePlan(["invoices", "bidon"]).targets).toEqual([]);
    expect(purgePlan(["orders", "orders"]).targets).toEqual(["orders"]);
    expect(purgePlan(null).targets).toEqual([]);
    expect(purgePlan(undefined).collections).toEqual([]);
  });
});

describe("sanitizeForFirestore — garde-fou écriture (NaN/Infinity/undefined refusés en prod)", () => {
  it("remplace NaN et ±Infinity par 0", () => {
    expect(sanitizeForFirestore(NaN)).toBe(0);
    expect(sanitizeForFirestore(Infinity)).toBe(0);
    expect(sanitizeForFirestore(-Infinity)).toBe(0);
    expect(sanitizeForFirestore(42)).toBe(42);
  });
  it("nettoie récursivement objets & tableaux, retire les undefined", () => {
    const out = sanitizeForFirestore({ a: NaN, b: [1, Infinity, { c: NaN }], d: undefined, e: "x", f: null });
    expect(out).toEqual({ a: 0, b: [1, 0, { c: 0 }], e: "x", f: null });
    expect("d" in out).toBe(false); // undefined retiré
  });
  it("préserve les sentinelles FieldValue (serverTimestamp/delete) intactes", () => {
    const ts = FieldValue.serverTimestamp();
    const del = FieldValue.delete();
    const out = sanitizeForFirestore({ updatedAt: ts, rows: del, val: NaN });
    expect(out.updatedAt).toBe(ts);
    expect(out.rows).toBe(del);
    expect(out.val).toBe(0);
  });
});

describe("coerceNums — montants en chaîne des imports bruts → nombres", () => {
  it("convertit « 1 000 000 » / « (1 000) » / « 12,5 » et neutralise les non finis", () => {
    const rows = [{ amountHt: "1 000 000" }, { amountHt: "(1 000)" }, { amountHt: "12,5" }, { amountHt: NaN }, { amountHt: 500 }];
    coerceNums(rows, ["amountHt"]);
    expect(rows[0].amountHt).toBe(1000000);
    expect(rows[1].amountHt).toBe(-1000);
    expect(rows[2].amountHt).toBe(12.5);
    expect(rows[3].amountHt).toBe(0);
    expect(rows[4].amountHt).toBe(500);
  });
  it("laisse les champs ABSENTS absents (ne change pas la sémantique d'un != null)", () => {
    const rows = [{ other: 1 }];
    coerceNums(rows, ["amountHt"]);
    expect("amountHt" in rows[0]).toBe(false);
  });
});
