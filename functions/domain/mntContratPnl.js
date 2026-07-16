// Domain PUR — Rentabilité par contrat de maintenance (mnt_), Lot 4/7 « valeur ajoutée » (contrôle).
// Rapproche le REVENU engagé à ce jour (échéancier : montant par échéance × échéances dues) au COÛT des
// interventions (jours CRA × CJM du consultant). Le CJM est CONFIDENTIEL : quand `hasCost` est faux, le
// coût/marge sont MASQUÉS (null) — seuls le revenu et les jours (non confidentiels) restent. Aucun I/O.
// Montants ENTIERS XOF. Réutilise craDaysFromHours (ADR-013) et echeancier (source unique du « dû »).
const { craDaysFromHours } = require("./mntTicket");
const { echeancier } = require("./mntEcheancier");
const { RISK_STATUTS } = require("./mntRisque");

/**
 * @param {object[]} contrats      contrats (id, fp, client, statut, echeanceType, montantEngage, dateDebut, dateFin)
 * @param {object[]} interventions interventions (contratId, consultantId, heures)
 * @param {Object<string,number>} cjmById  CJM (coût journalier) par consultantId
 * @param {string} asOfIso         date d'observation (AAAA-MM-JJ) pour le revenu engagé à ce jour
 * @param {boolean} hasCost        droit « rentabilite » : sinon coût/marge masqués (null)
 * @returns {{id,fp,client,statut,revenue,jours,cout,marge,margePct}[]}
 */
function computeContratPnl(contrats, interventions, cjmById, asOfIso, hasCost) {
  const cjm = cjmById || {};
  // Coût + jours agrégés par contrat (jours CRA × CJM du consultant de l'intervention).
  const agg = {};
  for (const iv of interventions || []) {
    const cid = iv && iv.contratId;
    if (!cid) continue;
    const jours = craDaysFromHours(Number(iv.heures) || 0);
    const a = agg[cid] || (agg[cid] = { jours: 0, cout: 0 });
    a.jours += jours;
    a.cout += jours * (Number(cjm[iv.consultantId]) || 0);
  }
  const rows = [];
  for (const c of contrats || []) {
    // Même assiette que le moteur de risque (ADR-021) : seuls les contrats VIVANTS (actif/suspendu) ont un
    // revenu engagé pilotable. Un brouillon (montant spéculatif, non engagé) ou un contrat échu/résilié
    // gonflerait revenu et marge — divergence « populations divergentes » interdite (« même métrique = même
    // nombre »). Filtre partagé RISK_STATUTS (source unique) plutôt qu'un doublon de la liste.
    if (!c || !RISK_STATUTS.has(String(c.statut))) continue;
    const a = agg[c.id] || { jours: 0, cout: 0 };
    const revenue = echeancier(c, 0, asOfIso).engage; // engagé à ce jour (indépendant du facturé)
    if (!(revenue > 0) && a.jours <= 0) continue;      // ni revenu ni activité → hors P&L
    const cout = Math.round(a.cout);
    const marge = revenue - cout;
    rows.push({
      id: c.id || "", fp: c.fp || null, client: c.client || "", statut: c.statut || "brouillon",
      revenue, jours: Math.round(a.jours * 100) / 100,
      cout: hasCost ? cout : null,
      marge: hasCost ? marge : null,
      margePct: hasCost && revenue > 0 ? Math.round((marge / revenue) * 1000) / 1000 : null,
    });
  }
  // Pires marges d'abord (là où il faut agir) quand le coût est visible ; sinon plus d'activité d'abord.
  rows.sort((x, y) => (hasCost ? (x.marge - y.marge) : (y.jours - x.jours)));
  return rows;
}

module.exports = { computeContratPnl };
