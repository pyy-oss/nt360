// Chaîne de valeur : Commandes(CAS) → Facturé → Backlog(RAF) (BUILD_KIT §7).
// Fonctions pures (testables). Taux de facturation = (CAS−RAF)/CAS.

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

/**
 * @param {object[]} orders  commandes (orders/{fp})
 * @param {object[]} invoices factures de la période
 * @param {object[]} [opps]  opportunités (pour le maillon pondéré / gagné)
 */
function overview(orders, invoices, opps = []) {
  const commandes = sum(orders, (o) => o.cas);
  const backlog = sum(orders, (o) => Math.max(o.raf || 0, 0));
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
    // Certitudes = commandes signées + pipeline quasi-certain (à venir).
    certitudes: commandes + pondCertain,
    pondCertain,
    commandes,
    facture,
    backlog,
    mb,
    pipelineWon,
    ratios: {
      tauxFacturation: commandes > 0 ? (commandes - backlog) / commandes : 0,
      pmb: commandes > 0 ? mb / commandes : 0,
    },
  };
}

module.exports = { overview, sum };
