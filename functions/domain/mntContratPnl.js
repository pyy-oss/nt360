// Domain PUR — Rentabilité par contrat de maintenance (mnt_), Lot 4/7 « valeur ajoutée » (contrôle).
// Rapproche le REVENU engagé à ce jour (échéancier : montant par échéance × échéances dues) au COÛT
// TOTAL de l'affaire, en DEUX composantes (ADR-033) :
//   1. coût des INTERVENTIONS de maintenance (jours CRA × CJM du consultant) — la main-d'œuvre TMA ;
//   2. coût du P&L de l'AFFAIRE porté par le carnet (achats BC + provisions), rapproché par N° FP.
// Sans la composante P&L, un contrat sans intervention saisie affichait coût 0 → marge 100 % (anomalie
// signalée en prod). Le CJM et les coûts sont CONFIDENTIELS : quand `hasCost` est faux, coût/marge sont
// MASQUÉS (null). Aucun I/O. Montants ENTIERS XOF. Réutilise craDaysFromHours (ADR-013), echeancier
// (source unique du « dû ») et fpKey (rapprochement carnet, jamais un FP brut).
// LIMITE ASSUMÉE (ADR-033) : revenu = engagé À CE JOUR (croît avec le temps) ; coût P&L = coût TOTAL de
// l'affaire (figé). La marge est donc PRUDENTE (plancher) tant que le contrat n'est pas à terme.
const { craDaysFromHours } = require("./mntTicket");
const { echeancier } = require("./mntEcheancier");
const { RISK_STATUTS } = require("./mntRisque");
const { fpKey } = require("../lib/ids");

/**
 * @param {object[]} contrats      contrats (id, fp, client, statut, echeanceType, montantEngage, dateDebut, dateFin)
 * @param {object[]} interventions interventions (contratId, consultantId, heures)
 * @param {Object<string,number>} cjmById  CJM (coût journalier) par consultantId
 * @param {string} asOfIso         date d'observation (AAAA-MM-JJ) pour le revenu engagé à ce jour
 * @param {boolean} hasCost        droit « rentabilite » : sinon coût/marge masqués (null)
 * @param {Object<string,number>} pnlCostByFp  coût carnet (costTotal) par N° FP canonique (achats + provisions)
 * @param {Object<string,number>} astreinteCostByFp  charge des astreintes VALIDÉES par N° FP (ADR-035)
 * @returns {{id,fp,client,statut,revenue,jours,coutInterventions,coutPnl,coutAstreintes,cout,marge,margePct}[]}
 */
