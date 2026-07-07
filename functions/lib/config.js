// Config d'exécution des Cloud Functions (BUILD_KIT §3, §9, §13).

// Bucket Cloud Storage pour les imports bruts et les exports générés (gs://nt360).
// Surchargeable par variable d'env. Utilisé par le trigger `ingest` (F2) et `export` (F7).
const IMPORTS_BUCKET = process.env.IMPORTS_BUCKET || "nt360";

// Base Firestore dédiée à nt360 (projet partagé avec une autre app → base nommée
// distincte de "(default)" pour isoler données ET règles). Override émulateur possible.
const FIRESTORE_DB = process.env.FIRESTORE_DATABASE || "nt360";

// Bucket des SAUVEGARDES Firestore planifiées (F8). Idéalement un bucket DÉDIÉ (rétention/lifecycle
// propres, isolé du bucket d'imports scanné/ré-ingéré → pas de blast-radius partagé). Par défaut = bucket
// d'imports (comportement historique, non bloquant) ; ops pointe BACKUP_BUCKET vers p.ex. « nt360-backups »
// UNE FOIS ce bucket + sa règle de rétention provisionnés (sinon l'export échoue sur un bucket inexistant).
const BACKUP_BUCKET = process.env.BACKUP_BUCKET || IMPORTS_BUCKET;

module.exports = { IMPORTS_BUCKET, FIRESTORE_DB, BACKUP_BUCKET };
