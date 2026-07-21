import { describe, it, expect } from "vitest";
const { applyWrites, stripLiveOpps, resolveLogisticsFx, resolveBcDc, backfillBcFpFromDc } = require("../lib/apply");

// Faux Firestore minimal : un store `bcLines/{id} → data`, avec upsert (merge), delete et
// requête `collection("bcLines").where("fp", op, v)` (op "==" OU "in" — le balayage anti-orphelins
// interroge désormais par TRANCHES de FP via `in`). Suffit à exercer le balayage.
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
      where: (field, op, value) => ({
        async get() {
          const docs = [];
          for (const [path, data] of store) {
            if (!path.startsWith(col + "/")) continue;
            if (op === "in") { if (!value.includes(data[field])) continue; }
            else if (data[field] !== value) continue;
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

describe("resolveLogisticsFx — taux paramétrés appliqués sans écraser une correction manuelle (audit B7)", () => {
  // fakeDb minimal avec doc().get() : config/fxRates + docs bcLines existants.
  const fxDb = (seed) => ({
    doc: (path) => ({
      async get() { return { exists: path in seed, data: () => seed[path] }; },
    }),
  });
  const lg = (id, data) => ({ path: `bcLines/${id}`, data: { source: "logistics", fxSource: "a_saisir", ...data } });

  it("convertit une ligne USD « a_saisir » via config/fxRates (nouvelle ligne)", async () => {
    const db = fxDb({ "config/fxRates": { rates: { USD: 600 } } });
    const writes = [lg("bc_usd", { currency: "USD", amount: 1000 })];
    const n = await resolveLogisticsFx(db, writes);
    expect(n).toBe(1);
    expect(writes[0].data.amountXof).toBe(600000);
    expect(writes[0].data.fxSource).toBe("taux");
  });
  it("PRÉSERVE une correction manuelle existante (amountXof>0) — ne convertit pas", async () => {
    const db = fxDb({ "config/fxRates": { rates: { USD: 600 } }, "bcLines/bc_usd": { amountXof: 90000000, fxSource: "manuel" } });
    const writes = [lg("bc_usd", { currency: "USD", amount: 1000 })];
    const n = await resolveLogisticsFx(db, writes);
    expect(n).toBe(0);
    expect(writes[0].data).not.toHaveProperty("amountXof"); // laissé tel quel → merge garde le manuel
  });
  it("sans taux configuré → aucune conversion", async () => {
    const db = fxDb({ "config/fxRates": { rates: {} } });
    const writes = [lg("bc_gbp", { currency: "GBP", amount: 500 })];
    expect(await resolveLogisticsFx(db, writes)).toBe(0);
    expect(writes[0].data).not.toHaveProperty("amountXof");
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

describe("resolveBcDc / backfillBcFpFromDc — rattachement DC → N° FP persistant (ADR-067)", () => {
  // fakeDb minimal avec doc().get() : l'overlay config/dcAliases seul suffit à resolveBcDc.
  const aliasDb = (seed) => ({
    doc: (path) => ({ async get() { return { data: () => seed[path] }; } }),
  });

  it("resolveBcDc : une écriture bcLines SANS fp à DC connu arrive rattachée (fp canonisé) ; un fp existant PRIME", async () => {
    const db = aliasDb({ "config/dcAliases": { map: { DC1: "FP/2026/0007" } } });
    const writes = [
      { path: "bcLines/a", data: { dc: "DC1" } },                  // sans fp → résolu (fpKey canonise)
      { path: "bcLines/b", data: { dc: "DC1", fp: "FP/2026/9" } }, // fp existant → intouché (primauté)
      { path: "bcLines/c", data: { dc: "DCX" } },                  // DC inconnu de l'overlay → intouché
      { path: "orders/o1", data: { dc: "DC1" } },                  // hors bcLines → hors périmètre
    ];
    expect(await resolveBcDc(db, writes)).toBe(1);
    expect(writes[0].data.fp).toBe("FP/2026/7");
    expect(writes[1].data.fp).toBe("FP/2026/9");
    expect(writes[2].data.fp).toBeUndefined();
    expect(writes[3].data.fp).toBeUndefined();
  });

  it("resolveBcDc : overlay vide ou illisible → aucun effet (best-effort, jamais bloquant)", async () => {
    const writes = [{ path: "bcLines/a", data: { dc: "DC1" } }];
    expect(await resolveBcDc(aliasDb({ "config/dcAliases": { map: {} } }), writes)).toBe(0);
    const broken = { doc: () => ({ async get() { throw new Error("indisponible"); } }) };
    expect(await resolveBcDc(broken, writes)).toBe(0);
    expect(writes[0].data.fp).toBeUndefined();
  });

  // fakeDb pour le backfill : store id → data, select/limit projetés, batch.update fusionné au commit.
  const bfDb = (docs) => {
    const store = new Map(Object.entries(docs));
    return {
      store,
      collection: () => ({
        select: () => ({ limit: () => ({
          async get() { return { docs: [...store].map(([id, data]) => ({ ref: { id }, data: () => data })) }; },
        }) }),
      }),
      batch: () => {
        const ops = [];
        return {
          update(ref, data) { ops.push([ref.id, data]); },
          async commit() { for (const [id, data] of ops) store.set(id, { ...store.get(id), ...data }); },
        };
      },
    };
  };

  it("backfillBcFpFromDc : pose fp sur les docs SANS fp dont le DC résout — jamais d'écrasement d'un fp existant", async () => {
    const map = { DC1: "FP/2026/0012", DC2: "FP/2026/2" };
    const db = bfDb({
      a: { dc: "DC1" },                   // sans fp → backfillé (canonisé)
      b: { dc: "DC1", fp: "FP/2026/99" }, // fp existant → intouché (primauté resolveBcFp)
      c: { dc: "DCX" },                   // DC hors overlay → intouché
      d: { fp: "", dc: "DC2" },           // fp vide = absent → backfillé
    });
    expect(await backfillBcFpFromDc(db, map)).toBe(2);
    expect(db.store.get("a").fp).toBe("FP/2026/12");
    expect(db.store.get("b").fp).toBe("FP/2026/99");
    expect(db.store.get("c").fp).toBeUndefined();
    expect(db.store.get("d").fp).toBe("FP/2026/2");
  });

  it("backfillBcFpFromDc : overlay vide → aucun scan, 0", async () => {
    expect(await backfillBcFpFromDc(null, {})).toBe(0);
    expect(await backfillBcFpFromDc(null, undefined)).toBe(0);
  });
});
