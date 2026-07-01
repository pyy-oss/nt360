// Reporting facturation / rentabilité / clients / domaines (BUILD_KIT §6, §7).
const { sum } = require("./chaine");
const { groupSum } = require("./backlog");

const topN = (obj, n = 10) =>
  Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, value: v }));

/** Facturation : tendance mensuelle, mix BU, top clients (§ module 4). */
function facturation(invoices) {
  return {
    total: sum(invoices, (i) => i.amountHt),
    count: invoices.length,
    monthly: groupSum(invoices, (i) => (i.date ? String(i.date).slice(0, 7) : "?"), (i) => i.amountHt),
    byBu: groupSum(invoices, (i) => i.bu, (i) => i.amountHt),
    topClients: topN(groupSum(invoices, (i) => i.client, (i) => i.amountHt)),
  };
}

/** Rentabilité (P&L) : marge, %MB, par domaine, top clients (§ module 7). */
function rentabilite(orders) {
  const cas = sum(orders, (o) => o.cas);
  const mb = sum(orders, (o) => o.mb);
  const casByBu = groupSum(orders, (o) => o.bu, (o) => o.cas);
  const mbByBu = groupSum(orders, (o) => o.bu, (o) => o.mb);
  const byBu = Object.keys({ ...casByBu, ...mbByBu }).map((bu) => ({
    bu, cas: casByBu[bu] || 0, mb: mbByBu[bu] || 0,
    pmb: casByBu[bu] > 0 ? (mbByBu[bu] || 0) / casByBu[bu] : 0,
  }));
  return { mb, cas, pmb: cas > 0 ? mb / cas : 0, byBu, topClients: topN(groupSum(orders, (o) => o.client, (o) => o.mb)) };
}

/** Indicateurs par entité (client ou BU) : CAS/Facturé/Backlog/Marge/%MB (§ modules 11-12). */
function byEntity(orders, invoices, keyFn) {
  const m = {};
  const get = (k) => (m[k] = m[k] || { key: k, cas: 0, facture: 0, backlog: 0, mb: 0 });
  for (const o of orders) {
    const a = get(keyFn(o) || "AUTRE");
    a.cas += o.cas || 0;
    a.backlog += Math.max(o.raf || 0, 0);
    a.mb += o.mb || 0;
  }
  for (const i of invoices) {
    const a = get(keyFn(i) || "AUTRE");
    a.facture += i.amountHt || 0;
  }
  return Object.values(m)
    .map((a) => ({ ...a, pmb: a.cas > 0 ? a.mb / a.cas : 0 }))
    .sort((x, y) => y.cas - x.cas)
    .slice(0, 100);
}

module.exports = { facturation, rentabilite, byEntity, topN };
