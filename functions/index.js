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
// Filet de sécurité global : un seul champ `undefined` dans un document écrit fait échouer
// TOUT le batch (« Cannot use undefined as a Firestore value »), donc tout le recompute. On
// demande à Firestore d'ignorer les champs undefined (ils sont simplement omis) — les défauts
// explicites côté domaine restent la 1re ligne de défense ; ceci évite qu'un oubli ne brique
// à nouveau un recalcul entier.
db.settings({ ignoreUndefinedProperties: true });

// --- F2 : Ingestion SheetJS idempotente (Storage trigger sur gs://nt360) ---
// Le déclencheur Storage doit être dans la MÊME région que le bucket. gs://nt360 est en
// dual-region eur4 (non déployable comme région de fonction). Le trigger n'est donc exporté
// que si INGEST_REGION est défini (région alignée sur le bucket) ; sinon l'ingestion passe
// par seed/loadData.js (Admin SDK, sans contrainte de région).
// Applique un lot d'écritures {path,data} : déduplication par chemin (fusion des champs, dernier
// gagne — utile en import ZIP multi-classeurs), upsert par batch, puis NETTOYAGE des lignes BC de
// fiche devenues orphelines (une fiche régénère toutes ses lignes ; si le ré-import en compte moins,
// les anciennes lignes de fin resteraient et gonfleraient l'exposition). Fail-safe : si une fiche
// ne produit AUCUNE ligne, son FP n'est pas dans keepByFp → aucune suppression. Filtre par `fp`
// seul (pas d'index composite) + garde `source === "fiche"` en mémoire → ne touche jamais les
// lignes logistics/unitaires/manuelles. Partagé par importDelta ET le trigger Storage.
async function applyWrites(writes) {
  const byPath = new Map();
  for (const w of writes) byPath.set(w.path, { ...(byPath.get(w.path) || {}), ...w.data });
  if (byPath.size) {
    let batch = db.batch(), n = 0;
    for (const [path, data] of byPath) {
      batch.set(db.doc(path), data, { merge: true }); // IDs déterministes ⇒ upsert
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
  }
  const keepByFp = new Map();
  for (const [path, data] of byPath) {
    if (path.startsWith("bcLines/") && data.source === "fiche" && data.fp) {
      (keepByFp.get(data.fp) || keepByFp.set(data.fp, new Set()).get(data.fp)).add(path.slice("bcLines/".length));
    }
  }
  for (const [fp, keep] of keepByFp) {
    const snap = await db.collection("bcLines").where("fp", "==", fp).get();
    const stale = snap.docs.filter((d) => d.get("source") === "fiche" && !keep.has(d.id));
    for (let i = 0; i < stale.length; i += 400) {
      const batch = db.batch();
      stale.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
}

async function ingestHandler(event) {
  const { bucket, name } = event.data;
  if (!name || name.endsWith("/")) return; // dossier
  const [buf] = await getStorage().bucket(bucket).file(name).download();
  const wb = XLSX.read(buf, { cellDates: true }); // SheetJS tolère dataValidation mal formé (§18.4)

  const { kinds, writes, report } = buildWrites(wb);
  logger.info("ingest", { name, kinds, ...report });

  await applyWrites(writes); // upsert + nettoyage des orphelins de fiche (voir applyWrites)

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
// Ressources alignées sur importDelta : recomputeAll lit TOUTES les collections et reconstruit
// tous les summaries (boucle sur chaque période) — le défaut 256 MiB / 60 s provoquait un
// timeout/OOM sur un gros volume, surfacé en « Action refusée » côté UI, alors que le même
// recompute lancé APRÈS un import (512 MiB / 300 s) réussissait.
exports.recompute = onCall({ memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const { recomputeAll } = require("./lib/aggregate");
  try {
    const res = await recomputeAll(db, req.data?.only);
    return { ok: true, ...res };
  } catch (e) {
    // Sans ce wrap, une exception non-HttpsError est renvoyée au client en « internal » SANS
    // message (masqué par sécurité). On journalise la stack complète et on re-propage le motif
    // réel pour qu'il soit diagnosticable côté UI.
    logger.error("recompute a échoué", { message: e && e.message, stack: e && e.stack });
    throw new HttpsError("internal", `recompute : ${(e && e.message) || e}`);
  }
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
  await recomputeAll(db); // recalcul complet : une opp gagnée peut devenir commande (CAS/backlog/rentabilité)
  logger.info("syncSalesData", res);
  return res;
}

exports.syncSalesData = onSchedule("every day 06:00", async () => {
  await runSalesSync();
});

// Déclenchement manuel (admin) pour test / rejouabilité. Même recompute complet → mêmes ressources.
exports.syncSalesDataNow = onCall({ memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  return await runSalesSync(req.data?.objectKey);
});

// --- Import de delta à la demande : fichier XLSX (modèle Facturation DF / P&L / LIVE)
// envoyé en base64 par l'UI. Réutilise le parsing testé (buildWrites), upsert idempotent
// par ID déterministe (un delta partiel se fusionne), journalise puis recalcule. ---
const IMPORT_ROLES = ["direction", "commercial_dir", "pmo", "achats"];

exports.importDelta = onCall({ memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!IMPORT_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit d'import requis");
  const b64 = req.data?.fileB64;
  const filename = String(req.data?.filename || "delta.xlsx");
  if (!b64 || typeof b64 !== "string") throw new HttpsError("invalid-argument", "fichier requis (fileB64)");
  const buf = Buffer.from(b64, "base64");

  // Un import peut être : un XLSX (éventuellement multi-onglets), OU un ZIP de plusieurs
  // classeurs (import groupé de fiches affaire). On agrège écritures et rapports par fichier.
  const kindsSet = new Set();
  const writes = [];
  const files = [];
  let rowsIn = 0, rowsOk = 0, rowsSkipped = 0;
  const processWb = (wb, name) => {
    const r = buildWrites(wb);
    if (!r.kinds.length) { files.push({ file: name, error: "aucune source reconnue" }); return; }
    r.kinds.forEach((k) => kindsSet.add(k));
    writes.push(...r.writes);
    rowsIn += r.report.rowsIn || 0; rowsOk += r.report.rowsOk || 0; rowsSkipped += r.report.rowsSkipped || 0;
    files.push({ file: name, kinds: r.kinds, rowsOk: r.report.rowsOk || 0, byKind: r.report.byKind });
  };

  if (/\.zip$/i.test(filename)) {
    const { unzipSync } = require("fflate");
    let entries;
    try { entries = unzipSync(new Uint8Array(buf)); }
    catch (e) { throw new HttpsError("invalid-argument", "ZIP illisible"); }
    const names = Object.keys(entries).filter((n) => {
      const base = n.split("/").pop() || n;
      return /\.xlsx?$/i.test(base) && !n.startsWith("__MACOSX/") && !base.startsWith("~$");
    });
    if (!names.length) throw new HttpsError("failed-precondition", "aucun classeur XLSX dans le ZIP");
    for (const n of names) {
      let wb;
      try { wb = XLSX.read(Buffer.from(entries[n]), { cellDates: true }); }
      catch (e) { files.push({ file: n, error: "classeur illisible" }); continue; }
      processWb(wb, n);
    }
  } else {
    let wb;
    try { wb = XLSX.read(buf, { cellDates: true }); }
    catch (e) { throw new HttpsError("invalid-argument", "fichier illisible (XLSX ou ZIP attendu)"); }
    processWb(wb, filename);
  }

  const kinds = [...kindsSet];
  if (!kinds.length) throw new HttpsError("failed-precondition", "aucune source reconnue dans le fichier");

  await applyWrites(writes); // dédup par chemin + upsert + nettoyage des orphelins de fiche (voir applyWrites)

  const report = { kinds, files, rowsIn, rowsOk, rowsSkipped };
  await db.collection("imports").add({
    uid: req.auth.uid, kinds, filename, objectKey: null, mode: "delta",
    rowsIn, rowsOk, rowsSkipped, report, ts: FieldValue.serverTimestamp(),
  });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "import_delta", module: "facturation", entity: "delta", entityId: filename,
    detail: { kinds, rowsOk, files: files.length }, ts: FieldValue.serverTimestamp(),
  });

  if (kinds.includes("pnl") || kinds.includes("fiche")) await updateFiscalYearFromOrders();
  await recomputeSummaries();
  // `files` = détail PAR fichier (kinds reconnus, lignes OK, erreur éventuelle, byKind) — permet à
  // l'UI d'afficher précisément ce qui a été reconnu et la cause d'un éventuel échec par classeur.
  return { ok: true, kinds, rowsIn, rowsOk, rowsSkipped, fileCount: files.length, files };
});

// --- Fiabilisation : rattacher une facture ORPHELINE à sa commande en corrigeant son N° FP.
// Recalcule ensuite (rattachement, taux de facturation, RAF dérivé des commandes opp/fiche). ---
exports.setInvoiceFp = onCall({ memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!IMPORT_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit d'import/données requis");
  const { fpKey } = require("./lib/ids");
  const id = String(req.data?.id || "");
  if (!id) throw new HttpsError("invalid-argument", "id facture requis");
  const fp = fpKey(req.data?.fp) || null;
  if (!fp) throw new HttpsError("invalid-argument", "N° FP invalide (attendu FP/AAAA/NNNNN)");
  const ref = db.doc(`invoices/${id}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "facture introuvable");
  await ref.set({ fp, linked: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "set_invoice_fp", module: "facturation", entity: "invoice", entityId: id,
    detail: { fp }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries();
  return { ok: true, id, fp };
});

// --- Fiabilisation : corriger une commande P&L — année de PO manquante et/ou N° FP erroné.
// Le doc `orders` est clé par le FP ; corriger le FP = ré-clé (copie + suppression). Recalcule. ---
exports.patchOrder = onCall({ memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!IMPORT_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit d'import/données requis");
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const d = req.data || {};
  const fp = fpKey(d.fp);
  if (!fp) throw new HttpsError("invalid-argument", "N° FP de la commande requis");
  const ref = db.doc(`orders/${safeId(fp)}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "commande P&L introuvable (opp gagnée / fiche : corriger à la source)");

  const patch = {};
  if (d.yearPo != null && String(d.yearPo) !== "") {
    const y = Math.trunc(Number(d.yearPo)) || 0;
    if (y < 2015 || y > new Date().getFullYear() + 3) throw new HttpsError("invalid-argument", "année de PO invalide");
    patch.yearPo = y;
  }
  const newFp = d.newFp ? fpKey(d.newFp) : null;
  if (d.newFp && !newFp) throw new HttpsError("invalid-argument", "nouveau N° FP invalide");

  if (newFp && newFp !== fp) {
    // Ré-clé : le FP est la clé de jointure (factures, BC…). On copie sous le nouveau FP puis supprime.
    const newId = safeId(newFp);
    await db.doc(`orders/${newId}`).set({ ...snap.data(), ...patch, _id: newId, fp: newFp, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await ref.delete();
  } else if (Object.keys(patch).length) {
    await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } else {
    throw new HttpsError("invalid-argument", "rien à modifier (année ou nouveau FP requis)");
  }
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "patch_order", module: "overview", entity: "order", entityId: safeId(fp),
    detail: { fp, newFp: newFp || null, yearPo: patch.yearPo ?? null }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries();
  return { ok: true, fp: newFp || fp };
});

// --- Ajout unitaire d'un BC fournisseur (mode « Unitaire / PDF ») : une ligne bcLines,
// PDF joint stocké pour traçabilité. ID déterministe (clés métier) ⇒ ré-envoi idempotent. ---
// --- Saisie / édition d'opportunités (source 'saisie') en onCall : RECALCULE ensuite les
// agrégats pipeline, sinon l'opp restait invisible des summaries jusqu'au recompute admin/quotidien. ---
const PIPELINE_WRITE_ROLES = ["direction", "commercial_dir", "commercial"];

exports.upsertOpportunity = onCall({ memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!PIPELINE_WRITE_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit pipeline requis");
  const { fpKey } = require("./lib/ids");
  const { DEFAULT_PROBA, STAGE_LABEL } = require("./parsers/salesData");
  const d = req.data || {};
  const client = String(d.client || "").trim();
  if (!client) throw new HttpsError("invalid-argument", "client requis");
  const stage = Math.min(9, Math.max(1, Math.trunc(Number(d.stage)) || 1));
  const amount = Number(d.amount) || 0;
  // Proba : valeur fournie (0..1) sinon défaut de l'étape — évite un pondéré à 0 par oubli.
  const pr = Number(d.probability);
  const probability = pr > 0 && pr <= 1 ? pr : (DEFAULT_PROBA[stage] ?? 0);
  // Édition : id fourni préfixé « saisie_ » ; sinon nouvelle saisie. On ne touche QUE les saisies.
  const id = (typeof d.id === "string" && d.id.startsWith("saisie_")) ? d.id
    : ("saisie_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const doc = {
    oppId: id, source: "saisie",
    client, am: String(d.am || "").trim(), bu: String(d.bu || "AUTRE").trim().toUpperCase(),
    fp: fpKey(d.fp) || null,
    amount, stage, stageLabel: STAGE_LABEL[stage] || String(stage),
    probability, weighted: amount * probability,
    closingDate: d.closingDate || null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.doc(`opportunities/${id}`).set(doc, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "upsert_opp", module: "pipeline", entity: "opportunity", entityId: id,
    detail: { client, stage, fp: doc.fp }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(); // saisie occasionnelle → recalcul complet (l'opp peut devenir commande, etc.)
  return { ok: true, id };
});

exports.deleteOpportunity = onCall({ memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!PIPELINE_WRITE_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit pipeline requis");
  const id = String(req.data?.id || "");
  if (!id.startsWith("saisie_")) throw new HttpsError("failed-precondition", "seules les opportunités saisies sont supprimables");
  await db.doc(`opportunities/${id}`).delete();
  await recomputeSummaries(); // saisie occasionnelle → recalcul complet (l'opp peut devenir commande, etc.)
  return { ok: true };
});

const BC_WRITE_ROLES = ["direction", "pmo", "achats"];
const BC_STAGES = ["a_emettre", "emis", "livre", "facture", "solde"];

exports.addBcLine = onCall({ memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!BC_WRITE_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit BC requis");
  const { fpKey } = require("./lib/ids");
  const { hashId } = require("./lib/sheets");
  const f = req.data?.fields || {};
  const supplier = String(f.supplier || "").replace(/\s+/g, " ").trim().toUpperCase();
  const bcNumber = String(f.bcNumber || "").replace(/\s+/g, " ").trim();
  if (!supplier && !bcNumber) throw new HttpsError("invalid-argument", "fournisseur ou n° BC requis");

  const fp = fpKey(f.fp) || null;
  const description = String(f.description || "").trim();
  const status = BC_STAGES.includes(f.status) ? f.status : "a_emettre";
  const amount = Number(f.amount) || 0;
  const id = "bc_" + hashId(fp, bcNumber, supplier, description);
  const doc = {
    fp, bcNumber, supplier,
    customer: String(f.customer || "").replace(/\s+/g, " ").trim().toUpperCase(),
    country: String(f.country || "").trim(),
    expenseType: String(f.expenseType || "").trim(),
    description,
    currency: String(f.currency || "XOF").trim() || "XOF",
    amount,
    amountXof: Number(f.amountXof) || amount,
    status, statusRaw: String(f.statusRaw || status),
    dateIn: f.dateIn || null,
    source: "bc_unitaire",
    updatedAt: FieldValue.serverTimestamp(),
  };

  let pdfKey = null;
  if (req.data?.pdfB64) {
    try {
      pdfKey = `bc/${id}.pdf`;
      await getStorage().bucket(IMPORTS_BUCKET).file(pdfKey).save(Buffer.from(req.data.pdfB64, "base64"), { contentType: "application/pdf" });
      doc.pdfKey = `${IMPORTS_BUCKET}/${pdfKey}`;
    } catch (e) {
      logger.warn("addBcLine: PDF non stocké", { msg: e.message }); pdfKey = null;
    }
  }

  await db.doc(`bcLines/${id}`).set(doc, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "add_bc", module: "bc", entity: "bcLine", entityId: id,
    detail: { bcNumber, supplier, fp }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(["suppliers", "alerts"]);
  return { ok: true, id, pdfStored: !!pdfKey };
});

// --- Écritures BC / crédit fournisseur en onCall : elles RECALCULENT ensuite les agrégats
// (suppliers + alerts), sinon l'exposition et les alertes restaient périmées jusqu'au
// « Recalculer » manuel. Le rôle est revérifié côté serveur. ---
exports.setBcStatus = onCall({ memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!BC_WRITE_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit BC requis");
  const { id, status } = req.data || {};
  if (!id || !BC_STAGES.includes(status)) throw new HttpsError("invalid-argument", "id + statut (∈ cycle BC) requis");
  await db.doc(`bcLines/${id}`).set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "bc_status", module: "bc", entity: "bcLine", entityId: id,
    detail: { status }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(["suppliers", "alerts"]);
  return { ok: true };
});

// --- Fiabilisation d'une ligne BC réelle : rattacher un N° FP et/ou corriger le montant XOF
// (ex. BC en devise étrangère non convertie → montant 0). Recalcule exposition + décaissements. ---
exports.patchBcLine = onCall({ memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!BC_WRITE_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit BC requis");
  const { fpKey } = require("./lib/ids");
  const { id, fp, amountXof } = req.data || {};
  if (!id) throw new HttpsError("invalid-argument", "id requis");
  const patch = { updatedAt: FieldValue.serverTimestamp() };
  if (fp !== undefined) patch.fp = fpKey(fp) || null; // rattachement (ou détachement si vide)
  if (amountXof !== undefined && amountXof !== null && amountXof !== "") {
    const n = Number(amountXof);
    if (!Number.isFinite(n) || n < 0) throw new HttpsError("invalid-argument", "montant XOF invalide");
    patch.amountXof = n;
  }
  if (Object.keys(patch).length <= 1) throw new HttpsError("invalid-argument", "rien à corriger (FP ou montant)");
  await db.doc(`bcLines/${id}`).set(patch, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "bc_patch", module: "bc", entity: "bcLine", entityId: id,
    detail: { fp: patch.fp, amountXof: patch.amountXof }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(["suppliers", "alerts", "cashflow"]);
  return { ok: true };
});

const SUPPLIER_WRITE_ROLES = ["direction", "achats"];
exports.upsertCreditLine = onCall({ memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!SUPPLIER_WRITE_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit fournisseurs requis");
  // id = nom du fournisseur en MAJUSCULES (clé d'appariement avec l'exposition, cf. domain/fournisseurs).
  const id = String(req.data?.id || "").trim().toUpperCase();
  if (!id) throw new HttpsError("invalid-argument", "fournisseur requis");
  await db.doc(`creditLines/${id}`).set({
    name: id, authorized: Number(req.data?.authorized) || 0, outstanding: Number(req.data?.outstanding) || 0,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "credit_line", module: "fournisseurs", entity: "creditLine", entityId: id,
    detail: { authorized: req.data?.authorized, outstanding: req.data?.outstanding }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(["suppliers", "alerts"]);
  return { ok: true };
});

// --- Analyse d'un BC fournisseur PDF (mode « Unitaire ») : extrait le texte (pdfjs) puis
// mappe les champs (best-effort) pour PRÉ-REMPLIR le formulaire. L'utilisateur confirme
// avant enregistrement via addBcLine. Ne persiste rien. ---
exports.parseBcPdf = onCall({ memoryMiB: 1024, timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!BC_WRITE_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit BC requis");
  const b64 = req.data?.pdfB64;
  if (!b64 || typeof b64 !== "string") throw new HttpsError("invalid-argument", "PDF requis (pdfB64)");
  const { extractPdfText, parseBcText } = require("./parsers/bcPdf");
  let text;
  try {
    text = await extractPdfText(Buffer.from(b64, "base64"));
  } catch (e) {
    logger.warn("parseBcPdf: extraction échouée", { msg: e.message });
    throw new HttpsError("failed-precondition", "PDF illisible (texte non extractible)");
  }
  const fields = parseBcText(text);
  return { ok: true, fields };
});

// --- Dédoublonnage (admin) : factures / opportunités / BC fournisseurs. Regroupe par clé
// métier, garde le meilleur représentant, supprime les autres. `apply:false` = analyse seule. ---
exports.dedupe = onCall({ memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const { planDedupe, invoiceKey, opportunityKey, bcKey } = require("./domain/dedupe");
  const KEYS = { invoices: invoiceKey, opportunities: opportunityKey, bcLines: bcKey };
  const only = (Array.isArray(req.data?.collections) ? req.data.collections : Object.keys(KEYS)).filter((c) => KEYS[c]);
  const apply = req.data?.apply !== false; // défaut : applique (l'UI propose une analyse préalable)

  const result = {};
  const toDelete = [];
  for (const col of only) {
    const snap = await db.collection(col).get();
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const plan = planDedupe(docs, KEYS[col]);
    result[col] = { total: plan.total, duplicateGroups: plan.duplicateGroups, duplicates: plan.duplicates };
    if (apply) plan.remove.forEach((id) => toDelete.push(`${col}/${id}`));
  }

  if (apply && toDelete.length) {
    let batch = db.batch(), nB = 0;
    for (const path of toDelete) {
      batch.delete(db.doc(path));
      if (++nB % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "dedupe", module: "habilitations", entity: "collections",
      entityId: only.join(","), detail: result, ts: FieldValue.serverTimestamp(),
    });
    await recomputeSummaries();
  }
  return { ok: true, applied: apply, result };
});

// --- F7 : export one-pager CODIR (XLSX) → Cloud Storage + URL signée ---
// Le one-pager CODIR contient des données financières (P&L, atterrissage) → réservé aux
// profils habilités à la rentabilité (direction / commercial_dir / lecture), pas à tout compte.
const EXPORT_ROLES = ["direction", "commercial_dir", "lecture"];
exports.exportReport = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!EXPORT_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit de rapport requis");
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
