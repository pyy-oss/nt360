// Test d'INTÉGRATION du verrou de recompute contre l'ÉMULATEUR Firestore (transactions réelles).
// Complète les tests unitaires (mergeQueued/acquireOrEnqueue sur fake db) en validant ce qu'un fake ne
// peut pas : la SÉRIALISABILITÉ transactionnelle réelle sous concurrence. On injecte un `core` factice
// qui mesure le parallélisme — l'assertion clé est maxActif === 1 (exclusion mutuelle effective).
// Lancé par `pnpm test:rules` (firebase emulators:exec --only firestore) : FIRESTORE_EMULATOR_HOST est
// alors positionné et firebase-admin s'y connecte automatiquement.
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const { runSerialized } = require("../lib/aggregate");
const LOCK = "config/recomputeLock";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let app, db;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST absent — lancer via `pnpm test:rules` (emulators:exec).");
  }
  app = initializeApp({ projectId: "recompute-lock-it" }, "recompute-lock-it");
  db = getFirestore(app);
});
afterAll(async () => { await deleteApp(app); });
beforeEach(async () => { await db.doc(LOCK).delete().catch(() => {}); });

describe("verrou de recompute — intégration émulateur (concurrence réelle)", () => {
  it("N recomputes concurrents → EXCLUSION MUTUELLE (jamais 2 core en parallèle) + portées couvertes", async () => {
    let active = 0, maxActive = 0;
    const ran = [];
    const core = async (_db, only) => {
      active++; maxActive = Math.max(maxActive, active);
      await sleep(40); // maintient la « passe » ouverte pour exposer tout chevauchement
      ran.push(only == null ? "FULL" : only.join(","));
      active--;
      return { written: ["ok"] };
    };
    const N = 8;
    // moitié FULL (only=null), moitié partiel ["alerts"] → lancés tous « en même temps »
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => runSerialized(db, i % 2 === 0 ? null : ["alerts"], core)),
    );
    // 1) Aucune exécution concurrente du core : le verrou sérialise réellement.
    expect(maxActive).toBe(1);
    // 2) Toutes les promesses résolvent (aucun rejet / deadlock).
    expect(results).toHaveLength(N);
    // 3) Le core a tourné au moins une fois et une passe FULL a eu lieu (au moins une demande FULL).
    expect(ran.length).toBeGreaterThanOrEqual(1);
    expect(ran).toContain("FULL");
    // 4) Verrou LIBÉRÉ à la fin (holder retiré) — pas de blocage résiduel.
    const lock = (await db.doc(LOCK).get()).data() || {};
    expect(lock.holder == null || lock.holder === undefined).toBe(true);
    expect(lock.queued === false || lock.queued == null).toBe(true);
  });

  it("bail EXPIRÉ (détenteur mort) → un nouvel appel récupère le verrou et s'exécute", async () => {
    // Simule un détenteur crashé : holder posé, bail déjà expiré.
    await db.doc(LOCK).set({ holder: "mort", acquiredAtMs: Date.now() - 10_000, expiresAtMs: Date.now() - 1, queued: false, queuedFull: false, queuedKeys: [] });
    let ran = false;
    await runSerialized(db, ["suppliers"], async () => { ran = true; return { written: ["ok"] }; });
    expect(ran).toBe(true); // le verrou n'est pas resté bloqué par le détenteur mort
    const lock = (await db.doc(LOCK).get()).data() || {};
    expect(lock.holder == null).toBe(true); // relâché proprement après exécution
  });

  it("échec du core → verrou RELÂCHÉ (pas d'immobilisation) et erreur propagée", async () => {
    await expect(
      runSerialized(db, null, async () => { throw new Error("boom"); }),
    ).rejects.toThrow("boom");
    const lock = (await db.doc(LOCK).get()).data() || {};
    expect(lock.holder == null).toBe(true); // libéré malgré l'échec
    // et un appel ultérieur peut de nouveau acquérir
    let ran = false;
    await runSerialized(db, null, async () => { ran = true; return { written: [] }; });
    expect(ran).toBe(true);
  });

  it("appels SÉQUENTIELS → chacun exécute son core (aucun faux coalescing hors concurrence)", async () => {
    let n = 0;
    for (let i = 0; i < 3; i++) await runSerialized(db, ["alerts"], async () => { n++; return { written: [] }; });
    expect(n).toBe(3);
  });
});
