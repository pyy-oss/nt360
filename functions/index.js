// Cloud Functions 2nd gen — Node.js 20 (codebase unique). BUILD_KIT §9, §10, §11, §14.
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");
const XLSX = require("xlsx");

const { getApp } = require("firebase-admin/app");
const { IMPORTS_BUCKET, FIRESTORE_DB } = require("./lib/config");
const { buildWrites, fiscalYearFromOrders } = require("./lib/ingest");

initializeApp();
// Base Firestore nommée nt360 (projet partagé) — isole données et règles.
const db = getFirestore(getApp(), FIRESTORE_DB);

// --- F2 : Ingestion SheetJS idempotente (Storage trigger sur gs://nt360) ---
// Le déclencheur Storage doit être dans la MÊME région que le bucket. gs://nt360 est en
// dual-region eur4 (non déployable comme région de fonction). Le trigger n'est donc exporté
// que si INGEST_REGION est défini (région alignée sur le bucket) ; sinon l'ingestion passe
// par seed/loadData.js (Admin SDK, sans contrainte de région).
async function ingestHandler(event) {
  const { bucket, name } = event.data;
  if (!name || name.endsWith("/")) return; // dossier
  const [buf] = await getStorage().bucket(bucket).file(name).download();
  const wb = XLSX.read(buf, { cellDates: true }); // SheetJS tolère dataValidation mal formé (§18.4)

  const { kinds, writes, report } = buildWrites(wb);
  logger.info("ingest", { name, kinds, ...report });

  if (writes.length) {
    let batch = db.batch(), n = 0;
    for (const w of writes) {
      batch.set(db.doc(w.path), w.data, { merge: true }); // IDs déterministes ⇒ upsert
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
  }

  await db.collection("imports").add({
    uid: null, kinds, filename: name, objectKey: `${bucket}/${name}`,
    rowsIn: report.rowsIn ?? 0, rowsOk: report.rowsOk ?? 0, rowsSkipped: report.rowsSkipped ?? 0,
    report, ts: FieldValue.serverTimestamp(),
  });

  if (kinds.includes("pnl") || kinds.includes("fiche")) await updateFiscalYearFromOrders();
  await recomputeSummaries(); // F3 : recalcul des agrégats impactés
}

if (process.env.INGEST_REGION) {
  exports.ingest = onObjectFinalized(
    { bucket: IMPORTS_BUCKET, region: process.env.INGEST_REGION, memoryMiB: 1024, timeoutSeconds: 300 },
    ingestHandler
  );
}

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

// --- F6 : Sync Sales_DATA quotidien (Cloud Scheduler) ---
async function runSalesSync(objectKey) {
  const { applySalesSync } = require("./lib/sync");
  const key = objectKey || "sync/sales_data.xlsx";
  const file = getStorage().bucket(IMPORTS_BUCKET).file(key);
  const [exists] = await file.exists();
  if (!exists) { logger.warn("syncSalesData: fichier absent", { key }); return { skipped: true, key }; }
  const [buf] = await file.download();
  const wb = XLSX.read(buf, { cellDates: true });
  const res = await applySalesSync(db, wb);
  const { recomputeAll } = require("./lib/aggregate");
  await recomputeAll(db, ["pipeline", "overview", "backlog", "atterrissage"]);
  logger.info("syncSalesData", res);
  return res;
}

exports.syncSalesData = onSchedule("every day 06:00", async () => {
  await runSalesSync();
});

// Déclenchement manuel (admin) pour test / rejouabilité.
exports.syncSalesDataNow = onCall(async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  return await runSalesSync(req.data?.objectKey);
});

