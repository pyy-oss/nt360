// Verrou de concurrence pour les opérations ClickUp en MASSE qui CRÉENT des tâches (push commandes,
// push BC). Sans lui, deux clics rapprochés lancent des exécutions PARALLÈLES : chacune construit son
// index anti-doublon AVANT que les autres n'aient créé quoi que ce soit → aucune ne voit les créations
// en cours des autres → tâches dupliquées (autant que de lancements concurrents). L'anti-doublon par FP
// ne protège que les re-lancements SÉQUENTIELS ; ce bail sérialise les concurrents.
//
// Bail à durée > durée max d'une fonction (540 s) : un détenteur VIVANT ne dépasse jamais son bail (la
// plateforme le tue avant) → aucun vol en cours de passe ; seul un détenteur MORT est récupéré (≤ bail).
// Admin SDK (hors Security Rules). Une clé par famille d'opération pour un diagnostic clair.
const CLICKUP_LOCK_PATH = "config/clickupPushLock";
const CLICKUP_LEASE_MS = 600_000;

/**
 * Tente d'acquérir le verrou `key`. Atomique (runTransaction).
 * @returns {Promise<{acquired:boolean, holder?:string, sinceMs?:number}>}
 */
async function acquireClickupLock(db, key, holder) {
  const ref = db.doc(CLICKUP_LOCK_PATH);
  return db.runTransaction(async (tx) => {
    const d = (tx ? (await tx.get(ref)).data() : null) || {};
    const cur = d[key];
    const now = Date.now();
    if (cur && typeof cur.expiresAtMs === "number" && cur.expiresAtMs > now) {
      return { acquired: false, holder: cur.holder || null, sinceMs: cur.acquiredAtMs || null };
    }
    tx.set(ref, { [key]: { holder, acquiredAtMs: now, expiresAtMs: now + CLICKUP_LEASE_MS } }, { merge: true });
    return { acquired: true };
  });
}

/** Libère le verrou `key` (best-effort ; le bail le récupérerait de toute façon après expiration). */
async function releaseClickupLock(db, FieldValue, key) {
  try { await db.doc(CLICKUP_LOCK_PATH).set({ [key]: FieldValue.delete() }, { merge: true }); }
  catch { /* le bail expirera seul */ }
}

module.exports = { acquireClickupLock, releaseClickupLock, CLICKUP_LEASE_MS };
