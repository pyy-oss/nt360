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

// Une PERSPECTIVE de rentabilité = même structure (base, marge, %MB, par domaine/AM, faibles
// marges, top clients) calculée sur une ASSIETTE donnée : Commande (CAS) ou Facturé (CAF). La
// marge d'une perspective se déduit de la marge P&L : en Commande = marge P&L brute ; en Facturé
// = taux de marge de la commande appliqué au montant réellement facturé (marge reconnue au
// prorata de la facturation). `base` porte l'assiette (CAS ou Facturé) pour un rendu générique.
function perspective(orders, baseFn, mbFn) {
  const base = sum(orders, baseFn);
  const mb = sum(orders, mbFn);
  const baseByBu = groupSum(orders, (o) => o.bu, baseFn);
  const mbByBu = groupSum(orders, (o) => o.bu, mbFn);
  const byBu = Object.keys({ ...baseByBu, ...mbByBu }).map((bu) => ({
    bu, base: baseByBu[bu] || 0, mb: mbByBu[bu] || 0,
    pmb: baseByBu[bu] > 0 ? (mbByBu[bu] || 0) / baseByBu[bu] : 0,
  }));
  const baseByAm = groupSum(orders, (o) => o.am || "—", baseFn);
  const mbByAm = groupSum(orders, (o) => o.am || "—", mbFn);
  const byAm = Object.keys({ ...baseByAm, ...mbByAm })
    .map((am) => ({ am, base: baseByAm[am] || 0, mb: mbByAm[am] || 0, pmb: baseByAm[am] > 0 ? (mbByAm[am] || 0) / baseByAm[am] : 0 }))
    .sort((a, b) => b.base - a.base);
  // Affaires à FAIBLE marge (chasse aux marges) : %MB croissant, sur assiette > 0.
  const bottomAffaires = orders
    .filter((o) => baseFn(o) > 0)
    .map((o) => ({ fp: o.fp, client: o.client, am: o.am, base: baseFn(o), mb: mbFn(o), pmb: mbFn(o) / baseFn(o) }))
    .sort((a, b) => a.pmb - b.pmb)
    .slice(0, 10);
  return { base, mb, pmb: base > 0 ? mb / base : 0, byBu, byAm, bottomAffaires, topClients: topN(groupSum(orders, (o) => o.client, mbFn)) };
}

/**
 * Rentabilité (P&L) : deux perspectives (§ module 7).
 *  • Commande : assiette = CAS (prise de commande), marge = marge P&L.
 *  • Facturé  : assiette = Facturé (CAF), marge = taux de marge de la commande × facturé.
 * Champs racine = perspective Commande (rétro-compat : cas / byBu[cas] / bottomAffaires[cas]).
 */
function rentabilite(orders) {
  const rate = (o) => ((o.cas || 0) > 0 ? (o.mb || 0) / o.cas : (o.marginPct || 0));
  const commande = perspective(orders, (o) => o.cas || 0, (o) => o.mb || 0);
  const facture = perspective(orders, (o) => o.facture || 0, (o) => rate(o) * (o.facture || 0));
  return {
    // Rétro-compat : perspective Commande à plat, assiette nommée `cas`.
    mb: commande.mb, cas: commande.base, pmb: commande.pmb,
    byBu: commande.byBu.map((b) => ({ bu: b.bu, cas: b.base, mb: b.mb, pmb: b.pmb })),
    byAm: commande.byAm.map((a) => ({ am: a.am, cas: a.base, mb: a.mb, pmb: a.pmb })),
    bottomAffaires: commande.bottomAffaires.map((o) => ({ fp: o.fp, client: o.client, am: o.am, cas: o.base, mb: o.mb, pmb: o.pmb })),
    topClients: commande.topClients,
    // Perspectives génériques (assiette = `base`) pour le sélecteur Commande / Facturé.
    perspectives: { commande, facture },
  };
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
