// PLAN D'IMPORT DE LA TABLE DE CORRESPONDANCE FP–DC (seed initial de config/dcAliases) — module PUR.
//
// Contexte métier (cf. docs/ODOO_WEBHOOK.md) : dans Odoo, le DC est GÉNÉRÉ DEPUIS LE FP (« Générer DC »)
// puis toutes les dépenses du projet (BC fournisseurs, décaissements, astreintes…) sont rattachées au DC.
// Pour l'HISTORIQUE antérieur au branchement du webhook, une table FP–DC amorce l'overlay d'un coup au
// lieu de rapprochements un par un. L'I/O (lecture du classeur, écriture Firestore) reste au callable.
//
// Règles :
//  - Détection PAR CONTENU, pas par entête : dans chaque ligne, la cellule que fpKey résout est le FP,
//    la première autre cellule non vide est le DC (ordre des colonnes libre ; les entêtes tombent
//    naturellement en « écartée »). Deux cellules FP-résolubles = ambigu → écartée.
//  - Dédoublonnage par DC : première occurrence retenue, doublons écartés (signalés).
//  - CONFLIT avec un rapprochement DÉJÀ posé (manuel ou import précédent) : L'EXISTANT PRIME — on
//    n'écrase jamais en silence un arbitrage humain ; le conflit est signalé pour arbitrage.
//  - Identique à l'existant = « déjà en place » (aucune écriture).
const MAX_ROWS = 5000; // borne défensive (une table de correspondance réelle en compte quelques centaines)

/**
 * Construit le plan d'import depuis les lignes brutes du classeur (aoa, 1ʳᵉ feuille).
 * @param {any[][]} aoa lignes (tableaux de cellules) de la feuille
 * @param {Record<string,string>} existingMap map actuelle config/dcAliases (dc → fp)
 * @param {(v:any)=>string|null} fpKeyFn canonicalisation N° FP (lib/ids.fpKey)
 * @returns {{toAdd:{dc:string,fp:string}[], unchanged:number, conflicts:{dc:string,existing:string,incoming:string}[], skipped:{reason:string,detail:string}[], truncated:boolean}}
 */
function planDcMapImport(aoa, existingMap, fpKeyFn) {
  const rows = Array.isArray(aoa) ? aoa : [];
  const truncated = rows.length > MAX_ROWS;
  const seen = new Set();
  const toAdd = [];
  const conflicts = [];
  const skipped = [];
  let unchanged = 0;
  const detail = (cells) => cells.map((c) => String(c == null ? "" : c)).filter(Boolean).join(" | ").slice(0, 120);

  for (const row of rows.slice(0, MAX_ROWS)) {
    const cells = (Array.isArray(row) ? row : [row]).map((c) => String(c == null ? "" : c).trim());
    if (!cells.some(Boolean)) continue; // ligne vide — silencieux
    const fps = [];
    const others = [];
    for (const c of cells) {
      if (!c) continue;
      const k = fpKeyFn(c);
      if (k) fps.push(k); else others.push(c);
    }
    if (fps.length === 0) { skipped.push({ reason: "aucun N° FP reconnu (entête ?)", detail: detail(cells) }); continue; }
    if (fps.length > 1) { skipped.push({ reason: "plusieurs N° FP sur la ligne (ambigu)", detail: detail(cells) }); continue; }
    if (others.length === 0) { skipped.push({ reason: "DC absent", detail: detail(cells) }); continue; }
    const fp = fps[0];
    const dc = others[0].slice(0, 120); // DC = chaîne libre (format Odoo, on ne canonise pas — ADR-054)
    if (seen.has(dc)) { skipped.push({ reason: "DC en double dans le fichier (première occurrence retenue)", detail: detail(cells) }); continue; }
    seen.add(dc);
    const existing = existingMap && existingMap[dc];
    if (existing) {
      if (existing === fp) unchanged++;
      else conflicts.push({ dc, existing, incoming: fp }); // l'existant PRIME — signalé, jamais écrasé
      continue;
    }
    toAdd.push({ dc, fp });
  }
  return { toAdd, unchanged, conflicts, skipped, truncated };
}

module.exports = { planDcMapImport, MAX_ROWS };
