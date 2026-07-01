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
  // RAF des commandes de la PÉRIODE : base de l'avancement de facturation (taux), cohorte.
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
  const CONFIANCE_MIN = 0.9;
  const pondCertain = sum(
    opps.filter((o) => o.stage >= 1 && o.stage <= 5 && (o.probability || 0) >= CONFIANCE_MIN),
    (o) => o.weighted
  );
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
    ratios: {
      // Avancement de facturation des commandes de la PÉRIODE (cohorte) = (CAS − RAF période)/CAS.
      tauxFacturation: commandes > 0 ? (commandes - rafPeriode) / commandes : 0,
      pmb: commandes > 0 ? mb / commandes : 0,
    },
  };
}

module.exports = { overview, sum };
