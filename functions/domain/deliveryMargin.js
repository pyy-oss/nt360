// MARGE DE LIVRAISON PAR AFFAIRE (DO Lot 2) — confronte la marge « papier » du carnet à la MAIN-D'ŒUVRE
// réellement consommée sur l'affaire (labor constaté imputé, keystone Lot 1). Dans une ESN, le travail est
// le premier poste de coût de livraison : une affaire à 30 % de marge carnet peut tomber à 10 % une fois le
// temps consultant réellement consommé. Ce module rend cet écart visible, affaire par affaire.
//
// Composants par affaire (clé = fpKey) :
//   - vente        = CAS du carnet (prise de commande)
//   - margeCarnet  = mb du carnet (vente − achats/provisions ; N'INCLUT PAS la main-d'œuvre)
//   - coutLabor    = coût du temps consultant imputé (jours CRA × CJM), via imputeLaborByFp
//   - margeLivraison = margeCarnet − coutLabor  (marge après main-d'œuvre constatée)
//
// HONNÊTETÉ / LIMITE : on RETRANCHE le labor de la marge carnet. Si un P&L importé « manuel » avait déjà
// inclus de la main-d'œuvre dans son coût, la marge de livraison la compte une fois de plus (plancher) —
// signalé à l'affichage. Le CJM est CONFIDENTIEL : sans le droit `rentabilite`, coûts/marges masqués (null).
// PUR (aucun I/O). Montants ENTIERS XOF.
const { fpKey } = require("../lib/ids");

/**
 * @param {object[]} carnetRows  lignes du carnet (summaries/commandes) : {fp, client, bu, am, cas, facture}
 * @param {object[]} marginRows  marge isolée (commandesRowsMargin) : {fp, mb, costTotal}
 * @param {{fp:string,laborDays:number,laborCost:number}[]} laborByFp  sortie de imputeLaborByFp (.byFp)
 * @param {boolean} hasCost      droit `rentabilite` : sinon coûts/marges masqués (null)
 * @returns {{fp,client,bu,am,vente,facture,margeCarnet,coutLabor,joursLabor,margeLivraison,margeLivraisonPct,laborInconnu}[]}
 */
function deliveryMargin(carnetRows, marginRows, laborByFp, hasCost) {
  const byFp = new Map();
  const ensure = (k) => { let e = byFp.get(k); if (!e) { e = { fp: k, client: "", bu: "", am: "", vente: 0, facture: 0, mb: 0, costTotal: 0, laborDays: 0, laborCost: 0, hasLabor: false }; byFp.set(k, e); } return e; };
  for (const o of carnetRows || []) {
    const k = fpKey(o && o.fp); if (!k) continue;
    const e = ensure(k);
    e.vente += Number(o.cas) || 0;
    e.facture += Number(o.facture) || 0;
    if (!e.client && o.client) e.client = o.client;
    if (!e.bu && o.bu) e.bu = o.bu;
    if (!e.am && o.am) e.am = o.am;
  }
  for (const m of marginRows || []) {
    const k = fpKey(m && m.fp); if (!k || !byFp.has(k)) continue; // marge sans affaire au carnet → ignorée
    const e = byFp.get(k);
    e.mb += Number(m.mb) || 0;
    e.costTotal += Number(m.costTotal) || 0;
  }
  for (const l of laborByFp || []) {
    const k = fpKey(l && l.fp); if (!k || !byFp.has(k)) continue; // labor sur une affaire hors carnet → ignoré
    const e = byFp.get(k);
    e.laborDays += Number(l.laborDays) || 0;
    e.laborCost += Number(l.laborCost) || 0;
    e.hasLabor = true;
  }
  const rows = [];
  for (const e of byFp.values()) {
    if (!(e.vente > 0) && !(e.facture > 0)) continue; // affaire sans montant → hors P&L de livraison
    const margeCarnet = Math.round(e.mb);
    const coutLabor = Math.round(e.laborCost);
    const margeLivraison = margeCarnet - coutLabor;
    rows.push({
      fp: e.fp, client: e.client, bu: e.bu, am: e.am,
      vente: Math.round(e.vente), facture: Math.round(e.facture),
      margeCarnet: hasCost ? margeCarnet : null,
      coutLabor: hasCost ? coutLabor : null,
      joursLabor: Math.round(e.laborDays * 10) / 10, // les JOURS ne sont pas confidentiels (comme mntContratPnl)
      margeLivraison: hasCost ? margeLivraison : null,
      margeLivraisonPct: hasCost && e.vente > 0 ? Math.round((margeLivraison / e.vente) * 1000) / 1000 : null,
    });
  }
  // Marges de livraison les plus BASSES d'abord (là où le travail mange la marge) quand le coût est visible.
  rows.sort((a, b) => hasCost ? ((a.margeLivraison ?? 0) - (b.margeLivraison ?? 0)) : (b.joursLabor - a.joursLabor));
  return rows;
}

module.exports = { deliveryMargin };
