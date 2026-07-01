#!/usr/bin/env node
// Chargement de données réelles dans Firestore (seed initial, BUILD_KIT §9).
// Lit un ou plusieurs classeurs (.xlsx), applique l'ingestion idempotente (buildWrites),
// puis recalcule les agrégats. Fonctionne comme le trigger `ingest` mais hors Storage.
//
// Usage :
//   Émulateur : FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=propulse-business-87f7a \
//               node seed/loadData.js ./PIPELINE_NT_CI_Inventory.xlsx ./account.move.xlsx
//   Prod :      GOOGLE_APPLICATION_CREDENTIALS=./sa.json node seed/loadData.js <fichiers...>
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
// Résout les dépendances (xlsx, firebase-admin) depuis le codebase functions.
const freq = createRequire(path.join(__dirname, "../functions/package.json"));
const XLSX = freq("xlsx");
const { initializeApp, applicationDefault, getApp } = freq("firebase-admin/app");
const { getFirestore, FieldValue } = freq("firebase-admin/firestore");
const { getStorage } = freq("firebase-admin/storage");
const { buildWrites, fiscalYearFromOrders } = require("../functions/lib/ingest");
const { recomputeAll } = require("../functions/lib/aggregate");

const projectId = process.env.GCLOUD_PROJECT || "propulse-business-87f7a";
const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const FIRESTORE_DB = process.env.FIRESTORE_DATABASE || "nt360";
initializeApp(useEmulator ? { projectId } : { credential: applicationDefault(), projectId });
const db = getFirestore(getApp(), FIRESTORE_DB);

// Lit un classeur depuis un chemin local OU une URI gs://bucket/clé (via compte de service).
async function readWorkbook(ref) {
  if (ref.startsWith("gs://")) {
    const m = ref.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!m) throw new Error(`URI gs:// invalide : ${ref}`);
    const [buf] = await getStorage().bucket(m[1]).file(m[2]).download();
    return XLSX.read(buf, { cellDates: true });
  }
  return XLSX.read(fs.readFileSync(ref), { cellDates: true });
}

const { enrichBu } = require("../functions/lib/enrich");

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.log("Usage : node seed/loadData.js <fichier.xlsx> [autre.xlsx ...]");
    process.exit(1);
  }

  // Accumulation dédupliquée par _id à travers tous les fichiers.
  const COLLS = ["orders", "invoices", "opportunities", "projectSheets", "bcLines"];
  const store = Object.fromEntries(COLLS.map((c) => [c, new Map()]));
  for (const f of files) {
    const wb = await readWorkbook(f);
    const { kinds, writes, report } = buildWrites(wb);
    for (const w of writes) {
      const i = w.path.indexOf("/");
      const coll = w.path.slice(0, i), id = w.path.slice(i + 1);
      if (store[coll]) store[coll].set(id, w.data);
    }
    await db.collection("imports").add({
      uid: "seed", kinds, filename: path.basename(f), objectKey: `local/${path.basename(f)}`,
      rowsIn: report.rowsIn, rowsOk: report.rowsOk, rowsSkipped: report.rowsSkipped, report,
      ts: FieldValue.serverTimestamp(),
    });
    console.log(`✓ ${path.basename(f)} → [${kinds.join(", ")}] ok ${report.rowsOk}, ignorés ${report.rowsSkipped}`);
  }

  // Fiabilisation : reconstruction BU (jointure FP→orders puis client majoritaire).
  const arr = (c) => [...store[c].values()];
  const fixed = enrichBu({ orders: arr("orders"), invoices: arr("invoices"), opportunities: arr("opportunities") });
  console.log(`✓ BU reconstruite : ${fixed.buFixedInvoices} factures, ${fixed.buFixedOpps} opportunités`);

  // Purge des collections rechargées (état propre : supprime les docs périmés,
  // ex. anciennes opportunités aux ids obsolètes). Ne touche qu'aux collections
  // effectivement présentes dans l'import.
  async function purge(coll) {
    let removed = 0;
    while (true) {
      const snap = await db.collection(coll).limit(400).get();
      if (snap.empty) break;
      const b = db.batch();
      snap.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
      removed += snap.size;
      if (snap.size < 400) break;
    }
    return removed;
  }
  for (const coll of COLLS) {
    if (store[coll].size > 0) {
      const removed = await purge(coll);
      if (removed) console.log(`✓ ${coll} purgé (${removed} anciens docs)`);
    }
  }

  // Commit (dédup garantie par _id).
  let batch = db.batch(), n = 0, total = 0;
  for (const coll of COLLS) {
    for (const [id, data] of store[coll]) {
      batch.set(db.doc(`${coll}/${id}`), data, { merge: true });
      total++;
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
  }
  await batch.commit();
  console.log(`✓ ${total} documents écrits (dédupliqués)`);

  // Ancrage FY + agrégats.
  const currentFy = fiscalYearFromOrders(arr("orders"));
  if (currentFy > 0) await db.doc("config/fiscal").set({ currentFy }, { merge: true });
  const res = await recomputeAll(db);
  console.log(`✓ Agrégats recalculés (FY ${res.currentFy}, périodes ${res.periods.join("/")}) : ${res.written.length} summaries`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("✗", e); process.exit(1); });
