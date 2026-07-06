// Signaux BC ⇄ ClickUp : à partir des lignes bcLines enrichies de l'overlay de synchro inverse
// (clickupBcStatus / clickupBcEta / clickupBcTaskId), produit un état d'avancement achat consolidé
// PAR BON DE COMMANDE (N° BC) : lié ou non, en retard (ETA ClickUp dépassée et non livré/annulé),
// répartition par statut d'avancement. Alimente la carte de suivi et l'Actualité. PUR.
//
// « livre » / « annule » = terminaux (jamais en retard) ; tout autre statut ClickUp = achat en cours.
const DONE = new Set(["livre", "annule"]);

function clickupBcSignals(bcLines, asOfMs) {
  const now = Number.isFinite(asOfMs) ? asOfMs : Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const byNumber = new Map(); // N° BC → agrégat (un BC = une tâche)
  for (const b of bcLines || []) {
    const num = String(b.bcNumber || "").trim();
    if (!num) continue;
    const g = byNumber.get(num) || { bcNumber: num, supplier: b.supplier || "", linked: false, status: null, eta: null };
    if (b.clickupBcTaskId) g.linked = true;
    if (b.clickupBcStatus && !g.status) g.status = b.clickupBcStatus;
    if (b.clickupBcStatusRaw && !g.statusRaw) g.statusRaw = b.clickupBcStatusRaw;
    if (b.clickupBcEta && !g.eta) g.eta = b.clickupBcEta;
    if (!g.supplier && b.supplier) g.supplier = b.supplier;
    byNumber.set(num, g);
  }
  const groups = [...byNumber.values()];
  const linked = groups.filter((g) => g.linked);
  const byStatus = {};
  for (const g of linked) { const s = g.statusRaw || g.status || "—"; byStatus[s] = (byStatus[s] || 0) + 1; }
  // En retard : ETA ClickUp dépassée et statut d'avancement non terminal.
  const overdue = linked.filter((g) => g.eta && Number(g.eta) < now && !DONE.has(g.status || "en_cours"));
  overdue.sort((a, b) => Number(a.eta) - Number(b.eta));
  return {
    totalBc: groups.length,
    linkedCount: linked.length,
    overdueCount: overdue.length,
    byStatus,
    overdue: overdue.slice(0, 50).map((g) => ({ bcNumber: g.bcNumber, supplier: g.supplier, status: g.statusRaw || g.status || null, eta: g.eta ? new Date(Number(g.eta)).toISOString().slice(0, 10) : null })),
    overdueRefs: overdue.slice(0, 20).map((g) => g.bcNumber),
  };
}

module.exports = { clickupBcSignals };
