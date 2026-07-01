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
  const backlogCount = orders.filter((o) => (o.raf || 0) > 0).length;
  // Facturé de la chaîne = factures RATTACHÉES aux commandes (jointure N° FP) :
  // homogène avec Commandes/Backlog. Les factures orphelines (FP absent des
  // commandes) sont exposées à part et ne gonflent pas le maillon Facturé.
  const orderFps = new Set(orders.map((o) => o.fp).filter(Boolean));
  const facture = sum(invoices.filter((i) => i.fp && orderFps.has(i.fp)), (i) => i.amountHt);
  const factureTotal = sum(invoices, (i) => i.amountHt);
  const factureOrphelin = factureTotal - facture;
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
    // Certitudes = pipeline quasi-certain à venir (actif, IdC ≥ 90 %, pas encore signé).
    // Les commandes signées sont suivies à part (maillon COMMANDES) et NON incluses ici.
    certitudes: pondCertain,
    pondCertain,
    commandes,
    facture,
    factureOrphelin,
    factureTotal,
    backlog,
    backlogCount,
    mb,
    pipelineWon,
    ratios: {
      tauxFacturation: commandes > 0 ? (commandes - backlog) / commandes : 0,
      pmb: commandes > 0 ? mb / commandes : 0,
    },
  };
}

module.exports = { overview, sum };
