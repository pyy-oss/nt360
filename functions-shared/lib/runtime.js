// Socle d'exécution partagé — Étape 0 du split en codebases (cf. docs/SPLIT-CODEBASES.md).
//
// Fabrique les helpers d'INFRASTRUCTURE transverses (journal d'exploitation, garde d'id, limiteur de
// débit) à partir des dépendances injectées, pour que plusieurs points d'entrée (futurs codebases)
// puissent les réutiliser SANS les redéfinir. Comportement STRICTEMENT identique à leur définition
// historique inline dans index.js (mêmes corps, extraits tels quels) — ce module ne change RIEN au
// runtime, il déplace seulement le code pour le rendre partageable.
//
// @param {{db, logger, HttpsError, FieldValue, onCall}} deps — services runtime déjà initialisés côté entrée.
//        `onCall` = le wrapper maison (withMemory) autour de firebase-functions v2 https.onCall.
// @returns {{logOps, assertPlainId, rateLimit, requireWrite, requireRead, onCallG, postWebhook,
//            isRecordAdmin, recordAccessOwd, assertRecordVisible, requireStrongAuth}}
function createRuntime({ db, logger, HttpsError, FieldValue, onCall }) {
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

  // « Administrateur d'enregistrements » = voit TOUT quel que soit l'OWD (direction ou droit
  // d'écriture « habilitations »). Aligné sur le helper isRecordAdmin() des Security Rules.
  async function isRecordAdmin(req) {
    if (req.auth?.token?.nt360Role === "direction") return true;
    const { canWrite } = require("../domain/authz");
    const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
    return canWrite(matrix, req.auth?.token?.nt360Role, "habilitations");
  }
  // OWD courant d'un objet (config/recordAccess) : 'private' ou 'public' (défaut). Lecture unique.
  async function recordAccessOwd(obj) {
    const cfg = (await db.doc("config/recordAccess").get()).data() || {};
    return cfg[obj] === "private" ? "private" : "public";
  }

  // GARDE RBAC PAR ENREGISTREMENT (audit) : sous OWD « private », une mutation ciblée (réattribution,
  // édition, suppression, activité) exige que l'appelant VOIE déjà l'enregistrement (visibleTo). Sans
  // cela, un rôle « pipeline » pouvait, par simple énumération d'id, éditer / SE RÉATTRIBUER (et donc
  // lire) un enregistrement privé hors de son périmètre — les Security Rules cadrent la LECTURE directe
  // mais pas ces callables Admin SDK. Les admins d'enregistrement (direction / droit habilitations) et
  // l'OWD « public » (défaut historique) passent sans restriction. `curData` = doc DÉJÀ chargé.
  async function assertRecordVisible(req, coll, curData) {
    if (await isRecordAdmin(req)) return;
    if ((await recordAccessOwd(coll)) !== "private") return;
    const vt = Array.isArray(curData && curData.visibleTo) ? curData.visibleTo : [];
    if (!vt.includes(req.auth.uid)) throw new HttpsError("permission-denied", "enregistrement non visible (OWD privé) — action refusée");
  }

  // Exige un 2e facteur (MFA) pour les actions sensibles SI config/security.require2fa est actif. Le jeton
  // Firebase porte `firebase.sign_in_second_factor` quand l'utilisateur s'est authentifié avec un second
  // facteur. Direction INCLUSE (pas d'exception : un compte admin est la cible la plus sensible). Par
  // défaut inactif (require2fa=false) → aucun changement de comportement tant que la direction ne l'active pas.
  async function requireStrongAuth(req) {
    const sec = (await db.doc("config/security").get()).data() || {};
    if (!sec.require2fa) return;
    if (!req.auth?.token?.firebase?.sign_in_second_factor) {
      throw new HttpsError("permission-denied", "authentification à deux facteurs requise pour cette action");
    }
  }

  // --- Notifications d'alerte (webhook entrant Slack/Teams : POST JSON {text}). L'URL vit dans
  // config/notifications (lecture réservée aux habilitations) ; sans URL/désactivé, tout no-op. ---
  async function postWebhook(url, text) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
  }

  // Codes HttpsError « attendus » (rejets de validation/autorisation) : ne PAS les traiter comme des
  // incidents. Tout le reste = échec inattendu → journalisé dans opsLog + alerte webhook.
  const EXPECTED_ERR = new Set(["invalid-argument", "permission-denied", "unauthenticated", "failed-precondition", "not-found", "already-exists"]);

  // Enveloppe un handler onCall : capture les échecs INATTENDUS (observabilité), les trace dans
  // opsLog et, si un webhook est configuré, envoie une alerte de crash — puis re-propage l'erreur.
  // Seuil de LATENCE au-delà duquel un callable est jugé « lent » et tracé (observabilité SLA — R5). Un
  // Directeur des Opérations a besoin de voir les appels qui dérivent avant qu'ils ne deviennent des pannes.
  const SLOW_CALLABLE_MS = 8_000;
  function guarded(action, handler) {
    return async (req) => {
      const t0 = Date.now();
      try {
        const out = await handler(req);
        // Succès : on ne journalise QUE les appels anormalement lents (pas de bruit sur le chemin nominal),
        // avec leur durée → signal de latence exploitable dans Cloud Logging + collection ops.
        const ms = Date.now() - t0;
        if (ms >= SLOW_CALLABLE_MS) {
          logger.warn(`${action} lent`, { action, durationMs: ms, uid: (req.auth && req.auth.uid) || null });
          await logOps({ kind: "callable", action, status: "slow", uid: (req.auth && req.auth.uid) || null, durationMs: ms });
        }
        return out;
      } catch (e) {
        if (e && e.code && EXPECTED_ERR.has(e.code)) throw e; // rejet métier normal → pas un incident
        const msg = (e && e.message) || String(e);
        const durationMs = Date.now() - t0;
        logger.error(`${action} a échoué`, { action, message: msg, durationMs, stack: e && e.stack });
        await logOps({ kind: "callable", action, status: "error", uid: (req.auth && req.auth.uid) || null, error: msg, durationMs });
        try {
          const cfg = (await db.doc("config/notifications").get()).data();
          if (cfg && cfg.enabled && cfg.webhookUrl) await postWebhook(cfg.webhookUrl, `⚠️ nt360 — échec de « ${action} » : ${msg}`);
        } catch (_) { /* alerte best-effort */ }
        throw e;
      }
    };
  }

  // onCall enveloppé par guarded() (observabilité). Supporte onCall(handler) ET onCall(opts, handler).
  //
  // App Check (F8) — ENFORCEMENT côté serveur, piloté par la variable d'environnement APPCHECK_ENFORCE.
  // OFF par défaut : activer (APPCHECK_ENFORCE=true) UNIQUEMENT une fois la clé reCAPTCHA v3 déployée
  // au client (VITE_APPCHECK_SITE_KEY) ET App Check enregistré dans la console Firebase — sinon TOUS
  // les appels callables seraient rejetés. Le drapeau est lu au chargement, à l'enregistrement de
  // chaque callable ; il permet de basculer par simple variable d'env, sans modifier le code.
  function onCallG(action, opts, handler) {
    if (typeof opts === "function") { handler = opts; opts = {}; }
    // enforceAppCheck ajouté quand le drapeau est actif ; un opts explicite reste prioritaire.
    const merged = process.env.APPCHECK_ENFORCE === "true" ? { enforceAppCheck: true, ...opts } : opts;
    return onCall(merged, guarded(action, handler));
  }

  return {
    logOps, assertPlainId, rateLimit, requireWrite, requireRead, onCallG, postWebhook,
    isRecordAdmin, recordAccessOwd, assertRecordVisible, requireStrongAuth,
  };
}

module.exports = { createRuntime };
