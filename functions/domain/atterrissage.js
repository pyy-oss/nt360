// Atterrissage annuel (BUILD_KIT §7) : projeté = Réalisé CAS(FY) + pipeline de PROJECTION
// (pondération tiérée par certitude, fenêtrée sur D Prev) → vs objectifs, écart, probabilité.
// Le backlog est exposé séparément (informatif) mais N'ENTRE PAS dans le projeté CAS (déjà
// couvert par le CAS réalisé). + comparaison N vs N-1 sur la facturation.
const { sum } = require("./chaine");

const yearOf = (d) => (d ? String(d).slice(0, 4) : "");

// Pondération de PROJECTION moyen terme (logique atterrissage, distincte du pondéré risque
// = montant×proba du module Pipeline) : 100 % du CA si certitude ≥ 90 %, 20 % si 70 %≤IdC<90 %,
// 0 sinon. On projette large au-delà du court terme, mais on tronque les basses certitudes.
const CONF_FULL = 0.9, CONF_PARTIAL = 0.7, PARTIAL_RATE = 0.2;
const projectionWeight = (o) => {
  const p = o.probability || 0, amt = o.amount || 0;
  if (p >= CONF_FULL) return amt;          // 100 %
  if (p >= CONF_PARTIAL) return amt * PARTIAL_RATE; // 20 %
  return 0;
};

/**
 * @param {object[]} orders
 * @param {object[]} invoices
 * @param {object[]} opps
 * @param {object[]} objectives
 * @param {number} fy année fiscale courante
 * @param {string} [asOf] date du jour (YYYY-MM-DD) : borne basse de la fenêtre D Prev
 */
function atterrissage(orders, invoices, opps, objectives, fy, asOf) {
  const realiseCas = sum(orders.filter((o) => (o.yearPo || 0) === fy), (o) => o.cas);
  const backlog = sum(orders.filter((o) => (o.raf || 0) > 0), (o) => Math.max(o.raf || 0, 0));
  // Fenêtre D Prev : clôture prévue entre aujourd'hui (asOf) et la fin de l'exercice.
  // → exclut les projections OBSOLÈTES (D Prev déjà passée) et celles prévues en N+1 ou plus.
  const lo = asOf || `${fy}-01-01`;
  const hi = `${fy}-12-31`;
  const inWindow = (o) => o.closingDate && o.closingDate >= lo && o.closingDate <= hi;
  const isActive = (o) => o.stage >= 1 && o.stage <= 5; // ni gagné (6), ni perdu (7), ni suspendu (8)
  // Pipeline de projection : opps actives dans la fenêtre, pondérées 100 %/20 % par certitude.
  const pipelinePondere = sum(opps.filter((o) => isActive(o) && inWindow(o)), projectionWeight);
  const objGlobal = objectives.filter((o) => Number(o.fiscalYear) === fy && (!o.scope || o.scope === "global"));
  const objectif = sum(objGlobal, (o) => o.targetCas);       // cible CAS (prise de commande)
  const objectifCaf = sum(objGlobal, (o) => o.targetInvoiced); // cible CAF (facturation)
  const projete = realiseCas + pipelinePondere;

  const factureN = sum(invoices.filter((i) => yearOf(i.date) === String(fy)), (i) => i.amountHt);
  const factureN1 = sum(invoices.filter((i) => yearOf(i.date) === String(fy - 1)), (i) => i.amountHt);

  // Projection CAF (facturation) : ce qui sera in fine facturé = déjà facturé (CAF réalisé)
  // + backlog écoulable (RAF des commandes signées, reste à facturer) + pipeline pondéré
  // (futures commandes facturables). Le backlog Y ENTRE (contrairement au projeté CAS, où
  // le CAS inclut déjà le RAF). Pas de double compte : facturé, RAF et futur sont disjoints.
  const cafProjete = factureN + backlog + pipelinePondere;

  return {
    fy,
    realiseCas,
    backlog,
    pipelinePondere,
    projete,
    cafProjete,
    objectif,
    ecart: projete - objectif,
    probaAtteinte: objectif > 0 ? Math.min(1, projete / objectif) : 0,
    // Atterrissage CAF (facturation) vs cible de facturation (targetInvoiced).
    objectifCaf,
    ecartCaf: cafProjete - objectifCaf,
    probaAtteinteCaf: objectifCaf > 0 ? Math.min(1, cafProjete / objectifCaf) : 0,
    factureN,
    factureN1,
    croissanceFacture: factureN1 > 0 ? (factureN - factureN1) / factureN1 : 0,
  };
}

module.exports = { atterrissage };
