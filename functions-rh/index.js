// Codebase Firebase « rh » — 2e domaine extrait du monolithe (split, docs/SPLIT-CODEBASES.md, Étape 2).
// Démarre avec les CANDIDATS (vivier / recrutement) : handler le MOINS couplé du dépôt (aucun recompute,
// aucun secret, aucune dépendance à un helper d'index.js — uniquement le socle partagé). staffing /
// timesheets rejoindront CE codebase plus tard (ajout ADDITIF, pas un transfert), une fois le canal de
// recompute différé validé en prod (ils écrivent des summaries).
//
// MÊME PATRON D'INJECTION que le monolithe : socle partagé @nt360/functions-shared + handler factory.
// Comportement des callables STRICTEMENT identique à leur définition historique dans functions/index.js.
const { onCall: _onCall } = require("firebase-functions/v2/https");
const { HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const { initializeApp, getApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { withMemory } = require("@nt360/functions-shared/lib/fnopts");
const onCall = (opts, handler) => (typeof opts === "function" ? _onCall(opts) : _onCall(withMemory(opts), handler));

const { FIRESTORE_DB } = require("@nt360/functions-shared/lib/config");
const { createRuntime } = require("@nt360/functions-shared/lib/runtime");
const { createCandidates } = require("@nt360/functions-shared/handlers/candidates");

initializeApp();
const db = getFirestore(getApp(), FIRESTORE_DB);
db.settings({ ignoreUndefinedProperties: true });

// Socle : onCallG (+ observabilité), requireWrite/requireRead (matrice opposable), assertPlainId. MÊME code
// que le monolithe (déplacement, pas de fork).
const { onCallG, requireWrite, requireRead, assertPlainId } = createRuntime({ db, logger, HttpsError, FieldValue, onCall });

const _candidates = createCandidates({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId });

// Exports déclarés ici (garde-fou de déploiement par nom, manifeste functions-rh/deployed-functions.txt).
exports.upsertCandidate = _candidates.upsertCandidate;
exports.deleteCandidate = _candidates.deleteCandidate;
exports.listCandidates = _candidates.listCandidates;
