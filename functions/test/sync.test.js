import { describe, it, expect } from "vitest";
const { planSalesSync } = require("../lib/sync");

describe("planSalesSync — remplace le lot salesData, marque les fantômes, préserve les saisies (§11)", () => {
  it("upsert les présentes, marque FANTÔMES (non supprimées) les disparues", () => {
    const existing = ["a", "b", "c"]; // IDs source=salesData déjà en base
    const newRows = [{ _id: "b" }, { _id: "d" }];
    const { toUpsert, toStale } = planSalesSync(existing, newRows);
    expect(toUpsert.map((r) => r._id)).toEqual(["b", "d"]);
    expect(toStale.sort()).toEqual(["a", "c"]); // b conservé, d ajouté, a/c → fantômes (stale)
  });
  it("ne marque rien si tout est présent", () => {
    expect(planSalesSync(["x"], [{ _id: "x" }, { _id: "y" }]).toStale).toEqual([]);
  });
  it("les saisies ne sont jamais concernées (existing = salesData uniquement)", () => {
    // applySalesSync ne lit que source=='salesData' ; un ID de saisie non fourni n'apparaît pas dans toStale.
    expect(planSalesSync([], [{ _id: "n1" }]).toStale).toEqual([]);
  });
});
