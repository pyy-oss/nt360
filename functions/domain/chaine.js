// Chaîne de valeur : Certitudes / Commandes(CAS) / Facturé(CAF) / Backlog(RAF) (BUILD_KIT §7).
// ⚠️ Ce ne sont PAS des grandeurs additives : CAS ≠ Facturé + Backlog. Les périmètres diffèrent.
//   • CAS      : prise de commande, FIGÉE sur l'année de PO (peut venir d'années antérieures).
//   • CAF      : facturation, seule grandeur FIGÉE sur l'exercice (Σ factures datées dans la période).
//   • Backlog  : RAF, GLISSANT — toutes les commandes ouvertes, cumulé jusqu'à l'année en cours.
//   • Certitudes : pipeline pondéré ≥90 %, GLISSANT (à venir), indépendant de l'année.
// Fonctions pures (testables).

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

/**
 * @param {object[]} orders  commandes de la période (orders/{fp})
 * @param {object[]} invoices factures DATÉES dans la période (CAF figé)
 * @param {object[]} [opps]  opportunités globales (pour le maillon pondéré / gagné)
 * @param {{backlog?:number, backlogCount?:number}} [opts] backlog GLISSANT global (sinon = RAF période)
 */
function overview(orders, invoices, opps = [], opts = {}) {
  const commandes = sum(orders, (o) => o.cas);
  // RAF des commandes de la PÉRIODE (reste à faire, glissant) — sert au backlog de repli.
  const rafPeriode = sum(orders, (o) => Math.max(o.raf || 0, 0));
  // Backlog GLISSANT : RAF de toutes les commandes ouvertes, cumulé jusqu'à l'année en cours
  // (indépendant de la période). Fourni via opts ; à défaut = RAF période (rétro-compat tests).
  const backlog = opts.backlog != null ? opts.backlog : rafPeriode;
  const backlogCount = opts.backlogCount != null ? opts.backlogCount : orders.filter((o) => (o.raf || 0) > 0).length;
  // Facturé = CAF, FIGÉ sur l'exercice = Σ factures datées dans la période (orphelines incluses :
  // une facture est du CA facturé même sans commande retrouvée). Non additif avec CAS/Backlog.
  const facture = sum(invoices, (i) => i.amountHt);
  const mb = sum(orders, (o) => o.mb);
  // Gagné = Commandes : une opportunité gagnée (stage 6) devient un PO/commande (CAS).
  // On ne recompte donc PAS les gagnés dans les certitudes (déjà dans les commandes).
  const pipelineWon = sum(opps.filter((o) => o.stage === 6), (o) => o.amount);
  // Pipeline quasi-certain : actif (non perdu/suspendu) avec IdC ≥ 90 %, pas encore signé.
  // VALORISÉ À 100 % DU MONTANT (décision métier : une quasi-certitude ≥ 90 % ≈ une commande),
  // cohérent avec l'atterrissage. (Auparavant : montant × proba, ce qui sous-évaluait.)
  const CONFIANCE_MIN = 0.9;
  const active = opps.filter((o) => o.stage >= 1 && o.stage <= 5);
  const band = (lo, hi) => sum(active.filter((o) => (o.probability || 0) >= lo && (o.probability || 0) < hi), (o) => o.amount);
  const pondCertain = sum(active.filter((o) => (o.probability || 0) >= CONFIANCE_MIN), (o) => o.amount);
  // Bandes de confiance intermédiaires (pour le taux de conversion) et perdu de la période.
  const opp70_90 = band(0.70, 0.90); // pondéré 20 %
  const opp50_70 = band(0.50, 0.70); // pondéré 10 %
  const perdu = sum(opps.filter((o) => o.stage === 7), (o) => o.amount);
  // Dénominateur de conversion = Commande + Certitude (≥90 % à 100 %) + 20 %·[70-90 %[ + 10 %·[50-70 %[ + Perdu.
  const convDenom = commandes + pondCertain + 0.20 * opp70_90 + 0.10 * opp50_70 + perdu;
  return {
    // Certitudes = pipeline quasi-certain à venir (glissant), commandes signées suivies à part.
    certitudes: pondCertain,
    pondCertain,
    commandes,
    facture,
    rafPeriode,
    backlog,
    backlogCount,
    mb,
    pipelineWon,
    perdu,
    ratios: {
      // TAUX DE FACTURATION (période) = Facturé / (Facturé + Backlog) : part déjà facturée du
      // « facturé + reste à facturer ». Borné [0,1] par construction (deux grandeurs positives).
      tauxFacturation: (facture + backlog) > 0 ? facture / (facture + backlog) : 0,
      // TAUX DE CONVERSION VENTE (période) = Commande / (Commande + Certitude + 20 %·opps[70-90 %[
      // + 10 %·opps[50-70 %[ + Perdu). Part du potentiel adressable déjà transformée en commande.
      tauxConversionVente: convDenom > 0 ? commandes / convDenom : 0,
      pmb: commandes > 0 ? mb / commandes : 0,
    },
  };
}

module.exports = { overview, sum };
