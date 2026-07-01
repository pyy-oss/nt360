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
  const won = opps.filter((o) => o.stage === 6);
  const pipelineWon = sum(won, (o) => o.amount);
  // Certitudes = commandes fermes + gagnés pas encore convertis + pipeline quasi-certain.
  const wonFps = new Set(won.map((o) => o.fp).filter(Boolean));
  const orderFps = new Set(orders.map((o) => o.fp));
  const wonNotOrdered = sum(won.filter((o) => !o.fp || !orderFps.has(o.fp)), (o) => o.amount);
  // Pipeline quasi-certain : actif (non perdu/suspendu) avec IdC ≥ 90 %.
  const CONFIANCE_MIN = 0.9;
  const pondCertain = sum(
    opps.filter((o) => o.stage >= 1 && o.stage <= 5 && (o.probability || 0) >= CONFIANCE_MIN),
    (o) => o.weighted
  );
  return {
    certitudes: commandes + wonNotOrdered + pondCertain,
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
    unmatchedWonFps: [...wonFps].filter((fp) => !orderFps.has(fp)).length,
  };
}

module.exports = { overview, sum };
