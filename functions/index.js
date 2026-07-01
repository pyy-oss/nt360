// Cloud Functions 2nd gen — Node.js 20 (codebase unique). BUILD_KIT §9, §10, §11, §14.
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");
const XLSX = require("xlsx");

const { IMPORTS_BUCKET } = require("./lib/config");
const { buildWrites, fiscalYearFromOrders } = require("./lib/ingest");

initializeApp();
const db = getFirestore();

// --- F2 : Ingestion SheetJS idempotente (Storage trigger sur gs://nt360) ---
exports.ingest = onObjectFinalized(
  { bucket: IMPORTS_BUCKET, memoryMiB: 1024, timeoutSeconds: 300 },
  async (event) => {
    const { bucket, name } = event.data;
    if (!name || name.endsWith("/")) return; // dossier
    const [buf] = await getStorage().bucket(bucket).file(name).download();
    const wb = XLSX.read(buf, { cellDates: true }); // SheetJS tolère dataValidation mal formé (§18.4)

    const { kind, writes, report } = buildWrites(wb);
    logger.info("ingest", { name, kind, ...report });

    if (kind && writes.length) {
      let batch = db.batch(), n = 0;
      for (const w of writes) {
        batch.set(db.doc(w.path), w.data, { merge: true }); // IDs déterministes ⇒ upsert
        if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
      }
      await batch.commit();
    }

    await db.collection("imports").add({
      uid: null, kind, filename: name, objectKey: `${bucket}/${name}`,
      rowsIn: report.rowsIn ?? 0, rowsOk: report.rowsOk ?? 0, rowsSkipped: report.rowsSkipped ?? 0,
      report, ts: FieldValue.serverTimestamp(),
    });

    if (kind === "pnl" || kind === "fiche") await updateFiscalYearFromOrders();
    await recomputeSummaries(); // F3 : recalcul des agrégats impactés
  }
);

/** Recalcule config/fiscal.currentFy = max(yearPo) des commandes (§7). */
async function updateFiscalYearFromOrders() {
  const snap = await db.collection("orders").select("yearPo").get();
  const currentFy = fiscalYearFromOrders(snap.docs.map((d) => d.data()));
  if (currentFy > 0) await db.doc("config/fiscal").set({ currentFy }, { merge: true });
}

// Recalcul des agrégats — implémenté en F3 (lib/aggregate). Sans-op si absent.
async function recomputeSummaries(only) {
  try {
    const { recomputeAll } = require("./lib/aggregate");
    await recomputeAll(db, only);
  } catch (e) {
    if (e.code !== "MODULE_NOT_FOUND") throw e;
  }
}

// --- setUserRole : pose du rôle (custom claim), admin uniquement (§8) ---
const ROLES = ["direction", "commercial_dir", "commercial", "pmo", "achats", "lecture"];

exports.setUserRole = onCall(async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const { uid, role } = req.data || {};
  if (!uid || !ROLES.includes(role)) throw new HttpsError("invalid-argument", "uid et role (∈ 6 profils) requis");
  await getAuth().setCustomUserClaims(uid, { role });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "perm_change", module: "habilitations",
    entity: "user", entityId: uid, detail: { role }, ts: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// --- logLogin : audit de connexion (critère F1) ---
exports.logLogin = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "login", module: "auth", entity: "session", entityId: req.auth.uid,
    detail: { role: req.auth.token.role || null, email: req.auth.token.email || null },
    ts: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// --- F3 : recalcul des agrégats à la demande (admin) ---
exports.recompute = onCall(async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const { recomputeAll } = require("./lib/aggregate");
  const res = await recomputeAll(db, req.data?.only);
  return { ok: true, ...res };
});

// Exposé pour les tests / réutilisation.
module.exports.IMPORTS_BUCKET = IMPORTS_BUCKET;

// --- Stubs des phases suivantes ---
// exports.syncSalesData  = onSchedule(...)          // F6 : sync Sales_DATA
// exports.exportReport   = onCall(...)              // F7 : export PDF/XLSX → URL signée
// exports.importLegacyBackup = onCall(...)          // migration prototype → Firestore
