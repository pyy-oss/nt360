// Backlog ancré sur l'année fiscale courante (BUILD_KIT §7, §5).
// Total + ventilations sur TOUTES les commandes ouvertes (RAF>0), indépendant de la période.
const { sum } = require("./chaine");
const { plausibleYear } = require("../lib/ids");

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
 * @param {object} [opts] { dormantYears } — seuil du dormant (config/alerts, défaut 2 comme thresholds)
 */
function backlogFy(orders, fy, opts = {}) {
  const open = orders.filter((o) => (o.raf || 0) > 0);
  const raf = (o) => Math.max(o.raf || 0, 0);
  // Défauts obligatoires : Firestore refuse toute valeur `undefined` dans un document écrit.
  // Certaines commandes ouvertes ont un bu/client/fp non renseigné → on normalise ici.
  const top = [...open]
    .sort((a, b) => raf(b) - raf(a))
    .slice(0, 10)
    .map((o) => ({ fp: o.fp || "", client: o.client || "", affaire: o.affaire || "", bu: o.bu || "AUTRE", raf: raf(o) }));

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
      fp: o.fp || "", client: o.client || "", affaire: o.affaire || "", bu: o.bu || "AUTRE", source: o.source || null,
      yearPo: o.yearPo || 0, cas: o.cas || 0, facture: o.facture || 0, raf: raf(o),
    }));

  // Commandes DORMANTES (MÊME prédicat que l'alerte backlog_dormant, domain/alerts.js) : millésime
  // plausible ≤ fy − dormantYears. Liste bornée 25 + VRAI compte — l'alerte routait vers le cockpit
  // Backlog qui n'offrait AUCUNE liste énumérable (audit backlog M7) ; la voici.
  const dy = Number(opts.dormantYears) || 2;
  const dormant = (fy || 0) > 0 ? open.filter((o) => { const py = plausibleYear(o.yearPo); return py > 0 && py <= fy - dy; }) : [];
  const dormantTop = [...dormant].sort((a, b) => raf(b) - raf(a)).slice(0, 25)
    .map((o) => ({ fp: o.fp || "", client: o.client || "", affaire: o.affaire || "", bu: o.bu || "AUTRE", yearPo: plausibleYear(o.yearPo) || 0, raf: raf(o) }));

  return {
    fy: fy || 0,
    total: sum(open, raf),
    count: open.length,
    byBu: groupSum(open, (o) => o.bu, raf),
    byClient: groupSum(open, (o) => o.client, raf),
    // Millésime BORNÉ (plausibleYear) : sinon des barres 1900/20226 apparaissent au chart « Par
    // millésime » alors qu'aucun onglet de période ne les liste (filterOrders borne aussi) → cohérence.
    byVintage: groupSum(open, (o) => String(plausibleYear(o.yearPo) || 0), raf),
    top,
    // Ventilation par fiabilité du RAF (diagnostic backlog).
    totalExcel: sum(excel, raf),
    totalDerive: sum(derive, raf),
    countExcel: excel.length,
    countDerive: derive.length,
    deriveTop,
    dormantTop,
    dormantCount: dormant.length,
    dormantYears: dy,
  };
}

module.exports = { backlogFy, groupSum };
