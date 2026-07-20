import { describe, it, expect } from "vitest";
const { sanitizeForFirestore, coerceNums } = require("../lib/aggregate");
const { purgePlan } = require("../handlers/sanitize");
const { FieldValue } = require("firebase-admin/firestore");

describe("purgePlan — plan de purge (table rase, ADR-053)", () => {
  it("P&L seul → orders + chunks + overlays P&L + approbations de commandes (filtré)", () => {
    const p = purgePlan(["orders"]);
    expect(p.targets).toEqual(["orders"]);
    expect(p.collections).toEqual(["orders", "commandesRows", "billingMilestones"]);
    expect(p.configDocs).toContain("config/cancelOrders");
    expect(p.configDocs).toContain("config/orderCasOverride");
    expect(p.configDocs).toContain("config/fpAliases");
    // approbations de commandes uniquement ; PAS d'activités (elles ne concernent pas les commandes)
    expect(p.filtered).toEqual([{ collection: "approvals", field: "entityType", value: "order" }]);
  });
  it("Opportunités seul → opps + historique + fpAliases + activités & approbations d'opp (filtré)", () => {
    const p = purgePlan(["opportunities"]);
    expect(p.collections).toEqual(["opportunities", "oppHistory", "oppDateHistory"]);
    expect(p.configDocs).toEqual(["config/fpAliases"]);
    expect(p.filtered).toEqual([
      { collection: "activities", field: "relatedType", value: "opportunity" },
      { collection: "approvals", field: "entityType", value: "opportunity" },
    ]);
  });
  it("les deux cibles → union, fpAliases DÉDUPLIQUÉ, filtres distincts (opp + order) conservés", () => {
    const p = purgePlan(["orders", "opportunities"]);
    expect(p.targets).toEqual(["orders", "opportunities"]);
    expect(p.configDocs.filter((c) => c === "config/fpAliases")).toHaveLength(1);
    expect(p.collections).toContain("orders");
    expect(p.collections).toContain("opportunities");
    // 3 suppressions filtrées distinctes : approvals/order + activities/opp + approvals/opp
    expect(p.filtered).toHaveLength(3);
    expect(p.filtered).toContainEqual({ collection: "approvals", field: "entityType", value: "order" });
    expect(p.filtered).toContainEqual({ collection: "activities", field: "relatedType", value: "opportunity" });
    expect(p.filtered).toContainEqual({ collection: "approvals", field: "entityType", value: "opportunity" });
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
