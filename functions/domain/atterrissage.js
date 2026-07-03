// Atterrissage annuel (BUILD_KIT §7) : projeté = Réalisé CAS(FY) + pipeline de PROJECTION
// (pondération tiérée par certitude, fenêtrée sur D Prev) → vs objectifs, écart, probabilité.
// Le backlog est exposé séparément (informatif) mais N'ENTRE PAS dans le projeté CAS (déjà
// couvert par le CAS réalisé). + comparaison N vs N-1 sur la facturation.
const { sum, projectionWeight } = require("./chaine");

const yearOf = (d) => (d ? String(d).slice(0, 4) : "");

// Pondération de PROJECTION unifiée (règle de gestion, chaine.projectionWeight) :
// 100 % (IdC ≥ 90 %) · 20 % (70-90 %) · 10 % (50-70 %) · 0 sinon. Même fonction partout.

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
  // Fenêtre D Prev = l'EXERCICE (D Prev dans l'année {fy}). Les certitudes GLISSENT jusqu'à
  // l'année en cours : une D Prev déjà PASSÉE dans l'exercice compte toujours (elle n'est pas
  // obsolète — elle est en retard mais sur l'année). On exclut seulement l'obsolète hors année :
  // D Prev en N-1 (année révolue) ou en N+1 et au-delà (non encore dans l'exercice).
  const inYear = (o) => yearOf(o.closingDate) === String(fy);
  const isActive = (o) => o.stage >= 1 && o.stage <= 5; // ni gagné (6), ni perdu (7), ni suspendu (8)
  // Pipeline de projection : opps actives de l'exercice, pondérées 100 %/20 % par certitude.
  const pipelinePondere = sum(opps.filter((o) => isActive(o) && inYear(o)), projectionWeight);
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
