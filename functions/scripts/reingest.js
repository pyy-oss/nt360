// Ré-ingestion en masse depuis un job GitHub Actions (workflow_dispatch) — alternative CI au
// callable `reingest`. Re-parse les classeurs SOURCES déjà présents dans gs://nt360 avec les
// parseurs courants et applique les écritures (upsert `merge:true` → écrase les champs recalculés,
// ex. désignation), puis recalcule les agrégats. Utilise le MÊME module partagé que le callable.
//
// Auth : le service account est fourni via GOOGLE_APPLICATION_CREDENTIALS (fichier JSON), le même
// secret que le déploiement. Aucun jeton utilisateur requis (Admin SDK).
// Env : GOOGLE_APPLICATION_CREDENTIALS (chemin SA), GCLOUD_PROJECT (id projet), REINGEST_PREFIX
// (optionnel : restreint le balayage à un sous-dossier du bucket).
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { IMPORTS_BUCKET, FIRESTORE_DB } = require("../lib/config");
const { reingestBucket } = require("../lib/reingest");

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "propulse-business-87f7a";
const prefix = process.env.REINGEST_PREFIX && process.env.REINGEST_PREFIX.trim() ? process.env.REINGEST_PREFIX.trim() : undefined;

// cert(require(saPath)) charge le JSON du SA ; sans fichier on retombe sur les creds ambiantes (ADC).
const app = initializeApp(saPath ? { credential: cert(require(saPath)), projectId } : { projectId });
const db = getFirestore(app, FIRESTORE_DB); // base nommée nt360 (projet partagé)
db.settings({ ignoreUndefinedProperties: true });
const storage = getStorage(app);

(async () => {
  console.log(`Ré-ingestion — bucket gs://${IMPORTS_BUCKET}${prefix ? `/${prefix}` : ""} · base ${FIRESTORE_DB}`);
  const r = await reingestBucket({ db, storage, bucketName: IMPORTS_BUCKET, prefix });
  // Trace l'opération dans le journal des imports (visible en Admin), comme le callable.
  await db.collection("imports").add({
    uid: null, kinds: r.kinds, filename: `reingest(gha):${prefix || "*"}`, objectKey: `${IMPORTS_BUCKET}/${prefix || ""}`,
    mode: "reingest", rowsIn: r.rowsIn, rowsOk: r.rowsOk, rowsSkipped: r.rowsSkipped, report: r, ts: FieldValue.serverTimestamp(),
  });
  console.log(JSON.stringify({
    objectsScanned: r.objectsScanned, objectsIngested: r.objectsIngested, objectsFailed: r.objectsFailed,
    kinds: r.kinds, rowsIn: r.rowsIn, rowsOk: r.rowsOk, rowsSkipped: r.rowsSkipped,
  }, null, 2));
  for (const f of r.files || []) {
    if (f.error) console.log(`  ✗ ${f.object} — ${f.error}`);
    else console.log(`  ✓ ${f.object} — ${(f.kinds || []).join(", ")} · ${f.rowsOk} l.`);
  }
  process.exit(0);
})().catch((e) => { console.error("Ré-ingestion échouée :", e && e.stack || e); process.exit(1); });
