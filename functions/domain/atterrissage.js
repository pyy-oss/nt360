// Atterrissage annuel (BUILD_KIT §7) : Réalisé CAS(FY) + backlog facturable +
// pipeline pondéré (closing FY) → vs objectifs, avec écart et probabilité d'atteinte.
// + comparaison N vs N-1 sur la facturation.
const { sum } = require("./chaine");

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
  const pipelinePondere = sum(
    opps.filter((o) => o.stage >= 1 && o.stage <= 5 && yearOf(o.closingDate) === String(fy)),
    (o) => o.weighted
  );
  const objectif = sum(
    objectives.filter((o) => Number(o.fiscalYear) === fy && (!o.scope || o.scope === "global")),
    (o) => o.targetCas
  );
  const projete = realiseCas + pipelinePondere;

  const factureN = sum(invoices.filter((i) => yearOf(i.date) === String(fy)), (i) => i.amountHt);
  const factureN1 = sum(invoices.filter((i) => yearOf(i.date) === String(fy - 1)), (i) => i.amountHt);

  return {
    fy,
    realiseCas,
    backlog,
    pipelinePondere,
    projete,
    objectif,
    ecart: projete - objectif,
    probaAtteinte: objectif > 0 ? Math.min(1, projete / objectif) : 0,
    factureN,
    factureN1,
    croissanceFacture: factureN1 > 0 ? (factureN - factureN1) / factureN1 : 0,
  };
}

module.exports = { atterrissage };
