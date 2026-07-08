import { describe, it, expect } from "vitest";
const { applyWrites, stripLiveOpps } = require("../lib/apply");

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

describe("stripLiveOpps — LIVE écarté des canaux delta/ingest/reingest (audit P0-1)", () => {
  it("retire toutes les écritures opportunities/ et compte les opps écartées", () => {
    const writes = [
      { path: "orders/o1", data: { fp: "FP/1" } },
      { path: "opportunities/x1", data: { source: "salesData" } },
      { path: "invoices/i1", data: { fp: "FP/1" } },
      { path: "opportunities/x2", data: { source: "salesData" } },
    ];
    const { writes: kept, skipped } = stripLiveOpps(writes);
    expect(skipped).toBe(2);
    expect(kept.map((w) => w.path)).toEqual(["orders/o1", "invoices/i1"]);
  });
  it("sans opp → tout conservé, skipped=0", () => {
    const { writes: kept, skipped } = stripLiveOpps([{ path: "orders/o1", data: {} }]);
    expect(skipped).toBe(0);
    expect(kept).toHaveLength(1);
  });
});

describe("applyWrites — chemin DELTA/partiel : ne mass-stalise JAMAIS les opportunités (cf. vérification)", () => {
  const opp = (id, data) => ({ path: `opportunities/${id}`, data });
  it("un import DELTA d'1 opp salesData ne touche PAS les autres opps en base (pas de snapshot)", async () => {
    // Régression : un fichier de CORRECTION partiel via importDelta → applyWrites ne doit rien staliser.
    const db = fakeDb({
      "opportunities/o1": { source: "salesData", fp: "FP/1", stage: 3 },
      "opportunities/o2": { source: "salesData", fp: "FP/2", stage: 4 }, // absente du delta — NON marquée
      "opportunities/o3": { source: "salesData", fp: "FP/3", stage: 5 }, // absente du delta — NON marquée
    });
    await applyWrites(db, [opp("o1", { source: "salesData", fp: "FP/1", stage: 3, amount: 999 })]);
    expect(db.store.get("opportunities/o2").stale).toBeUndefined(); // intacte
    expect(db.store.get("opportunities/o3").stale).toBeUndefined(); // intacte
    expect(db.store.get("opportunities/o1").amount).toBe(999);      // upsert appliqué
  });
});
