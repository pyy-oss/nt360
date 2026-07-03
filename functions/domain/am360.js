// AM 360° — rcollationne, par commercial (Account Manager), les indicateurs de pilotage
// individuel : prise de commande (CAS), facturé (CAF, relié via la clé FP→AM des commandes),
// backlog (RAF), pipeline pondéré + conversion, et R/O vs objectif CAS de l'exercice.
// VOLONTAIREMENT SANS MARGE (confidentialité — la marge par AM reste dans « Rentabilité »).
// Module PUR (testable).
const { sum, projectionWeight } = require("./chaine");

const normAm = (a) => (a && String(a).trim()) || "—";

/**
 * @param {object[]} orders commandes fusionnées (am, cas, raf, yearPo, fp)
 * @param {object[]} invoices factures (fp, amountHt)
 * @param {object[]} opps opportunités (am, stage, probability, weighted)
 * @param {object[]} objectives objectifs (scope, scopeValue, fiscalYear, targetCas)
 * @param {number|string} fy exercice courant (pour le R/O)
 */
function am360(orders, invoices, opps, objectives, fy) {
  // FP → AM (depuis les commandes) pour rattacher les factures à un commercial.
  const amOfFp = {};
  for (const o of orders || []) if (o.fp) amOfFp[o.fp] = normAm(o.am);

  const objByAm = {};
  for (const ob of objectives || []) {
    if (ob.scope === "commercial" && String(ob.fiscalYear) === String(fy)) {
      objByAm[normAm(ob.scopeValue).toUpperCase()] = ob;
    }
  }

  const ams = new Set();
  (orders || []).forEach((o) => ams.add(normAm(o.am)));
  (opps || []).forEach((o) => ams.add(normAm(o.am)));

  const rows = [...ams]
    .filter((am) => am && am !== "—")
    .map((am) => {
      const os = (orders || []).filter((o) => normAm(o.am) === am);
      const cas = sum(os, (o) => o.cas);
      const casFy = sum(os.filter((o) => String(o.yearPo) === String(fy)), (o) => o.cas);
      const backlog = sum(os, (o) => Math.max(o.raf || 0, 0));
      const facture = sum((invoices || []).filter((i) => normAm(amOfFp[i.fp]) === am), (i) => i.amountHt);

      const myOpps = (opps || []).filter((o) => normAm(o.am) === am);
      const active = myOpps.filter((o) => o.stage >= 1 && o.stage <= 5);
      const won = myOpps.filter((o) => o.stage === 6).length;
      const lost = myOpps.filter((o) => o.stage === 7).length;
      // « Pondéré » = PROJECTION tiérée (100/20/10), cohérent avec pipeline/atterrissage.
      const pipelinePondere = sum(active, projectionWeight);

      const ob = objByAm[am.toUpperCase()];
      const targetCas = ob ? ob.targetCas || 0 : 0;
      return {
        am, cas, casFy, backlog, facture,
        pipelinePondere, activeCount: active.length, won, lost,
        conv: won + lost > 0 ? won / (won + lost) : 0,
        targetCas, roCas: targetCas > 0 ? casFy / targetCas : null,
        orderCount: os.length,
      };
    })
    .filter((r) => r.cas > 0 || r.facture > 0 || r.pipelinePondere > 0 || r.activeCount > 0 || r.won + r.lost > 0)
    .sort((a, b) => b.cas - a.cas);

  return { rows, fy: Number(fy) || null };
}

module.exports = { am360 };