// --- F7 : export one-pager CODIR (XLSX) → Cloud Storage + URL signée ---
exports.exportReport = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  const ExcelJS = require("exceljs");
  const period = req.data?.period || "all";
  const get = async (p) => (await db.doc(p).get()).data() || {};
  const [ov, bl, pl, fiscal] = await Promise.all([
    get(`summaries/overview_${period}`), get("summaries/backlog_fy"),
    get("summaries/pipeline"), get("config/fiscal"),
  ]);
  const att = await get(`summaries/atterrissage_${fiscal.currentFy || ""}`);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CODIR");
  ws.addRow(["Pilote Revenu NT CI — One-pager CODIR"]);
  ws.addRow(["Période", period, "FY", fiscal.currentFy || ""]);
  ws.addRow([]);
  ws.addRow(["Indicateur", "Valeur"]);
  [
    ["Certitudes", ov.certitudes], ["Commandes (CAS)", ov.commandes], ["Facturé", ov.facture],
    ["Backlog (RAF)", bl.total], ["Marge brute", ov.mb], ["Taux facturation", ov.ratios?.tauxFacturation],
    ["Pipeline actif pondéré", pl.tot?.weighted], ["Atterrissage projeté", att.projete],
    ["Objectif CAS", att.objectif], ["Écart", att.ecart],
  ].forEach((r) => ws.addRow(r));

  const buf = await wb.xlsx.writeBuffer();
  const key = `exports/codir_${period}_${Date.now()}.xlsx`;
  const file = getStorage().bucket(IMPORTS_BUCKET).file(key);
  await file.save(Buffer.from(buf), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "export", module: "overview", entity: "codir", entityId: key,
    detail: { period }, ts: FieldValue.serverTimestamp(),
  });
  let url = null;
  try {
    [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 3600 * 1000 });
  } catch (e) {
    logger.warn("getSignedUrl indisponible (émulateur ?)", { msg: e.message });
  }
  return { ok: true, objectKey: `${IMPORTS_BUCKET}/${key}`, url };
});

// --- Migration prototype → Firestore (BUILD_KIT §13) ---
exports.importLegacyBackup = onCall(async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const b = req.data?.backup || {};
  const { safeId } = require("./lib/sheets");
  const writes = [];
  const push = (path, data) => writes.push({ path, data });
  (b.uorders || []).forEach((o) => o.fp && push(`orders/${safeId(o.fp)}`, { ...o, source: o.source || "legacy" }));
  (b.uinv || []).forEach((i) => i.numero && push(`invoices/${safeId(i.numero)}`, { ...i, source: "legacy" }));
  (b.objectives || []).forEach((o, idx) => push(`objectives/${o.fiscalYear || 0}_${o.scope || "global"}_${o.scopeValue || idx}`, o));
  (b.lines || []).forEach((c) => c.id && push(`creditLines/${safeId(c.id)}`, c));
  (b.fiches || []).forEach((f) => f.fp && push(`projectSheets/${safeId(f.fp)}`, { ...f, source: "legacy" }));
  (b.pipeOpps || []).forEach((o, idx) => push(`opportunities/${o.oppId ? safeId(o.oppId) : "legacy_" + idx}`, { ...o, source: o.source || "salesData" }));

  let batch = db.batch(), n = 0;
  for (const w of writes) { batch.set(db.doc(w.path), w.data, { merge: true }); if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); } }
  await batch.commit();
  const { recomputeAll } = require("./lib/aggregate");
  await recomputeAll(db);
  return { ok: true, written: writes.length };
});

// --- F8 : export Firestore managé planifié → gs://nt360/backups/ (sauvegarde) ---
exports.scheduledFirestoreExport = onSchedule("every sunday 03:00", async () => {
  const firestore = require("@google-cloud/firestore");
  const client = new firestore.v1.FirestoreAdminClient();
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "propulse-business-87f7a";
  const ts = new Date().toISOString().slice(0, 10);
  const name = client.databasePath(projectId, FIRESTORE_DB);
  const [op] = await client.exportDocuments({
    name,
    outputUriPrefix: `gs://${IMPORTS_BUCKET}/backups/${ts}`,
    collectionIds: [], // toutes les collections
  });
  logger.info("scheduledFirestoreExport lancé", { op: op.name });
  return { ok: true };
});

// Exposé pour les tests / réutilisation.
module.exports.IMPORTS_BUCKET = IMPORTS_BUCKET;
