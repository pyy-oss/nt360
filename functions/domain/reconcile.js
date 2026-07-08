// DOSSIER CLIENT — rapprochement Opportunité / Commande P&L / Facture, pour faciliter la
// réconciliation des N° FP. Fonction PURE (aucun I/O) : reçoit les lignes déjà lues + les résolveurs
// de canonisation (client + N° FP avec alias appliqués), regroupe par CLIENT canonique puis par N° FP
// canonique, et détecte les écarts de rapprochement.
//
// HIÉRARCHIE D'AUTORITÉ DU N° FP (règle métier confirmée) : FACTURE > COMMANDE P&L > OPPORTUNITÉ.
// « Si une facture existe, son N° FP fait toujours foi » (il porte la facturation). On propose donc
// toujours d'aligner le FP le MOINS autoritaire vers le PLUS autoritaire.
//
// Deux écarts actionnables détectés (conservateur : on ne propose que sur un signal FORT) :
//   A. Opp GAGNÉE sans commande P&L, alors qu'une commande/facture existe sous un autre FP avec le
//      MÊME MONTANT ou la MÊME DÉSIGNATION/AFFAIRE → aligner le FP de l'opp vers ce FP d'autorité.
//   B. Commande sans facture, alors qu'une facture ORPHELINE existe sous un autre FP, soit de MÊME
//      MONTANT, soit — appariement NON AMBIGU (une seule commande vs une seule facture orpheline) —
//      partiellement facturée (facture < CAS) → le FP FACTURE fait foi → aligner la commande vers lui.
//
// Chaque proposition porte un niveau de CONFIANCE : « montant » (montants concordants), « designation »
// (libellés d'affaire fortement recouvrants) ou « partielle » (facturation partielle, paire unique).

const { fpKey, noAcc } = require("../lib/ids");

const WON_STAGE = 6;
const TEXT_MIN = 0.6; // recouvrement min. des mots significatifs pour valider une même désignation/affaire
// Proximité relative (défaut 1 %) : deux montants « du même ordre » sont considérés identiques malgré
// les arrondis. max(|a|,|b|,1) évite la division par ~0 et le faux positif 0≈0.
const near = (a, b, tol) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b), 1) * tol;
const sum = (rows, f) => rows.reduce((s, x) => s + (Number(f(x)) || 0), 0);

// Similarité de libellé : coefficient de recouvrement des mots significatifs (≥ 3 lettres, sans
// accents/ponctuation). Tolère les longueurs différentes (« RESEAU LAN » ⊂ « DEPLOIEMENT RESEAU LAN »).
const words = (s) => new Set(noAcc(String(s || "")).replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3));
function textSim(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

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
      // Libellés d'affaire pour la similarité texte (les factures n'en portent pas → seuls opp↔commande
      // se comparent par désignation). On concatène désignation d'opp et affaire/désignation de commande.
      const oppText = c.opps.map((x) => x.designation || "").join(" ");
      const orderText = c.orders.map((x) => x.affaire || x.designation || "").join(" ");
      return { ...c, oppAmount, orderCas, invoiceTotal, hasOrder, hasInvoice, won, oppText, orderText };
    });
    // FP d'AUTORITÉ = cluster portant une facture (prioritaire) ou une commande P&L.
    const authoritative = clusters.filter((c) => c.hasInvoice || c.hasOrder);

    const suggestions = [];
    let wonNoPnl = 0;

    // A. Opp gagnée sans commande P&L → jumeau d'autorité par MONTANT ou par DÉSIGNATION/AFFAIRE.
    for (const c of clusters) {
      if (!c.won || c.hasOrder) continue;
      wonNoPnl++;
      const cands = authoritative
        .filter((t) => t.fp !== c.fp)
        .map((t) => {
          const amt = t.hasInvoice ? t.invoiceTotal : t.orderCas;
          const amountMatch = near(c.oppAmount, amt, tolerancePct);
          const sim = textSim(c.oppText, t.orderText); // 0 si la cible n'a pas de libellé (facture seule)
          return { t, amountMatch, textMatch: sim >= TEXT_MIN, sim, prio: t.hasInvoice ? 0 : 1, amtDelta: Math.abs(c.oppAmount - amt) };
        })
        .filter((x) => x.amountMatch || x.textMatch);
      if (!cands.length) continue;
      // Priorité : montant concordant d'abord, puis désignation ; facture prioritaire ; départage fin.
      cands.sort((a, b) => (b.amountMatch - a.amountMatch) || (b.textMatch - a.textMatch) || (a.prio - b.prio)
        || (a.amountMatch ? a.amtDelta - b.amtDelta : b.sim - a.sim));
      const best = cands[0];
      suggestions.push({ from: c.fp, to: best.t.fp, reason: "opp_gagnee_sans_pnl",
        targetHasInvoice: best.t.hasInvoice, confidence: best.amountMatch ? "montant" : "designation" });
    }

    // B. Commande SANS facture + facture ORPHELINE sous un autre FP → le FP FACTURE fait foi.
    const orphanInvoices = clusters.filter((t) => t.hasInvoice && !t.hasOrder);
    const ordersNoInvoice = clusters.filter((t) => t.hasOrder && !t.hasInvoice);
    for (const c of ordersNoInvoice) {
      // B1. Concordance de MONTANT (facture soldée sous l'autre FP).
      const exact = orphanInvoices
        .filter((t) => near(c.orderCas, t.invoiceTotal, tolerancePct))
        .sort((a, b) => Math.abs(c.orderCas - a.invoiceTotal) - Math.abs(c.orderCas - b.invoiceTotal))[0];
      if (exact) {
        suggestions.push({ from: c.fp, to: exact.fp, reason: "facture_sous_autre_fp", targetHasInvoice: true, confidence: "montant" });
        continue;
      }
      // B2. Facturation PARTIELLE : paire UNIQUE (une seule commande sans facture ⟷ une seule facture
      //     orpheline) et la facture ne DÉPASSE pas le CAS (acompte plausible) → proposition à confiance
      //     « partielle ». On exige l'unicité pour éviter tout appariement ambigu.
      if (ordersNoInvoice.length === 1 && orphanInvoices.length === 1) {
        const inv = orphanInvoices[0];
        if (inv.invoiceTotal > 0 && inv.invoiceTotal <= c.orderCas * (1 + tolerancePct)) {
          suggestions.push({ from: c.fp, to: inv.fp, reason: "facture_sous_autre_fp", targetHasInvoice: true, confidence: "partielle" });
        }
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
