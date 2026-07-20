// Ré-ingestion : parse un tampon (XLSX ou ZIP de classeurs) en écritures, et re-parse en masse
// les fichiers sources déjà présents dans le bucket d'imports (gs://nt360) SANS re-upload.
// Utile après une évolution de parseur (ex. nouvel en-tête reconnu) : `applyWrites` faisant un
// upsert `merge:true`, un re-passage ÉCRASE les champs recalculés (ex. désignation) sur les
// enregistrements existants. Partagé par le callable `reingest` et le script GHA.
const { readWorkbook } = require("./xlsxRead");
const { buildWrites, fiscalYearFromOrders } = require("./ingest");
const { applyWrites, stripLiveOpps } = require("./apply");

// Gardes anti-abus (mêmes valeurs que l'import delta) — bornent le travail par classeur/ZIP.
const MAX_SHEETS = 60;                     // onglets par classeur
const MAX_ZIP_ENTRIES = 100;               // classeurs par ZIP
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;  // décompressé par classeur
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // décompressé cumulé sur le ZIP

// Erreur d'ingestion portant un code type HttpsError, pour un mapping propre côté callable
// (le script GHA se contente du message). Distingue « entrée invalide » d'un bug serveur.
class IngestError extends Error {
  constructor(code, message) { super(message); this.name = "IngestError"; this.code = code; }
}

/**
 * Parse un tampon (XLSX unique ou ZIP de classeurs) en écritures Firestore déterministes.
 * Ne lève QUE sur entrée fatale (illisible, ZIP-bombe, ZIP vide) ; un classeur sans source
 * reconnue est simplement reporté dans `files[].error` (kinds peut être vide → le caller décide).
 * @returns {{kinds:string[], writes:object[], files:object[], rowsIn:number, rowsOk:number, rowsSkipped:number}}
 */
async function parseBuffer(buf, filename) {
  const kindsSet = new Set();
  const writes = [];
  const files = [];
  let rowsIn = 0, rowsOk = 0, rowsSkipped = 0;
  const processWb = (wb, name) => {
    // Garde-fou : un classeur à des milliers d'onglets ferait autant de parses → timeout/OOM.
    if ((wb.SheetNames && wb.SheetNames.length || 0) > MAX_SHEETS) { files.push({ file: name, error: `trop d'onglets (> ${MAX_SHEETS})` }); return; }
    const r = buildWrites(wb);
    if (!r.kinds.length) { files.push({ file: name, error: "aucune source reconnue" }); return; }
    r.kinds.forEach((k) => kindsSet.add(k));
    writes.push(...r.writes);
    rowsIn += r.report.rowsIn || 0; rowsOk += r.report.rowsOk || 0; rowsSkipped += r.report.rowsSkipped || 0;
    files.push({ file: name, kinds: r.kinds, rowsOk: r.report.rowsOk || 0, byKind: r.report.byKind });
  };

  if (/\.zip$/i.test(filename)) {
    const { unzipSync } = require("fflate");
    // Anti-BOMBE DE DÉCOMPRESSION : le `filter` de fflate décide AVANT décompression (via la taille
    // déclarée `originalSize`) : on n'ouvre que les .xlsx, on plafonne la taille décompressée PAR
    // classeur, le CUMUL et le NOMBRE de classeurs — les entrées au-delà ne sont pas décompressées.
    let total = 0, count = 0, truncated = false, entries;
    try {
      entries = unzipSync(new Uint8Array(buf), { filter: (f) => {
        const base = (f.name.split("/").pop() || f.name);
        if (!/\.xlsx?$/i.test(base) || f.name.startsWith("__MACOSX/") || base.startsWith("~$")) return false;
        const sz = f.originalSize || 0;
        if (sz > MAX_ENTRY_BYTES || count + 1 > MAX_ZIP_ENTRIES || total + sz > MAX_TOTAL_BYTES) { truncated = true; return false; }
        count += 1; total += sz; return true;
      } });
    } catch (e) { throw new IngestError("invalid-argument", "ZIP illisible"); }
    if (truncated) throw new IngestError("failed-precondition", `ZIP trop volumineux (bombe de décompression ?) : max ${MAX_ZIP_ENTRIES} classeurs, ${MAX_ENTRY_BYTES / 1048576} Mo/classeur, ${MAX_TOTAL_BYTES / 1048576} Mo cumulés — divise l'import.`);
    const names = Object.keys(entries);
    if (!names.length) throw new IngestError("failed-precondition", "aucun classeur XLSX dans le ZIP");
    for (const n of names) {
      let wb;
      try { wb = await readWorkbook(Buffer.from(entries[n])); }
      catch (e) { files.push({ file: n, error: "classeur illisible" }); continue; }
      // Isolation PAR FICHIER : un classeur au format inattendu ne casse pas l'import entier.
      try { processWb(wb, n); }
      catch (e) { files.push({ file: n, error: "parsing impossible" }); }
    }
  } else {
    let wb;
    try { wb = await readWorkbook(buf); }
    catch (e) { throw new IngestError("invalid-argument", "fichier illisible (XLSX ou ZIP attendu)"); }
    processWb(wb, filename);
  }

  return { kinds: [...kindsSet], writes, files, rowsIn, rowsOk, rowsSkipped };
}