function computeContratPnl(contrats, interventions, cjmById, asOfIso, hasCost, pnlCostByFp, astreinteCostByFp) {
  const cjm = cjmById || {};
  const pnlByFp = pnlCostByFp || {};
  const astByFp = astreinteCostByFp || {};
  // Coût + jours agrégés par contrat (jours CRA × CJM du consultant de l'intervention).
  const agg = {};
  for (const iv of interventions || []) {
    const cid = iv && iv.contratId;
    if (!cid) continue;
    const jours = craDaysFromHours(Number(iv.heures) || 0);
    const a = agg[cid] || (agg[cid] = { jours: 0, cout: 0, joursSansCjm: 0 });
    a.jours += jours;
    a.cout += jours * (Number(cjm[iv.consultantId]) || 0);
    // Consultant sans CJM renseigné (absent de l'annuaire des coûts) → contribue 0 au coût. On COMPTE ces
    // jours pour signaler une marge NON FIABLE (sinon coût=0 → marge=revenu silencieusement), comme
    // resourcePnl.missingCjm (audit m6). CJM à 0 explicite ≠ absent : seul l'absence (== null) est un manque.
    if (cjm[iv.consultantId] == null) a.joursSansCjm += jours;
  }
  const rows = [];
  for (const c of contrats || []) {
    // Même assiette que le moteur de risque (ADR-021) : seuls les contrats VIVANTS (actif/suspendu) ont un
    // revenu engagé pilotable. Un brouillon (montant spéculatif, non engagé) ou un contrat échu/résilié
    // gonflerait revenu et marge — divergence « populations divergentes » interdite (« même métrique = même
    // nombre »). Filtre partagé RISK_STATUTS (source unique) plutôt qu'un doublon de la liste.
    if (!c || !RISK_STATUTS.has(String(c.statut))) continue;
    const a = agg[c.id] || { jours: 0, cout: 0, joursSansCjm: 0 };
    const revenue = echeancier(c, 0, asOfIso).engage; // engagé à ce jour (indépendant du facturé)
    const fk = fpKey(c.fp);                            // rapprochement carnet par clé canonique (jamais FP brut)
    const coutPnl = fk ? Math.round(Number(pnlByFp[fk]) || 0) : 0; // coût affaire (achats + provisions)
    const coutAstreintes = fk ? Math.round(Number(astByFp[fk]) || 0) : 0; // charge astreintes validées (ADR-035)
    const coutInterventions = Math.round(a.cout);      // main-d'œuvre TMA (jours CRA × CJM)
    if (!(revenue > 0) && a.jours <= 0 && coutPnl <= 0 && coutAstreintes <= 0) continue; // ni revenu, ni activité, ni coût → hors P&L
    const cout = coutInterventions + coutPnl + coutAstreintes;
    const marge = revenue - cout;
    rows.push({
      id: c.id || "", fp: c.fp || null, client: c.client || "", statut: c.statut || "brouillon",
      revenue, jours: Math.round(a.jours * 100) / 100,
      coutInterventions: hasCost ? coutInterventions : null,
      coutPnl: hasCost ? coutPnl : null,
      coutAstreintes: hasCost ? coutAstreintes : null,
      cout: hasCost ? cout : null,
      marge: hasCost ? marge : null,
      margePct: hasCost && revenue > 0 ? Math.round((marge / revenue) * 1000) / 1000 : null,
      // Jours d'intervention sans CJM connu → marge non fiable (coût sous-estimé). Masqué sans droit coût.
      missingCjm: hasCost ? Math.round(a.joursSansCjm * 100) / 100 : null,
    });
  }
  // Pires marges d'abord (là où il faut agir) quand le coût est visible ; sinon plus d'activité d'abord.
  rows.sort((x, y) => (hasCost ? (x.marge - y.marge) : (y.jours - x.jours)));
  return rows;
}

// Seuil bas de marge « saine » (décision DO Lot 5). Sous ce palier, un contrat pèse sur le score de risque.
const MARGE_FAIBLE_PCT = 0.15;

/**
 * Palier de risque de marge, DÉRIVÉ d'une ligne de rentabilité (margePct PRUDENT, ADR-033) :
 *   - "negative" : marge < 0 (le contrat ne couvre pas son coût à ce jour) ;
 *   - "faible"   : 0 ≤ marge < 15 % (marge trop mince) ;
 *   - null       : marge saine, OU inconnue (droit coût absent → margePct null, ou revenu nul).
 * NE renvoie JAMAIS de montant : sert à alimenter le score de risque (matérialisé sous droit `maintenance`)
 * sans exposer le coût/marge confidentiels (le montant exact reste dans le callable gaté `rentabilite`).
 * @param {{margePct:number|null}} row  ligne renvoyée par computeContratPnl
 * @returns {"negative"|"faible"|null}
 */
function margeRisqueNiveau(row) {
  if (!row || row.margePct == null) return null; // marge inconnue → pas de signal (évite le bruit revenu nul)
  if (row.margePct < 0) return "negative";
  if (row.margePct < MARGE_FAIBLE_PCT) return "faible";
  return null;
}

module.exports = { computeContratPnl, margeRisqueNiveau, MARGE_FAIBLE_PCT };
