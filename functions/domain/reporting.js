// Reporting facturation / rentabilité / clients / domaines (BUILD_KIT §6, §7).
const { sum } = require("./chaine");
const { groupSum } = require("./backlog");
const { fpKey } = require("../lib/ids");
const { projectionWeight, normalizeTiers } = require("./projection");

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
// marginPct est un POURCENTAGE (0-100, cf. ficheAffaire) ; on le NORMALISE en ratio [0,1] avant emploi —
// sinon une commande à CAS=0 mais marginPct=20 donnait un taux de 20 (soit 2000 %, marge ×100). Audit P2-1.
const marginRate = (o) => {
  if (o && (o.cas || 0) > 0) return (o.mb || 0) / o.cas;
  const p = Number(o && o.marginPct) || 0;
  return p > 1 ? p / 100 : p; // > 1 ⇒ pourcentage → ratio ; sinon déjà un ratio (0-1 historique toléré)
};

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
    const line = byFp[k] || (byFp[k] = { fp: k, base: 0, rate: marginRate(o), cap: o.cas || 0, bu: o.bu || i.bu || "AUTRE", am: o.am || i.am || "", client: o.client || i.client || "" });
    line.base += i.amountHt || 0;
  }
  // Marge reconnue PLAFONNÉE au CAS de l'affaire : on ne reconnaît pas de marge sur la SURFACTURATION
  // (facturé > CAS). Sans plafond, taux×facturé dépasserait la marge P&L totale du deal (marge
  // fantôme). L'assiette `base` (facturé affiché) reste le facturé réel ; seule la marge est bornée.
  // Vaut pour les deux signes : |taux×min(base,cap)| ≤ |mb| = |taux×cap|. Pas de plafond si CAS=0
  // (affaire orpheline : taux déjà 0 via marginRate({})).
  return Object.values(byFp).map((l) => {
    const marginBase = l.cap > 0 ? Math.min(l.base, l.cap) : l.base;
    return { ...l, mb: l.rate * marginBase };
  });
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
  // COÛT ABSENT (audit P1-1) : une commande à CAS>0 dont le costTotal n'a JAMAIS été importé affiche une marge
  // (0 % ou 100 % selon le parser) INDISCERNABLE d'un vrai deal → le DF chasse de fausses affaires. On COMPTE
  // ces affaires et on MARQUE les lignes du bas de tableau (badge « marge non fiable » côté front). costTotal
  // == null (absent) ≠ costTotal 0 (marge légitimement pleine). Parité avec les flags missingCjm de resourcePnl.
  // MARGE ESTIMÉE (ADR-056) : une commande dont la marge a été DÉRIVÉE du MB prév. de l'opportunité (mbSource
  // "opp", faute de MB TOTAL P&L et de fiche). Ce n'est ni une vraie marge P&L, ni un « coût absent 0/100 » :
  // c'est une ESTIMATION pipeline → on la compte et on la marque à part (badge « estimé » côté front).
  const mbEstimatedFps = new Set((orders || []).filter((o) => o.mbSource === "opp").map((o) => fpKey(o.fp) || o.fp).filter(Boolean));
  const isMbEstimated = (fp) => mbEstimatedFps.has(fpKey(fp) || fp);
  // Coût absent : CAS>0 sans costTotal. On EXCLUT les marges estimées (mbSource "opp") — leur provenance est
  // connue (pipeline), elles portent déjà leur propre signal → pas de double flag « non fiable » + « estimée ».
  const costMissingFps = new Set((orders || []).filter((o) => (o.cas || 0) > 0 && o.costTotal == null && o.mbSource !== "opp").map((o) => fpKey(o.fp) || o.fp).filter(Boolean));
  const isCostMissing = (fp) => costMissingFps.has(fpKey(fp) || fp);
  // Marque aussi les lignes de la perspective Commande (celle que lit le front via `perspectives.commande`).
  // La perspective Facturé (factureLines, sans costTotal) laisse `costMissing` absent → jamais faux positif.
  commande.bottomAffaires = commande.bottomAffaires.map((o) => ({ ...o, costMissing: isCostMissing(o.fp), mbEstimated: isMbEstimated(o.fp) }));
  return {
    // Rétro-compat : perspective Commande à plat, assiette nommée `cas`.
    mb: commande.mb, cas: commande.base, pmb: commande.pmb,
    costMissingCount: costMissingFps.size, // nb d'affaires à marge non fiable (coût absent)
    mbEstimatedCount: mbEstimatedFps.size, // nb d'affaires à marge ESTIMÉE depuis le pipeline (MB de l'opp)
    byBu: commande.byBu.map((b) => ({ bu: b.bu, cas: b.base, mb: b.mb, pmb: b.pmb })),
    byAm: commande.byAm.map((a) => ({ am: a.am, cas: a.base, mb: a.mb, pmb: a.pmb })),
    bottomAffaires: commande.bottomAffaires.map((o) => ({ fp: o.fp, client: o.client, am: o.am, cas: o.base, mb: o.mb, pmb: o.pmb, costMissing: isCostMissing(o.fp), mbEstimated: isMbEstimated(o.fp) })),
    topClients: commande.topClients,
    // Perspectives génériques (assiette = `base`) pour le sélecteur Commande / Facturé.
    perspectives: { commande, facture },
  };
}

