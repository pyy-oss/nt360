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
// LIVE (opportunités) : EXCLU des canaux delta / ingest / reingest. Les opps de la feuille LIVE doivent
// passer par la synchro SNAPSHOT (applySalesSync, canal syncSalesData) qui marque les FANTÔMES (stale) —
// sinon une opp SANS N° FP dont la « D Prev » a bougé se DUPLIQUE (son id est dérivé de la date de clôture,
// mutable) et surévalue durablement le pipeline pondéré. On retire donc toute écriture `opportunities/` de
// ces lots ; la synchro quotidienne 06:00 (ou le bouton « Forcer la synchro ») est le SEUL écrivain LIVE.
// Renvoie les écritures conservées + le nombre d'opps écartées (surfacé dans le rapport d'import).
function stripLiveOpps(writes) {
  const kept = [];
  let skipped = 0;
  for (const w of writes || []) {
    if (typeof w.path === "string" && w.path.startsWith("opportunities/")) skipped++;
    else kept.push(w);
  }
  return { writes: kept, skipped };
}

// Applique les taux de change PARAMÉTRÉS (config/fxRates) aux lignes logistics « à saisir » (devise
// étrangère hors EUR/XOF, non convertie par le parseur pur qui n'a pas accès aux taux). Convertit
// amountXof = amount × taux et marque fxSource='taux'. NE TOUCHE PAS une ligne portant déjà une
// correction MANUELLE (doc existant avec amountXof>0) → l'auto-conversion ne clobbe pas une saisie
// (cf. audit P0-2). Renvoie le nombre de lignes converties. Best-effort : n'échoue jamais l'import.
async function resolveLogisticsFx(db, writes) {
  const targets = (writes || []).filter((w) =>
    typeof w.path === "string" && w.path.startsWith("bcLines/") && w.data && w.data.source === "logistics" &&
    w.data.fxSource === "a_saisir" && String(w.data.currency || "XOF").toUpperCase() !== "XOF" && (Number(w.data.amount) || 0) > 0);
  if (!targets.length) return 0;
  let rates = {};
  try { rates = ((await db.doc("config/fxRates").get()).data() || {}).rates || {}; }
  catch (_) { return 0; }
  // Lecture des docs existants : ne pas écraser une correction manuelle (amountXof>0 déjà stocké).
  const snaps = await Promise.all(targets.map((w) => db.doc(w.path).get().catch(() => null)));
  let converted = 0;
  targets.forEach((w, i) => {
    const rate = Number(rates[String(w.data.currency).toUpperCase()]);
    if (!(rate > 0)) return;
    const existing = snaps[i] && snaps[i].exists ? (snaps[i].data() || {}) : {};
    if ((Number(existing.amountXof) || 0) > 0) return; // correction manuelle préservée
    w.data.amountXof = Math.round((Number(w.data.amount) || 0) * rate);
    w.data.fxRate = rate;
    w.data.fxSource = "taux";
    converted++;
  });
  return converted;
}

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

module.exports = { applyWrites, stripLiveOpps, resolveLogisticsFx };
