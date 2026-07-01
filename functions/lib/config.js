// Config d'exécution des Cloud Functions (BUILD_KIT §3, §9, §13).

// Bucket Cloud Storage pour les imports bruts et les exports générés (gs://nt360).
// Surchargeable par variable d'env. Utilisé par le trigger `ingest` (F2) et `export` (F7).
const IMPORTS_BUCKET = process.env.IMPORTS_BUCKET || "nt360";

// Base Firestore dédiée à nt360 (projet partagé avec une autre app → base nommée
// distincte de "(default)" pour isoler données ET règles). Override émulateur possible.
const FIRESTORE_DB = process.env.FIRESTORE_DATABASE || "nt360";

module.exports = { IMPORTS_BUCKET, FIRESTORE_DB };
