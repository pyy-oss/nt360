// Socle d'exécution partagé — Étape 0 du split en codebases (cf. docs/SPLIT-CODEBASES.md).
//
// Fabrique les helpers d'INFRASTRUCTURE transverses (journal d'exploitation, garde d'id, limiteur de
// débit) à partir des dépendances injectées, pour que plusieurs points d'entrée (futurs codebases)
// puissent les réutiliser SANS les redéfinir. Comportement STRICTEMENT identique à leur définition
// historique inline dans index.js (mêmes corps, extraits tels quels) — ce module ne change RIEN au
// runtime, il déplace seulement le code pour le rendre partageable.
//
// @param {{db, logger, HttpsError, FieldValue}} deps — services runtime déjà initialisés côté entrée.
// @returns {{logOps, assertPlainId, rateLimit}}
function createRuntime({ db, logger, HttpsError, FieldValue }) {
  // Journal d'EXPLOITATION : trace persistante des recomputes (manuels/planifiés) et de leurs
  // échecs, pour l'observabilité (surfacé en Admin). N'échoue jamais l'action appelante.
  async function logOps(entry) {
    try {
      await db.collection("opsLog").add({ ...entry, ts: FieldValue.serverTimestamp() });
    } catch (e) {
      logger.error("opsLog: écriture impossible", { message: e && e.message });
    }
  }

  // Rejette un id destiné à un chemin de document s'il est vide ou contient « / » (segments imbriqués
  // inattendus). Défense en profondeur sur les callables construisant db.doc(`collection/${id}`) à partir
  // d'une entrée client (Firestore traite déjà les segments littéralement, mais on refuse tôt et clair).
  function assertPlainId(id, label = "id") {
    const s = String(id == null ? "" : id);
    if (!s || s.includes("/")) throw new HttpsError("invalid-argument", `${label} invalide`);
    return s;
  }

  // Limiteur de débit par (uid, type) — best-effort, transactionnel sur rateLimits/{kind}_{uid} avec une
  // fenêtre glissante. Renvoie true si l'action est AUTORISÉE, false si le quota est dépassé (l'appelant
  // abandonne alors silencieusement). Anti-flood des journaux écrits par tout compte authentifié (errorLog).
  async function rateLimit(uid, kind, maxPerWindow, windowMs) {
    if (!uid) return false;
    const ref = db.doc(`rateLimits/${kind}_${uid}`);
    try {
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Date.now();
        const d = snap.exists ? snap.data() : null;
        const within = d && typeof d.windowStartMs === "number" && (now - d.windowStartMs) < windowMs;
        const count = within ? (Number(d.count) || 0) : 0;
        if (count >= maxPerWindow) return false;
        tx.set(ref, { windowStartMs: within ? d.windowStartMs : now, count: count + 1, updatedMs: now }, { merge: true });
        return true;
      });
    } catch (e) {
      logger.warn("rateLimit: transaction échouée (fail-open)", { kind, message: e && e.message });
      return true; // en cas d'erreur d'infra, ne pas bloquer l'action légitime
    }
  }

  // Autorisation d'ÉCRITURE d'un callable, GOUVERNÉE PAR LA MATRICE OPPOSABLE (config/permissions) —
  // même source que les Security Rules et le front. Révoquer un droit dans Habilitations a donc un
  // effet RÉEL sur les mutations serveur. `direction` = superviseur (write partout). Lève sinon.
  // NB : require("../domain/authz") — chemin relatif à CE module (lib/), pas à index.js.
  async function requireWrite(req, module) {
    if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
    const role = req.auth.token?.nt360Role;
    if (role === "direction") return;
    const { canWrite } = require("../domain/authz");
    const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
    if (!canWrite(matrix, role, module)) throw new HttpsError("permission-denied", `droit d'écriture « ${module} » requis`);
  }

  // Autorisation de LECTURE d'un callable (même matrice opposable) : pour les callables qui ne mutent
  // rien mais exposent des données gouvernées par un module (ex. dossier de rapprochement client).
  async function requireRead(req, module) {
    if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
    const role = req.auth.token?.nt360Role;
    if (role === "direction") return;
    const { canRead } = require("../domain/authz");
    const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
    if (!canRead(matrix, role, module)) throw new HttpsError("permission-denied", `droit de lecture « ${module} » requis`);
  }

  return { logOps, assertPlainId, rateLimit, requireWrite, requireRead };
}

module.exports = { createRuntime };
