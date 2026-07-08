import { describe, it, expect } from "vitest";
const { mergeQueued, acquireOrEnqueue } = require("../lib/aggregate");

// Faux Firestore minimal supportant runTransaction + doc + get/set(merge). Suffit à exercer
// la logique verrou/file (acquireOrEnqueue) sans émulateur. (Le core recompute n'est pas exercé ici.)
function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    doc: (path) => ({ path }),
    async runTransaction(fn) {
      const tx = {
        async get(ref) { return { exists: store.has(ref.path), data: () => store.get(ref.path) }; },
        set(ref, data, opts) {
          const next = opts && opts.merge ? { ...(store.get(ref.path) || {}) } : {};
          for (const [k, v] of Object.entries(data)) next[k] = v;
          store.set(ref.path, next);
        },
      };
      return fn(tx);
    },
  };
}
const LOCK = "config/recomputeLock";

describe("mergeQueued — coalescing de la portée (pur)", () => {
  it("full domine : only falsy → queuedFull", () => {
    expect(mergeQueued({ queuedFull: false, queuedKeys: ["a"] }, null)).toEqual({ queuedFull: true, queuedKeys: [] });
  });
  it("union des clés partielles, sans doublon", () => {
    const r = mergeQueued({ queuedFull: false, queuedKeys: ["a", "b"] }, ["b", "c"]);
    expect(r.queuedFull).toBe(false);
    expect(r.queuedKeys.sort()).toEqual(["a", "b", "c"]);
  });
  it("une fois full, reste full même avec des clés entrantes", () => {
    expect(mergeQueued({ queuedFull: true, queuedKeys: [] }, ["a"])).toEqual({ queuedFull: true, queuedKeys: [] });
  });
  it("état initial vide + clés → partiel", () => {
    expect(mergeQueued(undefined, ["x"])).toEqual({ queuedFull: false, queuedKeys: ["x"] });
  });
});

describe("acquireOrEnqueue — verrou de bail + mise en file", () => {
  it("verrou libre → ACQUIS (holder + bail futur posés)", async () => {
    const db = fakeDb();
    const r = await acquireOrEnqueue(db, null);
    expect(r.role).toBe("holder");
    const d = db.store.get(LOCK);
    expect(d.holder).toBeTruthy();
    expect(d.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it("verrou tenu (bail valide) → MIS EN FILE, portées fusionnées", async () => {
    const db = fakeDb({ [LOCK]: { holder: "h1", expiresAtMs: Date.now() + 100000, queued: false, queuedFull: false, queuedKeys: [] } });
    const a = await acquireOrEnqueue(db, ["suppliers"]);
    expect(a.role).toBe("enqueued");
    const b = await acquireOrEnqueue(db, ["alerts"]);
    expect(b.role).toBe("enqueued");
    const d = db.store.get(LOCK);
    expect(d.queued).toBe(true);
    expect(d.queuedFull).toBe(false);
    expect(d.queuedKeys.sort()).toEqual(["alerts", "suppliers"]);
    // une demande complète bascule la file en full
    await acquireOrEnqueue(db, null);
    expect(db.store.get(LOCK).queuedFull).toBe(true);
  });

  it("bail EXPIRÉ → récupéré (nouveau holder), pas de blocage après crash", async () => {
    const db = fakeDb({ [LOCK]: { holder: "mort", expiresAtMs: Date.now() - 1, queued: true, queuedFull: true, queuedKeys: [] } });
    const r = await acquireOrEnqueue(db, ["alerts"]);
    expect(r.role).toBe("holder");
    const d = db.store.get(LOCK);
    expect(d.holder).not.toBe("mort");
    expect(d.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it("reprise de bail : la file COMPLÈTE laissée par un holder mort est ABSORBÉE (portée = full) — audit P1-3", async () => {
    const db = fakeDb({ [LOCK]: { holder: "mort", expiresAtMs: Date.now() - 1, queued: true, queuedFull: true, queuedKeys: [] } });
    const r = await acquireOrEnqueue(db, ["alerts"]); // demande partielle, mais la file résiduelle est full
    expect(r.role).toBe("holder");
    expect(r.only).toBeNull(); // full absorbé → recompute complet (rien perdu)
    expect(db.store.get(LOCK).queued).toBe(false); // file consommée
  });

  it("reprise de bail : la file PARTIELLE résiduelle est fusionnée à la portée du nouveau holder — audit P1-3", async () => {
    const db = fakeDb({ [LOCK]: { holder: "mort", expiresAtMs: Date.now() - 1, queued: true, queuedFull: false, queuedKeys: ["suppliers"] } });
    const r = await acquireOrEnqueue(db, ["alerts"]);
    expect(r.role).toBe("holder");
    expect([...r.only].sort()).toEqual(["alerts", "suppliers"]); // union, rien perdu
    expect(db.store.get(LOCK).queued).toBe(false);
  });

  it("verrou libre sans file → portée initiale = celle demandée (inchangé)", async () => {
    const db = fakeDb();
    const r = await acquireOrEnqueue(db, ["news"]);
    expect(r.role).toBe("holder");
    expect(r.only).toEqual(["news"]);
  });
});
