// Atterrissage annuel (BUILD_KIT §7) : projeté = Réalisé CAS(FY) + pipeline pondéré
// (closing FY) → vs objectifs, avec écart et probabilité d'atteinte. Le backlog est
// exposé séparément (informatif) mais N'ENTRE PAS dans le projeté (déjà couvert par le
// CAS réalisé — l'ajouter double-compterait). + comparaison N vs N-1 sur la facturation.
const { sum } = require("./chaine");
const { isEligible } = require("./pipeline");

const yearOf = (d) => (d ? String(d).slice(0, 4) : "");

/**
 * @param {object[]} orders
 * @param {object[]} invoices
 * @param {object[]} opps
 * @param {object[]} objectives
 * @param {number} fy année fiscale courante
 */
function atterrissage(orders, invoices, opps, objectives, fy) {
  const realiseCas = sum(orders.filter((o) => (o.yearPo || 0) === fy), (o) => o.cas);
  const backlog = sum(orders.filter((o) => (o.raf || 0) > 0), (o) => Math.max(o.raf || 0, 0));
  // Pondéré = opportunités éligibles (non perdu/suspendu, IdC ≥ 90 %) clôturant en FY.
  const pipelinePondere = sum(
    opps.filter((o) => isEligible(o) && yearOf(o.closingDate) === String(fy)),
    (o) => o.weighted
  );
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
