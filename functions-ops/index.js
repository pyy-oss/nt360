// Codebase Firebase « ops » — 4e domaine extrait du monolithe (split, docs/SPLIT-CODEBASES.md, Étape 5).
// Démarre avec l'ASSAINISSEMENT (suppressions ciblées, annulations, purges) : handler dont tous les deps
// sont du socle partagé (dont les gardes record-level assertRecordVisible/recordAccessOwd/isRecordAdmin)
// + le recompute (différé). reports / automations / outbound rejoindront `ops` plus tard (après remontée
// au socle des helpers d'index.js dont ils dépendent : loadUsersMap, scopedOpps, nowISO10…).
//
// MÊME PATRON D'INJECTION que le monolithe. Comportement des callables STRICTEMENT identique.
const { onCall: _onCall } = require("firebase-functions/v2/https");
const { HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const { initializeApp, getApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { withMemory } = require("@nt360/functions-shared/lib/fnopts");
const onCall = (opts, handler) => (typeof opts === "function" ? _onCall(opts) : _onCall(withMemory(opts), handler));

const { FIRESTORE_DB } = require("@nt360/functions-shared/lib/config");
const { createRuntime } = require("@nt360/functions-shared/lib/runtime");
const { createSanitize } = require("@nt360/functions-shared/handlers/sanitize");

initializeApp();
const db = getFirestore(getApp(), FIRESTORE_DB);
db.settings({ ignoreUndefinedProperties: true });

// Socle : onCallG, requireWrite, assertPlainId, logOps, rateLimit + gardes record-level (assertRecordVisible,
// recordAccessOwd, isRecordAdmin). MÊME code que le monolithe (déplacement, pas de fork).
const { onCallG, requireWrite, assertPlainId, logOps, rateLimit, assertRecordVisible, recordAccessOwd, isRecordAdmin } =
  createRuntime({ db, logger, HttpsError, FieldValue, onCall });

// Recompute DIFFÉRÉ (obligatoire dans un codebase séparé) : dépose une demande dans config/recomputeRequest,
// traitée par onRecomputeRequest (codebase default). Le handler assainissement appelle `requestRecompute()`
// (et `recomputeNow()` s'il est fourni — on ne le fournit PAS → repli sur requestRecompute). ⚠️ PRÉALABLE :
// canal différé vivant en prod (trigger + RECOMPUTE_REGION). Cf. docs/SPLIT-CODEBASES.md.
async function requestRecompute(scope) {
  await db.doc("config/recomputeRequest").set({ scope: scope || null, ts: FieldValue.serverTimestamp() });
}

const _sanitize = createSanitize({
  onCallG, HttpsError, db, FieldValue, requireWrite, assertPlainId,
  requestRecompute, recomputeNow: undefined,
  logOps, assertRecordVisible, recordAccessOwd, isRecordAdmin, rateLimit,
});

// Exports déclarés ici (garde-fou de déploiement par nom, manifeste functions-ops/deployed-functions.txt).
exports.deleteRecords = _sanitize.deleteRecords;
exports.setCancellation = _sanitize.setCancellation;
exports.purgeCollections = _sanitize.purgeCollections;
