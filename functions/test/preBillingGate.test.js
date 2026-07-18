// DO Lot 4 — le bloc « pré-facturation » d'aggregate.js est ADDITIF et gaté want("prebilling").
//   • recompute COMPLET → summaries/preBilling est matérialisé (jours facturés CRA × TJM, Lot 21) ;
//   • recompute CIBLÉ ne le demandant pas (ex. only=['suppliers']) → il n'est PAS réécrit (jamais à vide).
// Faux Firestore minimal (même surface que mntRecomputeGate) : collection().get()/where/select/limit,
// doc().get(), batch().set. On compare les ENSEMBLES de chemins écrits — additivité verrouillée sans émulateur.
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

// Un CRA avec des jours facturés le mois courant + un consultant à TJM cible → matière à pré-facturer.
const nowYm = new Date().toISOString().slice(0, 7);
const COLLECTIONS = {
  timesheets: [{ id: "u1_" + nowYm, consultantId: "u1", month: nowYm, billedDays: 10, source: "manual" }],
  consultants: [{ id: "u1", name: "Awa", bu: "Cyber", tjmTarget: 200000 }],
  assignments: [],
};

describe("DO Lot 4 — recompute : bloc pré-facturation additif et gaté", () => {
  it("recompute complet → summaries/preBilling matérialisé", async () => {
    const { db, written } = fakeDb(COLLECTIONS);
    await recomputeCore(db); // only falsy → want('prebilling') vrai
    expect(new Set(written).has("summaries/preBilling")).toBe(true);
  });

  it("recompute ciblé ne demandant pas la pré-facturation → summaries/preBilling non réécrit", async () => {
    const { db, written } = fakeDb(COLLECTIONS);
    await recomputeCore(db, ["suppliers"]); // only=['suppliers'] → want('prebilling') faux
    expect(new Set(written).has("summaries/preBilling")).toBe(false);
  });
});
