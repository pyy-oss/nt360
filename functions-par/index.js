// Codebase Firebase « partenariats » — 1er domaine extrait du monolithe (split, docs/SPLIT-CODEBASES.md,
// Étape 1). Un changement ici ne redéploie QUE ces ~21 fonctions, plus les 202 du monolithe.
//
// MÊME PATRON D'INJECTION que le monolithe : on reconstruit les mêmes services (socle partagé
// @nt360/functions-shared) et on câble le handler factory `createPartenariats`. Comportement des
// callables STRICTEMENT identique à leur définition historique dans functions/index.js — seul le
// POINT D'ENTRÉE qui les déclare change.
const { onCall: _onCall } = require("firebase-functions/v2/https");
const { HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp, getApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Traduction memoryMiB → memory (idem monolithe : withMemory rend l'option maison effective). onCall
// enveloppé pour supporter onCall(handler) ET onCall(opts, handler), comme dans functions/index.js.
const { withMemory } = require("@nt360/functions-shared/lib/fnopts");
const onCall = (opts, handler) => (typeof opts === "function" ? _onCall(opts) : _onCall(withMemory(opts), handler));

const { FIRESTORE_DB } = require("@nt360/functions-shared/lib/config");
const { createRuntime } = require("@nt360/functions-shared/lib/runtime");
const { createPartenariats } = require("@nt360/functions-shared/handlers/partenariats");

// Secrets (Secret Manager) : MÊMES noms que le monolithe → MÊMES secrets. Anthropic (QBR / plan d'action
// / suggestion de mapping IA) ; ClickUp (push d'assignation → tâche).
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const CLICKUP_TOKEN = defineSecret("CLICKUP_TOKEN");

initializeApp();
// Base Firestore nommée nt360 (projet partagé) — identique au monolithe.
const db = getFirestore(getApp(), FIRESTORE_DB);
db.settings({ ignoreUndefinedProperties: true });

// Socle d'exécution partagé (logOps / rateLimit / requireWrite / requireRead / onCallG …). MÊME code que
// le monolithe (déplacement, pas de fork).
const { logOps, rateLimit, requireWrite, requireRead, onCallG } = createRuntime({ db, logger, HttpsError, FieldValue, onCall });

// Recompute DIFFÉRÉ (obligatoire dans un codebase séparé) : ce codebase ne porte PAS l'orchestrateur
// `recomputeSummaries` (il vit dans le codebase « core »). Une mutation partenariats DÉPOSE donc une
// demande dans config/recomputeRequest ; c'est le trigger `onRecomputeRequest` du codebase core qui
// exécute le recalcul. `recomputeNow` reste INJECTÉ À undefined → le handler route sur requestRecompute
// (cf. handlers/partenariats.js recomputeParNow). ⚠️ PRÉALABLE DE DÉPLOIEMENT : le canal différé DOIT
// être vivant en prod (trigger onRecomputeRequest déployé + RECOMPUTE_REGION posée), sinon les demandes
// ne sont jamais traitées et les KPI partenariats restent périmés. Cf. docs/SPLIT-CODEBASES.md.
async function requestRecompute(scope) {
  await db.doc("config/recomputeRequest").set({ scope: scope || null, ts: FieldValue.serverTimestamp() });
}

const _partenariats = createPartenariats({
  onCallG, HttpsError, db, FieldValue, requireWrite, requireRead,
  requestRecompute, recomputeNow: undefined,
  ANTHROPIC_API_KEY, CLICKUP_TOKEN, rateLimit, logOps,
});

// Exports déclarés ici (garde-fou de déploiement par nom, manifeste functions-par/deployed-functions.txt).
exports.upsertParPartner = _partenariats.upsertParPartner;
exports.deleteParPartner = _partenariats.deleteParPartner;
exports.upsertParCertification = _partenariats.upsertParCertification;
exports.deleteParCertification = _partenariats.deleteParCertification;
exports.setParPartnerMap = _partenariats.setParPartnerMap;
exports.upsertParAssignment = _partenariats.upsertParAssignment;
exports.setParAssignmentStatus = _partenariats.setParAssignmentStatus;
exports.deleteParAssignment = _partenariats.deleteParAssignment;
exports.pushParAssignmentToClickup = _partenariats.pushParAssignmentToClickup;
exports.generateParActionPlan = _partenariats.generateParActionPlan;
exports.generateParQbr = _partenariats.generateParQbr;
exports.suggestParPartnerMap = _partenariats.suggestParPartnerMap;
exports.importParCertifications = _partenariats.importParCertifications;
exports.importParCertificationsFile = _partenariats.importParCertificationsFile;
// Avantages programme (PAR-L3) : deal registrations, fonds marketing (MDF), rebates.
exports.upsertParDealReg = _partenariats.upsertParDealReg;
exports.setParDealRegStatus = _partenariats.setParDealRegStatus;
exports.deleteParDealReg = _partenariats.deleteParDealReg;
exports.upsertParMdf = _partenariats.upsertParMdf;
exports.deleteParMdf = _partenariats.deleteParMdf;
exports.upsertParRebate = _partenariats.upsertParRebate;
exports.deleteParRebate = _partenariats.deleteParRebate;
