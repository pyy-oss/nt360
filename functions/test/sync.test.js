import { describe, it, expect } from "vitest";
const { planSalesSync } = require("../lib/sync");

describe("planSalesSync — remplace le lot salesData, préserve les saisies (§11)", () => {
  it("upsert les nouvelles, supprime les disparues", () => {
    const existing = ["a", "b", "c"]; // IDs source=salesData déjà en base
    const newRows = [{ _id: "b" }, { _id: "d" }];
    const { toUpsert, toDelete } = planSalesSync(existing, newRows);
    expect(toUpsert.map((r) => r._id)).toEqual(["b", "d"]);
    expect(toDelete.sort()).toEqual(["a", "c"]); // b conservé, d ajouté, a/c supprimés
  });
  it("ne supprime rien si tout est présent", () => {
    expect(planSalesSync(["x"], [{ _id: "x" }, { _id: "y" }]).toDelete).toEqual([]);
  });
  it("les saisies ne sont jamais concernées (existing = salesData uniquement)", () => {
    // Par construction, applySalesSync ne lit que source=='salesData' ; ici on vérifie
    // qu'un ID de saisie non fourni dans existing n'apparaît pas dans toDelete.
    expect(planSalesSync([], [{ _id: "n1" }]).toDelete).toEqual([]);
  });
});
