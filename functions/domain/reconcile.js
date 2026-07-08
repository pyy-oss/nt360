// DOSSIER CLIENT — rapprochement Opportunité / Commande P&L / Facture, pour faciliter la
// réconciliation des N° FP. Fonction PURE (aucun I/O) : reçoit les lignes déjà lues + les résolveurs
// de canonisation (client + N° FP avec alias appliqués), regroupe par CLIENT canonique puis par N° FP
// canonique, et détecte les écarts de rapprochement.
//
// HIÉRARCHIE D'AUTORITÉ DU N° FP (règle métier confirmée) : FACTURE > COMMANDE P&L > OPPORTUNITÉ.
// « Si une facture existe, son N° FP fait toujours foi » (il porte la facturation). On propose donc
// toujours d'aligner le FP le MOINS autoritaire vers le PLUS autoritaire.
//
// Deux écarts actionnables détectés (conservateur : uniquement quand un jumeau de MÊME montant existe
// sous un autre FP du même client — sinon on n'invente pas de rapprochement) :
//   A. Opp GAGNÉE sans commande P&L, alors qu'une commande/facture de même montant existe sous un
//      autre FP → aligner le FP de l'opp vers ce FP d'autorité (facture prioritaire).
//   B. Commande sans facture, alors qu'une facture ORPHELINE de même montant existe sous un autre FP
//      → le FP FACTURE fait foi → aligner le FP de la commande vers le FP de la facture.

const { fpKey } = require("../lib/ids");

const WON_STAGE = 6;
// Proximité relative (défaut 1 %) : deux montants « du même ordre » sont considérés identiques malgré
// les arrondis. max(|a|,|b|,1) évite la division par ~0 et le faux positif 0≈0.
const near = (a, b, tol) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b), 1) * tol;
const sum = (rows, f) => rows.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/** Regroupe et diagnostique par client. Renvoie un tableau de dossiers triés (écarts d'abord).
 *  @param fpKeyOf  fp brut → clé FP canonique (alias appliqués) ou null si illisible.
 *  @param normClient client brut → nom canonique.
 *  @param tolerancePct proximité de montant pour apparier un jumeau (défaut 0.01). */
function reconcileClients({ orders = [], invoices = [], opps = [], fpKeyOf, normClient, tolerancePct = 0.01 }) {
  const keyOf = typeof fpKeyOf === "function" ? fpKeyOf : (fp) => fpKey(fp);
  const nc = typeof normClient === "function" ? normClient : (c) => String(c || "").trim().toUpperCase();

  // client → Map(fpKey → { fp, opps[], orders[], invoices[] })
  const byClient = new Map();
  const add = (stream, row) => {
    const k = keyOf(row.fp);
    if (!k) return; // sans N° FP exploitable → non rapprochable par FP (traité ailleurs : anomalies)
    const client = nc(row.client) || "(sans client)";
    let clusters = byClient.get(client);
    if (!clusters) byClient.set(client, (clusters = new Map()));
    let c = clusters.get(k);
    if (!c) clusters.set(k, (c = { fp: k, opps: [], orders: [], invoices: [] }));
    c[stream].push(row);
  };
  for (const o of orders) add("orders", o);
  for (const i of invoices) add("invoices", i);
  for (const p of opps) add("opps", p);

  const out = [];
  for (const [client, cmap] of byClient) {
    const clusters = [...cmap.values()].map((c) => {
      const oppAmount = sum(c.opps, (x) => x.amount);
      const orderCas = sum(c.orders, (x) => x.cas);
      const invoiceTotal = sum(c.invoices, (x) => x.amountHt);
      const hasOrder = c.orders.length > 0;
      const hasInvoice = c.invoices.length > 0;
      const won = c.opps.some((x) => Number(x.stage) === WON_STAGE);
      return { ...c, oppAmount, orderCas, invoiceTotal, hasOrder, hasInvoice, won };
    });
    // FP d'AUTORITÉ = cluster portant une facture (prioritaire) ou une commande P&L.
    const authoritative = clusters.filter((c) => c.hasInvoice || c.hasOrder);
    // Meilleur jumeau d'autorité (≠ soi) de montant proche ; facture prioritaire, puis écart minimal.
    const bestTwin = (fp, amt) => authoritative
      .filter((t) => t.fp !== fp)
      .map((t) => ({ t, amt: t.hasInvoice ? t.invoiceTotal : t.orderCas, prio: t.hasInvoice ? 0 : 1 }))
      .filter((x) => near(amt, x.amt, tolerancePct))
      .sort((a, b) => a.prio - b.prio || Math.abs(amt - a.amt) - Math.abs(amt - b.amt))[0];

    const suggestions = [];
    let wonNoPnl = 0;
    for (const c of clusters) {
      // A. Opp gagnée sans commande P&L → cible = jumeau d'autorité de même montant.
      if (c.won && !c.hasOrder) {
        wonNoPnl++;
        const cand = bestTwin(c.fp, c.oppAmount);
        if (cand) suggestions.push({ from: c.fp, to: cand.t.fp, reason: "opp_gagnee_sans_pnl", targetHasInvoice: cand.t.hasInvoice });
        continue;
      }
      // B. Commande SANS facture sous son FP, mais facture ORPHELINE de même montant sous un autre FP
      //    → le FP FACTURE fait foi → aligner la commande vers le FP de la facture.
      if (c.hasOrder && !c.hasInvoice) {
        const inv = clusters
          .filter((t) => t.fp !== c.fp && t.hasInvoice && !t.hasOrder && near(c.orderCas, t.invoiceTotal, tolerancePct))
          .sort((a, b) => Math.abs(c.orderCas - a.invoiceTotal) - Math.abs(c.orderCas - b.invoiceTotal))[0];
        if (inv) suggestions.push({ from: c.fp, to: inv.fp, reason: "facture_sous_autre_fp", targetHasInvoice: true });
      }
    }
    const counts = {
      opps: sum(clusters, (c) => c.opps.length),
      orders: sum(clusters, (c) => c.orders.length),
      invoices: sum(clusters, (c) => c.invoices.length),
    };
    out.push({ client, clusters, authoritativeFps: authoritative.map((c) => c.fp), suggestions, wonNoPnl, counts });
  }
  // Tri : d'abord les clients avec le plus de rapprochements proposés, puis opp gagnées orphelines.
  out.sort((a, b) => b.suggestions.length - a.suggestions.length || b.wonNoPnl - a.wonNoPnl || a.client.localeCompare(b.client));
  return out;
}

module.exports = { reconcileClients, WON_STAGE };
