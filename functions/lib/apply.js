// Application d'un lot d'écritures {path,data} — extrait d'index.js pour être partagé par le
// trigger Storage `ingest`, le callable `importDelta` ET la ré-ingestion `reingest` (callable +
// script GHA). Déduplication par chemin (fusion des champs, dernier gagne — utile en import ZIP
// multi-classeurs), upsert par batch (IDs déterministes ⇒ pas de doublon), puis NETTOYAGE des
// lignes BC de fiche devenues orphelines (une fiche régénère TOUTES ses lignes ; si le ré-import
// en compte moins, les anciennes lignes de fin resteraient et gonfleraient l'exposition).
// Fail-safe : si une fiche ne produit AUCUNE ligne, son FP n'est pas dans keepByFp → aucune
// suppression. Filtre par `fp` seul (pas d'index composite) + garde `source === "fiche"` en
// mémoire → ne touche jamais les lignes logistics/unitaires/manuelles.
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

module.exports = { applyWrites };
