// Reporting facturation / rentabilité / clients / domaines (BUILD_KIT §6, §7).
const { sum } = require("./chaine");
const { groupSum } = require("./backlog");
const { fpKey } = require("../lib/ids");

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
    // Défauts explicites (jamais undefined dans Firestore) : fp/client/am peuvent manquer.
    .map((o) => ({ fp: o.fp || "", client: o.client || "", am: o.am || "", base: baseFn(o), mb: mbFn(o), pmb: mbFn(o) / baseFn(o) }))
    .sort((a, b) => a.pmb - b.pmb)
    .slice(0, 10);
  return { base, mb, pmb: base > 0 ? mb / base : 0, byBu, byAm, bottomAffaires, topClients: topN(groupSum(orders, (o) => o.client, mbFn)) };
}

// Taux de marge d'une commande (marge P&L / CAS), avec repli sur marginPct quand CAS = 0.
const marginRate = (o) => ((o && (o.cas || 0) > 0) ? (o.mb || 0) / o.cas : (o && o.marginPct) || 0);

// Lignes « affaire » de la perspective Facturé : on part des FACTURES DATÉES dans la période
// (même assiette que la vue Facturation — source de vérité du facturé), agrégées par FP. La marge
// est reconnue au taux de la commande (P&L) rattachée au FP, appliqué au montant facturé. Le
// domaine/AM/client provient de la commande (sinon de la facture). Attribuer par DATE de facture
// (et non par année de PO) évite l'inversion entre exercices d'un FP signé en N mais facturé en N+1.
function factureLines(invoices, ordersByFp) {
  const byFp = {};
  for (const i of invoices || []) {
    const k = fpKey(i.fp) || i.fp || "—";
    const o = ordersByFp[k] || {};
    // Défauts explicites "" / "AUTRE" : ni la facture ni la commande orpheline n'ont forcément bu/am/client.
    const line = byFp[k] || (byFp[k] = { fp: k, base: 0, rate: marginRate(o), bu: o.bu || i.bu || "AUTRE", am: o.am || i.am || "", client: o.client || i.client || "" });
    line.base += i.amountHt || 0;
  }
  return Object.values(byFp).map((l) => ({ ...l, mb: l.rate * l.base }));
}

/**
 * Rentabilité (P&L) : deux perspectives (§ module 7).
 *  • Commande : assiette = CAS (prise de commande, cohorte yearPo), marge = marge P&L.
 *  • Facturé  : assiette = Facturé (factures DATÉES dans la période, comme la vue Facturation),
 *    marge = taux de marge de la commande rattachée × montant facturé.
 * Champs racine = perspective Commande (rétro-compat : cas / byBu[cas] / bottomAffaires[cas]).
 * @param {object[]} orders commandes de la cohorte (période, par yearPo) — perspective Commande
 * @param {object[]} invoices factures DATÉES dans la période — perspective Facturé
 * @param {object[]} allOrders toutes les commandes (rattachement FP→taux/BU/AM/client des factures)
 */
function rentabilite(orders, invoices = [], allOrders = orders) {
  const ordersByFp = {};
  for (const o of allOrders || []) { const k = fpKey(o.fp) || o.fp; if (k) ordersByFp[k] = o; }
  const commande = perspective(orders, (o) => o.cas || 0, (o) => o.mb || 0);
  const facture = perspective(factureLines(invoices, ordersByFp), (l) => l.base, (l) => l.mb);
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
