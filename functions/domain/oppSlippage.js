// GLISSEMENT DES DEALS (« slippage ») — dérivé du JOURNAL des changements de D Prev (closingDate) des
// opportunités actives (oppDateHistory), journalisé à chaque édition (patch/upsert). Comme le funnel réel,
// il se construit à partir de MAINTENANT (la source n'a pas d'historique rétroactif de dates). Par opp, on
// prend le mouvement NET sur la fenêtre : de la PLUS ANCIENNE `fromDate` à la PLUS RÉCENTE `toDate` (ordre
// chronologique via `atMs`). Une clôture repoussée dans le temps = deal qui GLISSE ; on agrège le montant
// glissé par CATÉGORIE de prévision et par COMMERCIAL. PUR (aucun I/O) → testable.
const { effectiveCategory } = require("./forecast");

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const normAm = (a) => (a && String(a).trim().toUpperCase()) || "—";
const iso10 = (d) => String(d == null ? "" : d).slice(0, 10);
const daysBetween = (fromIso, toIso) => {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromIso), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIso);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
};

/**
 * Agrège le glissement à partir du journal des changements de D Prev.
 * @param {Array<{oppId?:string,fromDate?:string,toDate?:string,amount?:number,am?:string,stage?:number,forecastCategory?:string,client?:string,atMs?:number}>} events
 * @returns {{slipCount:number,slipAmount:number,pullCount:number,pullAmount:number,avgSlipDays:number,
 *            byCategory:{commit:number,best_case:number,pipeline:number},byAm:{am:string,amount:number,count:number}[],
 *            items:{oppId:string,client:string,am:string,amount:number,fromDate:string,toDate:string,days:number}[]}}
 */
function slippageFromHistory(events) {
  const byOpp = new Map();
  for (const e of events || []) {
    const id = String((e && e.oppId) || "");
    if (!id) continue;
    let g = byOpp.get(id); if (!g) { g = []; byOpp.set(id, g); }
    g.push(e);
  }
  let slipCount = 0, slipAmount = 0, pullCount = 0, pullAmount = 0, slipDaysTotal = 0;
  const byCategory = { commit: 0, best_case: 0, pipeline: 0 };
  const byAmMap = new Map();
  const items = [];
  for (const evs of byOpp.values()) {
    evs.sort((a, b) => (Number(a.atMs) || 0) - (Number(b.atMs) || 0));
    const first = evs[0], last = evs[evs.length - 1];
    const fromD = iso10(first.fromDate), toD = iso10(last.toDate);
    if (!ISO.test(fromD) || !ISO.test(toD) || toD === fromD) continue; // mouvement net nul ou dates invalides
    // Le glissement ne concerne que les opps ACTIVES (cf. doc) : une opp Gagnée/Perdue/omise ne « glisse » plus.
    // Filtrer ici garde slipAmount = Σ byCategory (invariant de cohérence) et pullAmount sur la même assiette.
    const cat = effectiveCategory({ stage: last.stage, forecastCategory: last.forecastCategory });
    if (cat !== "commit" && cat !== "best_case" && cat !== "pipeline") continue;
    const amount = Number(last.amount) || 0;
    if (toD > fromD) { // clôture repoussée → glissement
      const days = daysBetween(fromD, toD);
      slipCount++; slipAmount += amount; slipDaysTotal += days;
      byCategory[cat] += amount;
      const am = normAm(last.am);
      const e = byAmMap.get(am) || { am, amount: 0, count: 0 }; e.amount += amount; e.count++; byAmMap.set(am, e);
      items.push({ oppId: String(last.oppId || ""), client: last.client || "", am, amount, fromDate: fromD, toDate: toD, days });
    } else { // clôture avancée → « pull-in »
      pullCount++; pullAmount += amount;
    }
  }
  items.sort((a, b) => b.amount - a.amount || b.days - a.days);
  const byAm = [...byAmMap.values()].sort((a, b) => b.amount - a.amount);
  return {
    slipCount, slipAmount, pullCount, pullAmount,
    avgSlipDays: slipCount > 0 ? Math.round(slipDaysTotal / slipCount) : 0,
    byCategory, byAm, items: items.slice(0, 50),
  };
}

module.exports = { slippageFromHistory };
