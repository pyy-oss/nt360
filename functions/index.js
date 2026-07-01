// Cloud Functions 2nd gen — Node.js 20 (codebase unique). BUILD_KIT §9, §14.
// F0 : socle + setUserRole (bootstrap 1er admin). ingest/aggregate/syncSalesData/export
// sont câblés aux phases suivantes (F2/F3/F6/F7) — voir stubs en bas de fichier.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const { parsePnl } = require("./parsers/pnl");
const { parseFiche } = require("./parsers/ficheAffaire");
const { parseFacturationDf } = require("./parsers/facturationDf");
const { parseSalesData } = require("./parsers/salesData");

initializeApp();
const db = getFirestore();

// Table des parseurs par type de source détecté (§9).
const PARSERS = {
  pnl: parsePnl,
  facturationDf: parseFacturationDf,
  fiche: parseFiche,
  salesData: parseSalesData,
};

/** Référence de document déterministe par type (idempotence, §9). */
function docRef(kind, r) {
  return {
    pnl: () => db.doc(`orders/${r._id}`),
    facturationDf: () => db.doc(`invoices/${r._id}`),
    fiche: () => db.doc(`projectSheets/${r._id}`),
    salesData: () => db.doc(`opportunities/${r._id}`),
  }[kind]();
}

/** Détection du type de source par signatures de colonnes/cellules (§9). TODO(F2). */
function detectKind(/* wb */) {
  throw new HttpsError("unimplemented", "detectKind câblé en F2");
}

// --- setUserRole : pose du rôle (custom claim), admin uniquement (§8) ---
const ROLES = ["direction", "commercial_dir", "commercial", "pmo", "achats", "lecture"];

exports.setUserRole = onCall(async (req) => {
  if (req.auth?.token?.role !== "direction") {
    throw new HttpsError("permission-denied", "admin requis");
  }
  const { uid, role } = req.data || {};
  if (!uid || !ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", "uid et role (∈ 6 profils) requis");
  }
  await getAuth().setCustomUserClaims(uid, { role });
  await db.collection("auditLog").add({
    uid: req.auth.uid,
    action: "perm_change",
    module: "habilitations",
    entity: "user",
    entityId: uid,
    detail: { role },
    ts: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// Exposés pour les tests unitaires des parseurs (§18) sans démarrer les Functions.
module.exports.PARSERS = PARSERS;
module.exports.docRef = docRef;
module.exports.detectKind = detectKind;

// --- Stubs des phases suivantes (BUILD_KIT §9, §10, §11) ---
// exports.ingest         = onObjectFinalized(...)   // F2 : ingestion SheetJS idempotente
// exports.aggregate      = onDocumentWritten(...)   // F3 : recalcul summaries/*
// exports.syncSalesData  = onSchedule("every day 06:00", ...)  // F6 : sync Sales_DATA
// exports.export         = onCall(...)              // F7 : export PDF/XLSX → URL signée
// exports.importLegacyBackup = onCall(...)          // migration prototype → Firestore