// N'ingère que les classeurs SOURCES du bucket. Exclut les sous-dossiers de service (sauvegardes,
// exports, PDF de BC) et les fichiers temporaires Excel (~$…). Un objet non reconnu par les
// parseurs est de toute façon ignoré (kinds vide), mais ce filtre évite de télécharger l'inutile.
const SOURCE_RE = /\.(xlsx?|zip)$/i;
const SKIP_PREFIXES = ["backups/", "exports/", "bc/", "bc-pdf/", "pdf/"];

function isSourceObject(name) {
  if (!name || name.endsWith("/")) return false;
  if (!SOURCE_RE.test(name)) return false;
  const base = name.split("/").pop() || name;
  if (base.startsWith("~$")) return false;
  return !SKIP_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Re-parse en masse les fichiers sources du bucket d'imports et applique les écritures, puis
 * réancre l'exercice fiscal (si P&L/fiche) et recalcule les agrégats.
 * @param {{db:object, storage:object, bucketName:string, prefix?:string}} o
 *   `storage` : instance Storage exposant `.bucket(name).getFiles()` et `file.download()`.
 * @returns {Promise<object>} rapport agrégé (objets scannés/ingérés/échoués, kinds, lignes, détail).
 */
async function reingestBucket({ db, storage, bucketName, prefix }) {
  const [objs] = await storage.bucket(bucketName).getFiles(prefix ? { prefix } : {});
  // Tri par date de mise à jour CROISSANTE (le plus récent traité en DERNIER) : `applyWrites` étant
  // « dernier gagne » par chemin, sans ce tri l'ordre LEXICOGRAPHIQUE de GCS décidait du gagnant — un
  // ancien classeur (« archive_P&L_2025.xlsx ») pouvait ressusciter des CAS/RAF périmés sur tout le
  // carnet (cf. audit intégrité P1-7). Repli sur le nom si la métadonnée de date est absente.
  const mtime = (o) => Date.parse((o.metadata && (o.metadata.updated || o.metadata.timeCreated)) || "") || 0;
  const targets = objs
    .filter((o) => isSourceObject(o.name))
    .sort((a, b) => mtime(a) - mtime(b) || String(a.name).localeCompare(String(b.name)));

  const allWrites = [];
  const kindsSet = new Set();
  const fileReports = [];
  let rowsIn = 0, rowsOk = 0, rowsSkipped = 0, ingested = 0, failed = 0;

  for (const obj of targets) {
    try {
      const [buf] = await obj.download();
      const r = await parseBuffer(buf, obj.name);
      if (!r.kinds.length) { fileReports.push({ object: obj.name, error: "aucune source reconnue" }); failed++; continue; }
      r.kinds.forEach((k) => kindsSet.add(k));
      allWrites.push(...r.writes);
      rowsIn += r.rowsIn; rowsOk += r.rowsOk; rowsSkipped += r.rowsSkipped;
      fileReports.push({ object: obj.name, kinds: r.kinds, rowsOk: r.rowsOk, classeurs: r.files.length });
      ingested++;
    } catch (e) {
      fileReports.push({ object: obj.name, error: (e && e.message) || "échec" });
      failed++;
    }
  }

  // LIVE écarté de la ré-ingestion (cf. stripLiveOpps) : le staling snapshot ne peut se faire de façon
  // fiable sur un balayage MULTI-FICHIERS (ordre) ; les opportunités sont restaurées au prochain passage
  // de la synchro Sales_DATA. On retire les écritures opportunities/ du lot.
  const { writes: nonLive } = stripLiveOpps(allWrites);
  if (nonLive.length) await applyWrites(db, nonLive);

  const kinds = [...kindsSet];
  // Réancre config/fiscal.currentFy = max(yearPo) des commandes (comme le trigger d'ingestion).
  if (kinds.includes("pnl") || kinds.includes("fiche")) {
    const snap = await db.collection("orders").select("yearPo").get();
    const currentFy = fiscalYearFromOrders(snap.docs.map((d) => d.data()));
    if (currentFy > 0) await db.doc("config/fiscal").set({ currentFy }, { merge: true });
  }
  // Recalcul des agrégats (sans-op si le module n'est pas présent). BEST-EFFORT (blindage) : les données sont
  // DÉJÀ ré-écrites (applyWrites plus haut) → une erreur de recompute ne doit PAS faire échouer le reingest
  // (le prochain recompute rattrape). MODULE_NOT_FOUND = agrégat absent (émulateur/test) = normal, silencieux.
  try {
    const { recomputeAll } = require("./aggregate");
    await recomputeAll(db);
  } catch (e) {
    if (e.code !== "MODULE_NOT_FOUND") {
      try { require("firebase-functions").logger.error("reingest : recompute post ré-écriture échoué — données ré-écrites, agrégats au prochain recompute", { message: e && e.message }); } catch (_) { /* logger indisponible (test) */ }
    }
  }

  return { objectsScanned: targets.length, objectsIngested: ingested, objectsFailed: failed, kinds, rowsIn, rowsOk, rowsSkipped, files: fileReports };
}

module.exports = { parseBuffer, reingestBucket, isSourceObject, IngestError };
