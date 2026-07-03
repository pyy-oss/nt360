// Backlog ancré sur l'année fiscale courante (BUILD_KIT §7, §5).
// Total + ventilations sur TOUTES les commandes ouvertes (RAF>0), indépendant de la période.
const { sum } = require("./chaine");

function groupSum(items, keyFn, valFn) {
  const m = {};
  for (const it of items) {
    const k = keyFn(it) || "AUTRE";
    m[k] = (m[k] || 0) + (valFn(it) || 0);
  }
  return m;
}

/**
 * @param {object[]} orders commandes
 * @param {number} fy année fiscale courante (config/fiscal.currentFy)
 */
function backlogFy(orders, fy) {
  const open = orders.filter((o) => (o.raf || 0) > 0);
  const raf = (o) => Math.max(o.raf || 0, 0);
  const top = [...open]
    .sort((a, b) => raf(b) - raf(a))
    .slice(0, 10)
    .map((o) => ({ fp: o.fp, client: o.client, bu: o.bu, raf: raf(o) }));

  // Diagnostic de fiabilité : ventile le RAF ouvert selon son origine.
  //   • « excel »  = RAF total curaté de l'Excel P&L (fiable).
  //   • « derive » = CAS − facturé (surévalué : opp gagnée / fiche sans base P&L, ou facture
  //     non rattachée au FP). C'est cette population qui gonfle le backlog.
  const excel = open.filter((o) => o.rafSource === "excel");
  const derive = open.filter((o) => o.rafSource !== "excel");
  const deriveTop = [...derive]
    .sort((a, b) => raf(b) - raf(a))
    .slice(0, 25)
    .map((o) => ({
      fp: o.fp, client: o.client, bu: o.bu, source: o.source || null,
      yearPo: o.yearPo || 0, cas: o.cas || 0, facture: o.facture || 0, raf: raf(o),
    }));

  return {
    fy: fy || 0,
    total: sum(open, raf),
    count: open.length,
    byBu: groupSum(open, (o) => o.bu, raf),
    byClient: groupSum(open, (o) => o.client, raf),
    byVintage: groupSum(open, (o) => String(o.yearPo || 0), raf),
    top,
    // Ventilation par fiabilité du RAF (diagnostic backlog).
    totalExcel: sum(excel, raf),
    totalDerive: sum(derive, raf),
    countExcel: excel.length,
    countDerive: derive.length,
    deriveTop,
  };
}

module.exports = { backlogFy, groupSum };
