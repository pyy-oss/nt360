// Signaux dérivés de la synchro inverse ClickUp (statut projet + dates) : PUR, testable.
//  1) RETARD DE LIVRAISON : date contractuelle dépassée alors que le projet est encore « actif »
//     (pas livré/facturé/clôturé). Signal NOUVEAU, distinct du retard de FACTURATION.
//  2) INCOHÉRENCES statut ClickUp ↔ données app : « facturé » sans CAF rattaché ; « clôturé » avec
//     RAF non nul. Alimentent le cockpit Qualité.
const isoDay = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : null);
// Insensible aux diacritiques : « 9-Clôturé » doit matcher le préfixe « 9-clotur ».
const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// Statuts « actifs » (projet PAS encore livré) : préfixes 0-affecté / 1-prise en charge / 3-en cours.
// Les autres (4-terminé, 5-facturé, 6-, 8-suivi, 9-, termine) = livré / clôturé / en suivi → pas en retard.
const ACTIVE_PREFIXES = ["0-", "1-", "3-"];
const isActive = (status) => ACTIVE_PREFIXES.some((p) => norm(status).startsWith(p));

/**
 * @param {object[]} orders commandes fusionnées (fp, client, facture, raf)
 * @param {Object<string,object>} syncMap overlay config/clickupSync { safeId(fp): { status, dateContractuelle } }
 * @param {(fp:string)=>string} safeId normalisation FP
 * @param {string} asOf date du jour (yyyy-mm-dd…)
 */
function clickupSignals(orders, syncMap, safeId, asOf) {
  const today = String(asOf || "").slice(0, 10);
  const map = syncMap || {};
  const overdue = [];
  const factSansCaf = [];
  const clotureRaf = [];
  for (const o of orders || []) {
    const cu = map[safeId(o.fp)];
    if (!cu) continue;
    const s = norm(cu.status);
    const dc = isoDay(cu.dateContractuelle);
    if (dc && today && dc < today && isActive(cu.status)) {
      overdue.push({ fp: o.fp, client: o.client || "", status: cu.status || "", dateContractuelle: dc, raf: o.raf || 0 });
    }
    if (s.startsWith("5-factur") && !((o.facture || 0) > 0)) factSansCaf.push(o.fp);
    if ((s.startsWith("9-clotur") || s === "termine") && (o.raf || 0) > 0) clotureRaf.push(o.fp);
  }
  overdue.sort((a, b) => (a.dateContractuelle < b.dateContractuelle ? -1 : 1));
  const issues = [];
  if (factSansCaf.length) issues.push({ type: "clickup_facture_sans_caf", severity: "medium", count: factSansCaf.length, label: "Statut ClickUp « facturé » mais aucun CAF dans l'app (facture non rattachée)", refs: factSansCaf.slice(0, 12) });
  if (clotureRaf.length) issues.push({ type: "clickup_cloture_avec_raf", severity: "medium", count: clotureRaf.length, label: "Projet ClickUp clôturé mais RAF non nul dans l'app (à solder)", refs: clotureRaf.slice(0, 12) });
  return { overdueCount: overdue.length, overdue, overdueRefs: overdue.map((x) => x.fp).slice(0, 12), issues };
}

// Écart en jours entre deux dates ISO (yyyy-mm-dd) : b − a (positif si b après a).
function daysDiff(a, b) {
  const ta = Date.parse(a + "T00:00:00Z"), tb = Date.parse(b + "T00:00:00Z");
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round((tb - ta) / 86400000);
}

/**
 * Analytique des DÉLAIS et ÉCHÉANCES ClickUp (PUR) :
 *  - byPm      : par Project Manager — projets actifs, en retard, retard moyen (jours).
 *  - byStatus  : distribution des projets synchronisés par statut, dont en retard.
 *  - rafByMonth: RAF des projets ACTIFS regroupé par mois de la date prév. de fin (Délai Prévisonnel)
 *                → « quand le backlog devrait se facturer selon ClickUp ».
 * @param {(fp:string)=>string} safeId  ; orderPmMap : { safeId(fp): pm }
 */
function clickupDelays(orders, syncMap, orderPmMap, safeId, asOf) {
  const today = String(asOf || "").slice(0, 10);
  const map = syncMap || {};
  const pmMap = orderPmMap || {};
  const byPm = new Map();
  const byStatus = new Map();
  const byMonth = new Map();
  let overdueTotal = 0, sumLate = 0;
  for (const o of orders || []) {
    const key = safeId(o.fp);
    const cu = map[key];
    if (!cu) continue;
    const status = cu.status || "—";
    const active = isActive(status);
    const dc = isoDay(cu.dateContractuelle);
    const late = !!(active && dc && today && dc < today);
    const daysLate = late ? daysDiff(dc, today) : 0;

    const bs = byStatus.get(status) || { status, count: 0, overdue: 0 };
    bs.count++; if (late) bs.overdue++;
    byStatus.set(status, bs);

    const pm = pmMap[key];
    if (pm) {
      const bp = byPm.get(pm) || { pm, active: 0, overdue: 0, sumLate: 0 };
      if (active) bp.active++;
      if (late) { bp.overdue++; bp.sumLate += daysLate; }
      byPm.set(pm, bp);
    }
    if (active) {
      const fin = isoDay(cu.dateFinPrev);
      const m = fin ? fin.slice(0, 7) : "(sans date)";
      const bm = byMonth.get(m) || { month: m, raf: 0, count: 0 };
      bm.raf += Number(o.raf || 0); bm.count++;
      byMonth.set(m, bm);
    }
    if (late) { overdueTotal++; sumLate += daysLate; }
  }
  return {
    overdueTotal,
    avgDaysLate: overdueTotal ? Math.round(sumLate / overdueTotal) : 0,
    byPm: [...byPm.values()].map((b) => ({ pm: b.pm, active: b.active, overdue: b.overdue, avgDaysLate: b.overdue ? Math.round(b.sumLate / b.overdue) : 0 }))
      .sort((a, b) => b.overdue - a.overdue || b.active - a.active),
    byStatus: [...byStatus.values()].sort((a, b) => b.count - a.count),
    rafByMonth: [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
  };
}

module.exports = { clickupSignals, isActive, clickupDelays, daysDiff };
