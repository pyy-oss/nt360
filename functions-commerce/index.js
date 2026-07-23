// Codebase Firebase « commerce » — 3e domaine extrait du monolithe (split, docs/SPLIT-CODEBASES.md,
// Étape 3). Démarre avec les OBJECTIFS (R/O CODIR) et les FICHES AFFAIRE : deux handlers dont le seul
// couplage est le recompute (différé). Les OPPORTUNITÉS rejoindront ce codebase plus tard, après remontée
// dans le socle des helpers d'index.js dont elles dépendent (visibleToFor, oppScope, fireOutbound…).
//
// MÊME PATRON D'INJECTION que le monolithe : socle partagé + handlers factory. Comportement des callables
// STRICTEMENT identique à leur définition historique dans functions/index.js.
const { onCall: _onCall } = require("firebase-functions/v2/https");
const { HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const { initializeApp, getApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { withMemory } = require("@nt360/functions-shared/lib/fnopts");
const onCall = (opts, handler) => (typeof opts === "function" ? _onCall(opts) : _onCall(withMemory(opts), handler));

const { FIRESTORE_DB } = require("@nt360/functions-shared/lib/config");
const { createRuntime } = require("@nt360/functions-shared/lib/runtime");
const { createObjectives } = require("@nt360/functions-shared/handlers/objectives");
const { createFiches } = require("@nt360/functions-shared/handlers/fiches");

initializeApp();
const db = getFirestore(getApp(), FIRESTORE_DB);
db.settings({ ignoreUndefinedProperties: true });

const { onCallG, requireWrite, assertPlainId } = createRuntime({ db, logger, HttpsError, FieldValue, onCall });

// Recompute DIFFÉRÉ (obligatoire dans un codebase séparé, cf. functions-par) : dépose une demande dans
// config/recomputeRequest ; c'est le trigger onRecomputeRequest du codebase `default` qui exécute le
// recalcul. ⚠️ PRÉALABLE DE DÉPLOIEMENT : canal différé vivant en prod (trigger + RECOMPUTE_REGION),
// sinon les KPI objectifs / fiches restent périmés. Cf. docs/SPLIT-CODEBASES.md.
async function requestRecompute(scope) {
  await db.doc("config/recomputeRequest").set({ scope: scope || null, ts: FieldValue.serverTimestamp() });
}

const _objectives = createObjectives({ onCallG, HttpsError, db, FieldValue, requireWrite, assertPlainId, requestRecompute });
const _fiches = createFiches({ onCallG, HttpsError, db, FieldValue, requestRecompute });

// Exports déclarés ici (garde-fou de déploiement par nom, manifeste functions-commerce/deployed-functions.txt).
exports.upsertObjective = _objectives.upsertObjective;
exports.deleteObjective = _objectives.deleteObjective;
exports.createFiche = _fiches.createFiche;
exports.updateFiche = _fiches.updateFiche;
exports.ficheAdvance = _fiches.ficheAdvance;
exports.ficheReject = _fiches.ficheReject;
exports.getFiche = _fiches.getFiche;
exports.listFiches = _fiches.listFiches;