/** Indicateurs par entité (client ou BU) : CAS/Facturé/Backlog/Marge/%MB (§ modules 11-12).
 *  `opps` (optionnel) ajoute par entité le FORECAST = Σ pondéré des opps OUVERTES (étapes 1..5) et la
 *  valeur PROJETÉE = CAS + forecast (les opps GAGNÉES sont déjà repliées dans le CAS via mergeCommandes
 *  → « certitudes »). Alimente le Bilan CODIR (Top clients « Commandes & Certitudes & Forecast »). */
function byEntity(orders, invoices, keyFn, opps, tiers) {
  const t = tiers || normalizeTiers();
  // FP déjà au carnet : une opp active dont le FP porte déjà une commande est comptée dans `cas` ;
  // l'ajouter au forecast la double-compterait dans `projete = cas + forecast` (parité chaine.js).
  const booked = new Set((orders || []).map((o) => fpKey(o.fp)).filter(Boolean));
  const m = {};
  const get = (k) => (m[k] = m[k] || { key: k, cas: 0, facture: 0, backlog: 0, mb: 0, forecast: 0 });
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
  for (const o of opps || []) {
    const s = Number(o.stage) || 0;
    const k = o.fp ? fpKey(o.fp) : "";
    // Pondéré TIÉRÉ (projectionWeight), hors opps déjà au carnet → source unique avec le cockpit/atterrissage.
    if (s >= 1 && s <= 5 && !(k && booked.has(k))) get(keyFn(o) || "AUTRE").forecast += projectionWeight(o, t);
  }
  const all = Object.values(m)
    .map((a) => ({ ...a, pmb: a.cas > 0 ? a.mb / a.cas : 0, projete: a.cas + a.forecast }))
    .sort((x, y) => y.cas - x.cas);
  const CAP = 100;
  if (all.length <= CAP) return all;
  // Au-delà du plafond d'affichage : la longue traîne est AGRÉGÉE dans une ligne « Autres (N) » plutôt
  // que abandonnée silencieusement (cf. audit intégral A2 : sinon sommes front sous-évaluées + entités
  // disparues sans trace). `isOther` → le front la rend non cliquable (ce n'est pas une entité réelle).
  const rest = all.slice(CAP);
  const other = rest.reduce((s, a) => { s.cas += a.cas; s.facture += a.facture; s.backlog += a.backlog; s.mb += a.mb; s.forecast += a.forecast; return s; },
    { key: `Autres (${rest.length})`, cas: 0, facture: 0, backlog: 0, mb: 0, forecast: 0, isOther: true });
  other.pmb = other.cas > 0 ? other.mb / other.cas : 0;
  other.projete = other.cas + other.forecast;
  return [...all.slice(0, CAP), other];
}

module.exports = { facturation, rentabilite, byEntity, topN, marginRate };
