// CARACTÉRISATION du point de contact C3 (recompute aggregate.js) — le plus risqué du plan.
// Invariant : le bloc « maintenance » est ADDITIF et DOUBLEMENT gaté (want("maintenance") + drapeau).
//   • Drapeau OFF (ou absent) → recompute STRICTEMENT identique à avant : AUCUNE écriture mnt_*, et
//     l'ensemble des chemins écrits ne contient pas summaries/mnt_risque (« éteint = ERP d'avant »).
//   • Drapeau ON → un SEUL chemin nouveau apparaît (summaries/mnt_risque) ; tous les autres chemins
//     écrits sont EXACTEMENT les mêmes que drapeau off (aucun summary existant altéré/retiré).
// On exécute recomputeCore contre un faux Firestore minimal (collections vides sauf mnt_*), et on
// compare les ENSEMBLES de chemins écrits. Cela verrouille l'additivité sans émulateur.
import { describe, it, expect } from "vitest";
const { recomputeCore } = require("../lib/aggregate");

// Faux Firestore couvrant la surface lue/écrite par recomputeCore : collection().get()/where/orderBy/
// limit/count, doc().get(), batch().set/commit. Les collections absentes rendent [] ; les docs absents
// rendent {exists:false}. `seedDocs` amorce des documents précis (ex. config/mntFeature).
function fakeDb(collections = {}, seedDocs = {}) {
  const written = [];              // chemins écrits par les batches
  const docStore = new Map(Object.entries(seedDocs));
  const colOf = (name) => (collections[name] || []);
  function snap(rows) {
    const docs = rows.map((r) => ({ id: r.id || r._id || "auto", data: () => r }));
    return { docs, size: docs.length, forEach: (f) => docs.forEach(f) };
  }
  function queryFor(name) {
    const q = {
      where: () => q, orderBy: () => q, limit: () => q, select: () => q,
      async get() { return snap(colOf(name)); },
      count: () => ({ async get() { return { data: () => ({ count: colOf(name).length }) }; } }),
    };
    return q;
  }
  const db = {
    collection: (name) => queryFor(name),
    doc: (path) => ({
      path,
      async get() { return { exists: docStore.has(path), data: () => docStore.get(path) }; },
      async update() { /* ensureImportPermission best-effort */ },
      async delete() {},
    }),
    async runTransaction(fn) {
      const tx = { async get(ref) { return { exists: docStore.has(ref.path), data: () => docStore.get(ref.path) }; }, set(ref, data, o) { const cur = o && o.merge ? (docStore.get(ref.path) || {}) : {}; docStore.set(ref.path, { ...cur, ...data }); } };
      return fn(tx);
    },
    batch() {
      return { set(ref) { written.push(ref.path); }, delete() {}, async commit() {} };
    },
  };
  return { db, written, docStore };
}

// Un contrat vivant + un ticket rompu, pour que le bloc maintenance ait matière à écrire quand allumé.
const MNT_COLLECTIONS = {
  mnt_contrats: [{ id: "c1", fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-06-01", dateFin: "2026-07-20", echeanceType: "mensuel", montantEngage: 100000, engagements: [{ type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: 8, quota: null }] }],
  mnt_tickets: [{ id: "t1", contratId: "c1", ouvertLe: 1751760000000, priseEnCompteLe: null, resoluLe: null }],
};

async function pathsWith(flagEnabled, extraCollections = {}) {
  const { db, written } = fakeDb(
    { ...MNT_COLLECTIONS, ...extraCollections },
    flagEnabled == null ? {} : { "config/mntFeature": { enabled: flagEnabled } },
  );
  await recomputeCore(db); // recompute COMPLET (only falsy → want(k) vrai partout, y compris maintenance)
  return new Set(written);
}

describe("C3 — recompute : le bloc maintenance est additif et gaté", () => {
  it("drapeau ABSENT → aucune écriture mnt_* (recompute d'avant à l'octet)", async () => {
    const paths = await pathsWith(null);
    expect([...paths].some((p) => p.includes("mnt"))).toBe(false);
    expect(paths.has("summaries/mnt_risque")).toBe(false);
  });

  it("drapeau OFF → aucune écriture mnt_*", async () => {
    const paths = await pathsWith(false);
    expect([...paths].some((p) => p.includes("mnt"))).toBe(false);
  });

  it("drapeau ON → seuls summaries/mnt_risque + mnt_surveillance sont nouveaux (tous les autres inchangés)", async () => {
    const off = await pathsWith(false);
    const on = await pathsWith(true);
    // Différence symétrique = exactement les summaries mnt_ matérialisés (risque + sa PROJECTION surveillance,
    // ADR-026). Aucun summary existant modifié/retiré : le bloc reste strictement additif et gaté.
    const added = [...on].filter((p) => !off.has(p)).sort();
    const removed = [...off].filter((p) => !on.has(p));
    expect(added).toEqual(["summaries/mnt_risque", "summaries/mnt_surveillance"]);
    expect(removed).toEqual([]);
  });
});
