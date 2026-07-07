// Application d'un lot d'écritures {path,data} — extrait d'index.js pour être partagé par le
// trigger Storage `ingest`, le callable `importDelta` ET la ré-ingestion `reingest` (callable +
// script GHA). Déduplication par chemin (fusion des champs, dernier gagne — utile en import ZIP
// multi-classeurs), upsert par batch (IDs déterministes ⇒ pas de doublon), puis NETTOYAGE des
// lignes BC devenues orphelines (un export régénère TOUTES les lignes d'un FP ; si un ré-import
// en compte moins, les anciennes lignes de fin resteraient et gonfleraient l'exposition).
//
// Le nettoyage vaut pour les sources REGÉNÉRÉES en snapshot complet par FP : `fiche` ET `logistics`
// (un export logistique retiré d'une ligne PO laissait sinon un bcLines orphelin qui continuait à
// gonfler l'engagement/payable — cf. audit intégrité). On NE touche PAS aux lignes `unitaire`/
// manuelles/`clickup` (saisies une à une, jamais régénérées en lot).
//
// CLOISONNEMENT PAR SOURCE : la garde est indexée par (source, fp), pas par fp seul. Un import qui
// porte des lignes `fiche` pour un FP mais AUCUNE ligne `logistics` pour ce même FP ne doit pas
// supprimer les lignes `logistics` de ce FP (et inversement). Sans cette séparation, une source
// absente du lot ferait tout supprimer côté autre source. Fail-safe conservé : une source qui ne
// produit AUCUNE ligne pour un FP n'a pas d'entrée (source,fp) → aucune suppression pour ce couple.
const SWEEP_SOURCES = new Set(["fiche", "logistics"]);
async function applyWrites(db, writes) {
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
  // Clé de garde = `${source}|${fp}` → Set des ids conservés pour ce couple.
  const keepBySrcFp = new Map();
  for (const [path, data] of byPath) {
    if (path.startsWith("bcLines/") && SWEEP_SOURCES.has(data.source) && data.fp) {
      const k = `${data.source}|${data.fp}`;
      (keepBySrcFp.get(k) || keepBySrcFp.set(k, new Set()).get(k)).add(path.slice("bcLines/".length));
    }
  }
  for (const [k, keep] of keepBySrcFp) {
    const sep = k.indexOf("|");
    const source = k.slice(0, sep), fp = k.slice(sep + 1);
    const snap = await db.collection("bcLines").where("fp", "==", fp).get();
    const stale = snap.docs.filter((d) => d.get("source") === source && !keep.has(d.id));
    for (let i = 0; i < stale.length; i += 400) {
      const batch = db.batch();
      stale.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  // NB : le marquage des opportunités FANTÔMES (I2) N'est PAS fait ici. `applyWrites` sert le chemin
  // DELTA/partiel (importDelta, ré-ingestion) qui ne connaît PAS l'ensemble complet du pipeline — y
  // balayer les absents mass-staliserait le pipeline sur un simple fichier de correction (cf.
  // vérification). Le marquage vit dans lib/sync.js (applySalesSync), seul chemin snapshot LIVE complet.
}

module.exports = { applyWrites };
