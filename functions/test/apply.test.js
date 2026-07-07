import { describe, it, expect } from "vitest";
const { applyWrites } = require("../lib/apply");

// Faux Firestore minimal : un store `bcLines/{id} → data`, avec upsert (merge), delete et
// requête `collection("bcLines").where("fp","==",v)`. Suffit à exercer le balayage anti-orphelins.
function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed)); // path -> data
  const mk = () => {
    const ops = [];
    return {
      set(ref, data) { ops.push(["set", ref.path, data]); },
      delete(ref) { ops.push(["delete", ref.path]); },
      async commit() {
        for (const [op, path, data] of ops) {
          if (op === "set") store.set(path, { ...(store.get(path) || {}), ...data });
          else store.delete(path);
        }
        ops.length = 0;
      },
    };
  };
  return {
    store,
    batch: mk,
    doc: (path) => ({ path }),
    collection: (col) => ({
      where: (field, _op, value) => ({
        async get() {
          const docs = [];
          for (const [path, data] of store) {
            if (!path.startsWith(col + "/")) continue;
            if (data[field] !== value) continue;
            docs.push({ id: path.slice(col.length + 1), ref: { path }, get: (f) => data[f] });
          }
          return { docs };
        },
      }),
    }),
  };
}
const w = (id, data) => ({ path: `bcLines/${id}`, data });

describe("applyWrites — balayage anti-orphelins par (source, fp)", () => {
  it("ré-import fiche AVEC MOINS de lignes → l'ancienne ligne de fin est supprimée", async () => {
    const db = fakeDb({
      "bcLines/FP_2026_1_0": { fp: "FP/2026/1", source: "fiche", amount: 100 },
      "bcLines/FP_2026_1_1": { fp: "FP/2026/1", source: "fiche", amount: 50 }, // disparaît du nouvel export
    });
    await applyWrites(db, [w("FP_2026_1_0", { fp: "FP/2026/1", source: "fiche", amount: 120 })]);
    expect(db.store.has("bcLines/FP_2026_1_0")).toBe(true);
    expect(db.store.has("bcLines/FP_2026_1_1")).toBe(false); // orphelin nettoyé
  });

  it("ré-import LOGISTICS avec moins de lignes → l'orphelin logistics est nettoyé (cf. audit)", async () => {
    const db = fakeDb({
      "bcLines/bc_a": { fp: "FP/2026/2", source: "logistics", amount: 300 },
      "bcLines/bc_b": { fp: "FP/2026/2", source: "logistics", amount: 200 }, // ligne PO retirée
    });
    await applyWrites(db, [w("bc_a", { fp: "FP/2026/2", source: "logistics", amount: 300 })]);
    expect(db.store.has("bcLines/bc_a")).toBe(true);
    expect(db.store.has("bcLines/bc_b")).toBe(false);
  });

  it("CLOISONNEMENT : un import fiche pour un FP NE supprime PAS les lignes logistics du même FP", async () => {
    const db = fakeDb({
      "bcLines/FP_2026_3_0": { fp: "FP/2026/3", source: "fiche", amount: 100 },
      "bcLines/bc_log": { fp: "FP/2026/3", source: "logistics", amount: 400 }, // absent du lot fiche
    });
    await applyWrites(db, [w("FP_2026_3_0", { fp: "FP/2026/3", source: "fiche", amount: 100 })]);
    expect(db.store.has("bcLines/bc_log")).toBe(true); // la source logistics n'est pas dans le lot → intacte
  });

  it("les lignes unitaires/manuelles/clickup ne sont JAMAIS balayées", async () => {
    const db = fakeDb({
      "bcLines/man_1": { fp: "FP/2026/4", source: "unitaire", amount: 90 },
      "bcLines/cu_1": { fp: "FP/2026/4", source: "clickup", amount: 70 },
    });
    // un import fiche du même FP ne doit rien supprimer côté saisies unitaires
    await applyWrites(db, [w("FP_2026_4_0", { fp: "FP/2026/4", source: "fiche", amount: 100 })]);
    expect(db.store.has("bcLines/man_1")).toBe(true);
    expect(db.store.has("bcLines/cu_1")).toBe(true);
  });

  it("fail-safe : une fiche qui ne produit AUCUNE ligne pour un FP ne supprime rien", async () => {
    const db = fakeDb({
      "bcLines/FP_2026_5_0": { fp: "FP/2026/5", source: "fiche", amount: 100 },
    });
    await applyWrites(db, []); // rien à écrire → keepBySrcFp vide → aucune suppression
    expect(db.store.has("bcLines/FP_2026_5_0")).toBe(true);
  });
});

describe("applyWrites — marquage NON-DESTRUCTIF des opportunités fantômes (audit intégral I2)", () => {
  const opp = (id, data) => ({ path: `opportunities/${id}`, data });
  it("opp salesData ABSENTE d'un import LIVE → marquée stale (JAMAIS supprimée)", async () => {
    const db = fakeDb({
      "opportunities/o1": { source: "salesData", fp: "FP/1", stage: 3 },
      "opportunities/o2": { source: "salesData", fp: "FP/2", stage: 4 }, // retirée de LIVE
    });
    await applyWrites(db, [opp("o1", { source: "salesData", fp: "FP/1", stage: 3 })]);
    expect(db.store.has("opportunities/o2")).toBe(true);        // jamais supprimée
    expect(db.store.get("opportunities/o2").stale).toBe(true);  // fantôme marqué
    expect(db.store.get("opportunities/o1").stale).toBeFalsy(); // présente → active
  });
  it("opp fantôme qui RÉAPPARAÎT dans un import → ré-activée (stale:false) — réversible", async () => {
    const db = fakeDb({ "opportunities/o2": { source: "salesData", fp: "FP/2", stage: 4, stale: true } });
    await applyWrites(db, [opp("o2", { source: "salesData", fp: "FP/2", stage: 4 })]);
    expect(db.store.get("opportunities/o2").stale).toBe(false);
  });
  it("les opps SAISIES (source 'saisie') ne sont JAMAIS marquées", async () => {
    const db = fakeDb({
      "opportunities/m1": { source: "saisie", fp: "FP/9", stage: 2 },
      "opportunities/o1": { source: "salesData", fp: "FP/1", stage: 3 },
    });
    await applyWrites(db, [opp("o1", { source: "salesData", fp: "FP/1", stage: 3 })]);
    expect(db.store.get("opportunities/m1").stale).toBeUndefined();
  });
  it("fail-safe : un import SANS opp salesData ne marque RIEN (pas de snapshot LIVE)", async () => {
    const db = fakeDb({ "opportunities/o1": { source: "salesData", fp: "FP/1", stage: 3 } });
    await applyWrites(db, [w("x", { fp: "FP/1", source: "fiche" })]);
    expect(db.store.get("opportunities/o1").stale).toBeUndefined();
  });
});
