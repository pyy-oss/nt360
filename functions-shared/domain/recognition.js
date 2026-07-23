// DO Lot 4b — Reconnaissance de revenu à DEUX taux d'avancement, par affaire (fpKey). PUR, testable.
//   • FINANCIER    = facturé / montant commande  → « jalon de facturation » réalisé (ce qu'on a facturé).
//   • OPÉRATIONNEL = avancement ClickUp : progression checklist RÉELLE (cu.progress 0..100, résolu/total)
//                    en priorité ; à défaut dérivée du STATUT ordinal de l'ERP (livré→1, « 0-affecté »
//                    pas commencé→0, « 1-/3- » en cours→null). null = avancement INDÉTERMINÉ : on ne
//                    fabrique JAMAIS un palier intermédiaire (CLAUDE.md : « n'invente aucune donnée »).
//   • ÉCART op − fin, appliqué au montant :
//         op > fin → FAE (produit livré NON facturé, revenu à rattraper) ;
//         fin > op → PCA (facturé D'AVANCE sur la production).
//     Calculé UNIQUEMENT quand les DEUX taux sont connus (sinon écart/FAE/PCA = null/0, jamais deviné).
//
// GARDE-FOU DOUBLE-COMPTE (le lot revenu précédent a été RETIRÉ précisément pour ça) : une affaire portée
// par un CONTRAT de maintenance porte le MÊME fpKey que l'affaire (ADR-001 : 1 contrat = 1 affaire) et sa
// facturation est DÉJÀ pilotée par l'échéancier du module maintenance (mntRisque/mntEcheancier, ADR-005).
// La compter ici DOUBLE-INTERPRÉTERAIT ses factures. On EXCLUT donc tout fpKey présent dans mntFpSet.
const { fpKey } = require("../lib/ids");

// « Actif » (projet PAS encore livré) : mêmes préfixes que clickupSignals.ACTIVE_PREFIXES — on RÉUTILISE
// la définition existante pour NE PAS diverger (invariant « même métrique = même nombre »).
const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const ACTIVE_PREFIXES = ["0-", "1-", "3-"];
const isActiveStatus = (status) => ACTIVE_PREFIXES.some((p) => norm(status).startsWith(p));

/**
 * Avancement OPÉRATIONNEL ∈ [0,1], ou null si indéterminé.
 * @param {number|null} clickupProgress  progression checklist ClickUp 0..100 (résolu/total), null si aucune
 * @param {string|null} status           statut projet ClickUp (synchro inverse)
 */
function operationalRate(clickupProgress, status) {
  // Mesure réelle prioritaire : la checklist ClickUp donne un % (0 compris — un projet à 0 % est une donnée,
  // pas une absence). ATTENTION : Number(null) === 0, donc on écarte null/'' AVANT la conversion, sinon une
  // affaire SANS checklist serait comptée à 0 % (faux) au lieu de retomber sur le statut.
  if (clickupProgress != null && clickupProgress !== "") {
    const p = Number(clickupProgress);
    if (Number.isFinite(p) && p >= 0) return Math.max(0, Math.min(1, p / 100));
  }
  const s = norm(status);
  if (!s) return null;                     // aucun statut synchronisé → indéterminé
  if (!isActiveStatus(s)) return 1;        // 4-terminé / 5-facturé / 9-clôturé / suivi → livré
  if (s.startsWith("0-")) return 0;        // affecté : pris en portefeuille, pas démarré
  return null;                             // 1-/3- en cours → indéterminé (aucun % inventé)
}

/**
 * Reconnaissance par affaire. Additif, aucune I/O.
 * @param {{fp?:string,client?:string,bu?:string,am?:string,cas?:number,facture?:number,clickupStatus?:string|null,clickupProgress?:number|null}[]} carnetRows
 * @param {Set<string>} mntFpSet  fpKey des affaires SOUS CONTRAT de maintenance → exclues (anti double-compte)
 * @returns {{rows:object[], global:object}}
 */
function recognitionByFp(carnetRows, mntFpSet) {
  const excl = mntFpSet instanceof Set ? mntFpSet : new Set();
  // Agrégation par fpKey (une même affaire peut avoir plusieurs lignes de commande).
  const byFp = new Map();
  for (const o of carnetRows || []) {
    const k = fpKey(o && o.fp);
    if (!k || excl.has(k)) continue;       // FP invalide OU affaire de maintenance → écartée
    let e = byFp.get(k);
    if (!e) { e = { fp: k, client: o.client || "", bu: o.bu || "AUTRE", am: o.am || "", montant: 0, factured: 0, progressNum: 0, progressCnt: 0, status: null }; byFp.set(k, e); }
    e.montant += Math.round(Number(o.cas) || 0);
    e.factured += Math.round(Number(o.facture) || 0);
    // Avancement opérationnel de la LIGNE (progress prioritaire, sinon statut) : on MOYENNE les lignes
    // porteuses d'un avancement connu ; une ligne indéterminée n'abaisse pas la moyenne (elle est ignorée).
    const r = operationalRate(o.clickupProgress, o.clickupStatus);
    if (r != null) { e.progressNum += r; e.progressCnt += 1; }
    if (!e.status && o.clickupStatus) e.status = o.clickupStatus;
  }

  const rows = [];
  const global = { nbAffaires: 0, nbOpKnown: 0, nbOpUnknown: 0, montant: 0, factured: 0, fae: 0, pca: 0 };
  for (const e of byFp.values()) {
    const montant = e.montant;
    const factured = e.factured;
    // Financier : facturé / montant. Sans montant (0) → indéterminé (division non définie). Ratio brut ≥ 0
    // (peut dépasser 1 sur avenant/sur-facturation → alimente la PCA), jamais borné en haut.
    const tauxFin = montant > 0 ? Math.max(0, factured / montant) : null;
    const tauxOp = e.progressCnt > 0 ? e.progressNum / e.progressCnt : null;
    const opKnown = tauxOp != null;
    let ecart = null, fae = 0, pca = 0;
    if (tauxOp != null && tauxFin != null) {
      ecart = tauxOp - tauxFin;
      if (ecart > 0) fae = Math.round(ecart * montant);       // livré au-delà du facturé → à établir
      else if (ecart < 0) pca = Math.round(-ecart * montant); // facturé au-delà du livré → constaté d'avance
    }
    rows.push({ fp: e.fp, client: e.client, bu: e.bu, am: e.am, montant, factured, tauxFin, tauxOp, opKnown, ecart, fae, pca });
    global.nbAffaires += 1;
    global[opKnown ? "nbOpKnown" : "nbOpUnknown"] += 1;
    global.montant += montant;
    global.factured += factured;
    global.fae += fae;
    global.pca += pca;
  }
  // Tri par EXPOSITION (|FAE| ou |PCA| le plus fort d'abord) — l'affaire qui pèse le plus en tête de liste.
  rows.sort((a, b) => (Math.max(b.fae, b.pca)) - (Math.max(a.fae, a.pca)));
  return { rows, global };
}

module.exports = { recognitionByFp, operationalRate };
