// DO Lot 4b — le bloc « reconnaissance » d'aggregate.js est ADDITIF et gaté want("recognition").
//   • recompute COMPLET → summaries/recognition matérialisé (FAE/PCA par affaire) ;
//   • recompute CIBLÉ ne le demandant pas (ex. only=['suppliers']) → il n'est PAS réécrit (jamais à vide).
// Faux Firestore minimal (même surface que preBillingGate) : on compare les ENSEMBLES de chemins écrits.
import { describe, it, expect } from "vitest";
const { recomputeCore } = require("../lib/aggregate");

function fakeDb(collections = {}, seedDocs = {}) {
  const written = [];
  const docStore = new Map(Object.entries(seedDocs));
  const colOf = (name) => (collections[name] || []);
  const snap = (rows) => { const docs = rows.map((r) => ({ id: r.id || "auto", data: () => r })); return { docs, size: docs.length, forEach: (f) => docs.forEach(f) }; };
  const queryFor = (name) => { const q = { where: () => q, orderBy: () => q, limit: () => q, select: () => q, async get() { return snap(colOf(name)); }, count: () => ({ async get() { return { data: () => ({ count: colOf(name).length }) }; } }) }; return q; };
  const db = {
    collection: (name) => queryFor(name),
    doc: (path) => ({ path, async get() { return { exists: docStore.has(path), data: () => docStore.get(path) }; }, async update() {}, async delete() {} }),
    async runTransaction(fn) { const tx = { async get(ref) { return { exists: docStore.has(ref.path), data: () => docStore.get(ref.path) }; }, set(ref, data, o) { const cur = o && o.merge ? (docStore.get(ref.path) || {}) : {}; docStore.set(ref.path, { ...cur, ...data }); } }; return fn(tx); },
    batch() { return { set(ref) { written.push(ref.path); }, delete() {}, async commit() {} }; },
  };
  return { db, written };
}

describe("DO Lot 4b — recompute : bloc reconnaissance additif et gaté", () => {
  it("recompute complet → summaries/recognition matérialisé", async () => {
    const { db, written } = fakeDb();
    await recomputeCore(db); // only falsy → want('recognition') vrai
    expect(new Set(written).has("summaries/recognition")).toBe(true);
  });

  it("recompute ciblé ne demandant pas la reconnaissance → summaries/recognition non réécrit", async () => {
    const { db, written } = fakeDb();
    await recomputeCore(db, ["suppliers"]); // only=['suppliers'] → want('recognition') faux
    expect(new Set(written).has("summaries/recognition")).toBe(false);
  });
});
