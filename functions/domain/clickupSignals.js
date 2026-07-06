// Signaux dérivés de la synchro inverse ClickUp (statut projet + dates) : PUR, testable.
//  1) RETARD DE LIVRAISON : date contractuelle dépassée alors que le projet est encore « actif »
//     (pas livré/facturé/clôturé). Signal NOUVEAU, distinct du retard de FACTURATION.
//  2) INCOHÉRENCES statut ClickUp ↔ données app : « facturé » sans CAF rattaché ; « clôturé » avec
//     RAF non nul. Alimentent le cockpit Qualité.
const isoDay = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : null);
const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();

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

module.exports = { clickupSignals, isActive };
