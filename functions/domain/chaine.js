// Chaîne de valeur : Certitudes / Commandes(CAS) / Facturé(CAF) / Backlog(RAF) (BUILD_KIT §7).
// ⚠️ Ce ne sont PAS des grandeurs additives : CAS ≠ Facturé + Backlog. Les périmètres diffèrent.
//   • CAS      : prise de commande, FIGÉE sur l'année de PO (peut venir d'années antérieures).
//   • CAF      : facturation, seule grandeur FIGÉE sur l'exercice (Σ factures datées dans la période).
//   • Backlog  : RAF, GLISSANT — toutes les commandes ouvertes, cumulé jusqu'à l'année en cours.
//   • Certitudes : pipeline pondéré ≥90 %, GLISSANT (à venir), indépendant de l'année.
// Fonctions pures (testables).

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

// Pondération de PROJECTION : moteur à 3 niveaux configurables (domain/projection). Fonction UNIQUE
// partagée par la Vue d'ensemble (conversion), le Pipeline (pondéré, funnel) et l'atterrissage.
// Sans tiers explicites → défauts (Certitudes 100 % · Forecast 20 % · Pipe 5 %).
const { projectionWeight, tierBreakdown, normalizeTiers } = require("./projection");

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
  // Pipeline de projection : 3 niveaux DISJOINTS (Certitudes ≥90 · Forecast 70-90 · Pipe 50-70),
  // chacun activable/pondérable (config/projection). On ne mélange pas : on expose la décomposition
  // ET la somme des niveaux ACTIFS. « certitudes » = contribution pondérée du niveau ≥90.
  const tiers = opts.tiers || normalizeTiers();
  // Exclusion « déjà au carnet » (cf. audit cycle de vie — parité avec atterrissage.alreadyBooked) : une opp
  // ACTIVE dont le FP porte DÉJÀ une commande est comptée dans `commandes` (CAS) ; la garder aussi dans le
  // pipeline projeté la double-compterait dans le dénominateur de conversion (taux sous-estimé). Les FP des
  // commandes viennent de `orders` ; les opps sans FP ou dont le FP n'est pas au carnet restent dans le pipe.
  const bookedFps = new Set(orders.map((o) => o.fp).filter(Boolean));
  const active = opps.filter((o) => o.stage >= 1 && o.stage <= 5 && !(o.fp && bookedFps.has(o.fp)));
  const breakdown = tierBreakdown(active, tiers);
  const pipelineProjete = breakdown.reduce((s, b) => s + b.pond, 0); // Σ niveaux ACTIFS
  const pondCertain = breakdown.find((b) => b.key === "certitudes")?.pond || 0;
  const perdu = sum(opps.filter((o) => o.stage === 7), (o) => o.amount);
  // Dénominateur de conversion = Commande + pipeline projeté (niveaux actifs) + Perdu.
  const convDenom = commandes + pipelineProjete + perdu;
  return {
    // Certitudes = contribution pondérée du niveau ≥90 (glissant) ; commandes signées à part.
    certitudes: pondCertain,
    pondCertain,
    pipelineProjete,             // Σ des niveaux de projection ACTIFS
    tierBreakdown: breakdown,    // décomposition par niveau (Certitudes / Forecast / Pipe) — jamais mélangée
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
      // TAUX DE CONVERSION VENTE (période) = Commande / (Commande + pipeline projeté + Perdu).
      tauxConversionVente: convDenom > 0 ? commandes / convDenom : 0,
      pmb: commandes > 0 ? mb / commandes : 0,
    },
  };
}

module.exports = { overview, sum, projectionWeight };
