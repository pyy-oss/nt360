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
const { defineSecret } = require("firebase-functions/params");
const { initializeApp, getApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { withMemory } = require("@nt360/functions-shared/lib/fnopts");
const onCall = (opts, handler) => (typeof opts === "function" ? _onCall(opts) : _onCall(withMemory(opts), handler));

const { FIRESTORE_DB } = require("@nt360/functions-shared/lib/config");
const { createRuntime } = require("@nt360/functions-shared/lib/runtime");
const { createCandidates } = require("@nt360/functions-shared/handlers/candidates");
const { createStaffing } = require("@nt360/functions-shared/handlers/staffing");
const { createTimesheets } = require("@nt360/functions-shared/handlers/timesheets");

// Token API ClickUp (Secret Manager, MÊME nom que le monolithe) + workspace ClickUp (constante, MÊME
// valeur que index.js) — utilisés par la synchro CRA ⇄ ClickUp (timesheets).
const CLICKUP_TOKEN = defineSecret("CLICKUP_TOKEN");
const CLICKUP_TEAM = "90121503678";

initializeApp();
const db = getFirestore(getApp(), FIRESTORE_DB);
db.settings({ ignoreUndefinedProperties: true });

// Socle : onCallG (+ observabilité), requireWrite/requireRead (matrice opposable), assertPlainId, logOps.
// MÊME code que le monolithe (déplacement, pas de fork).
const { onCallG, requireWrite, requireRead, assertPlainId, logOps } = createRuntime({ db, logger, HttpsError, FieldValue, onCall });

// Recompute DIFFÉRÉ (obligatoire dans un codebase séparé) : dépose une demande dans config/recomputeRequest,
// traitée par onRecomputeRequest (codebase default). staffing/timesheets appellent recomputeNow(scope) ; on
// leur injecte donc CE requestRecompute différé. ⚠️ PRÉALABLE : canal différé vivant en prod (trigger +
// RECOMPUTE_REGION), sinon les KPI de staffing / TACE / rentabilité restent périmés. Cf. docs/SPLIT-CODEBASES.md.
async function requestRecompute(scope) {
  await db.doc("config/recomputeRequest").set({ scope: scope || null, ts: FieldValue.serverTimestamp() });
}

const _candidates = createCandidates({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId });
const _staffing = createStaffing({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId, recomputeNow: requestRecompute, logOps });
const _timesheets = createTimesheets({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId, CLICKUP_TOKEN, CLICKUP_TEAM, recomputeNow: requestRecompute, logOps });

// Exports déclarés ici (garde-fou de déploiement par nom, manifeste functions-rh/deployed-functions.txt).
exports.upsertCandidate = _candidates.upsertCandidate;
exports.deleteCandidate = _candidates.deleteCandidate;
exports.listCandidates = _candidates.listCandidates;
// Consultants + plan de charge (staffing).
exports.upsertConsultant = _staffing.upsertConsultant;
exports.deleteConsultant = _staffing.deleteConsultant;
exports.listConsultants = _staffing.listConsultants;
exports.upsertAssignment = _staffing.upsertAssignment;
exports.deleteAssignment = _staffing.deleteAssignment;
exports.staffingPlan = _staffing.staffingPlan;
// CRA / temps + KPI d'activité + rentabilité ressource (timesheets).
exports.upsertTimesheet = _timesheets.upsertTimesheet;
exports.deleteTimesheet = _timesheets.deleteTimesheet;
exports.timesheetKpis = _timesheets.timesheetKpis;
exports.taceHistory = _timesheets.taceHistory;
exports.importTimesheets = _timesheets.importTimesheets;
exports.syncClickupTimesheets = _timesheets.syncClickupTimesheets;
exports.resourcePnl = _timesheets.resourcePnl;
exports.preBillingFromCra = _timesheets.preBillingFromCra;
exports.deliveryMarginByAffaire = _timesheets.deliveryMarginByAffaire;
