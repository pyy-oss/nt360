// Agrégation → documents summaries/* (BUILD_KIT §6, §10).
// Lit les collections sources, calcule via domain/*, écrit les agrégats (écriture
// interdite au client par les rules). Le front s'abonne en temps réel (onSnapshot).
const { FieldValue } = require("firebase-admin/firestore");
const { overview } = require("../domain/chaine");
const { backlogFy } = require("../domain/backlog");
const { pipeline } = require("../domain/pipeline");
const { suppliers } = require("../domain/fournisseurs");
const { facturation, rentabilite, byEntity } = require("../domain/reporting");
const { atterrissage } = require("../domain/atterrissage");
const { alerts } = require("../domain/alerts");
const { mergeCommandes } = require("../domain/commandes");
const { enrichBu, enrichLinks } = require("./enrich");

async function readAll(db, name, withId = false) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => (withId ? { id: d.id, ...d.data() } : d.data()));
}

const filterInvoices = (invoices, period) =>
  period === "all" ? invoices : invoices.filter((i) => i.date && String(i.date).slice(0, 4) === String(period));

/**
 * Recalcule tous les agrégats impactés et les écrit dans summaries/*.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string[]} [only] sous-ensemble d'agrégats (optionnel, sinon tout)
 */
async function recomputeAll(db, only) {
  const [pnlOrders, invoices, opps, bcLines, creditLines, objectives, projectSheets] = await Promise.all([
    readAll(db, "orders"),
    readAll(db, "invoices"),
    readAll(db, "opportunities"),
    readAll(db, "bcLines"),
    readAll(db, "creditLines", true),
    readAll(db, "objectives"),
    readAll(db, "projectSheets"),
  ]);

  // COMMANDES = source de vérité fusionnée (fiche affaire > opp gagnée > P&L). Sert de base à
  // « Commandes », « Rentabilité », realiseCas, byEntity, backlog, exposition fournisseurs.
  const orders = mergeCommandes(pnlOrders, opps, projectSheets, invoices);

  const fiscal = (await db.doc("config/fiscal").get()).data() || {};
  const currentFy = fiscal.currentFy || orders.reduce((mx, o) => Math.max(mx, o.yearPo || 0), 0);

  // Rafraîchit l'enrichissement (BU par jointure FP/client, rattachement facture↔commande)
  // sur les données lues, pour que les agrégats/alertes ne dépendent pas de drapeaux
  // pré-persistés potentiellement obsolètes (recompute sans réingestion).
  enrichBu({ orders, invoices, opportunities: opps });
  enrichLinks({ orders, invoices });

  const want = (k) => !only || only.includes(k);
  const stamp = { updatedAt: FieldValue.serverTimestamp() };
  const asOf = new Date().toISOString().slice(0, 10); // aujourd'hui : borne basse fenêtre D Prev (atterrissage)
  const yearOf = (d) => (d ? String(d).slice(0, 4) : "");
  const w = []; // écritures {path, data}

  const sup = suppliers(orders, bcLines, creditLines);
  const bf = backlogFy(orders, currentFy); // backlog GLISSANT global (RAF de toutes les commandes ouvertes)
  if (want("backlog")) w.push({ path: "summaries/backlog_fy", data: { ...bf, ...stamp } });
  if (want("pipeline")) w.push({ path: "summaries/pipeline", data: { ...pipeline(opps), ...stamp } }); // global (rétro-compat)
  if (want("suppliers")) w.push({ path: "summaries/suppliers", data: { ...sup, ...stamp } });
  if (want("atterrissage")) w.push({ path: `summaries/atterrissage_${currentFy}`, data: { ...atterrissage(orders, invoices, opps, objectives, currentFy, asOf), ...stamp } });
  if (want("alerts")) w.push({ path: "summaries/alerts", data: { items: alerts(orders, invoices, sup, bcLines, currentFy), fy: currentFy, ...stamp } });
  // Commandes fusionnées matérialisées (lues par l'onglet « Commandes »).
  if (want("commandes") || want("overview")) w.push({ path: "summaries/commandes", data: {
    count: orders.length,
    rows: orders.map((o) => ({
      fp: o.fp, client: o.client || "", bu: o.bu || "AUTRE", am: o.am || "", affaire: o.affaire || null,
      cas: o.cas || 0, raf: o.raf || 0, mb: o.mb || 0, costTotal: o.costTotal ?? null, marginPct: o.marginPct ?? null,
      yearPo: o.yearPo || 0, source: o.source || null,
    })),
    ...stamp,
  } });

  const filterOrders = (arr, p) => (p === "all" ? arr : arr.filter((o) => String(o.yearPo) === p));

  // Périodes disponibles = "Tout" + chaque année de commande (yearPo), la plus récente d'abord.
  const years = [...new Set(orders.map((o) => o.yearPo).filter((y) => y > 0))].sort((a, b) => b - a).map(String);
  const periods = ["all", ...years];
  for (const period of periods) {
    const inv = filterInvoices(invoices, period); // factures DATÉES dans la période = CAF figé sur l'exercice
    const ord = filterOrders(orders, period); // commandes signées dans la période (yearPo)
    // Opportunités de la période = D Prev (closingDate) dans l'année sélectionnée. Les certitudes
    // GLISSENT sur l'exercice : une D Prev déjà passée DANS l'année compte toujours (cohérent avec
    // l'atterrissage). On écarte l'obsolète HORS année (N-1) et le prévu en N+1+. "Tout" = tout.
    const oppP = period === "all" ? opps : opps.filter((o) => yearOf(o.closingDate) === period);
    // Chaîne NON additive : CAS(période, figé) · Facturé=CAF(inv datées, figé) · Backlog GLISSANT
    // (bf global, indépendant de la période) · Certitudes = pondéré des opps de la période (D Prev).
    if (want("overview")) w.push({ path: `summaries/overview_${period}`, data: { period, ...overview(ord, inv, oppP, { backlog: bf.total, backlogCount: bf.count }), ...stamp } });
    if (want("pipeline")) w.push({ path: `summaries/pipeline_${period}`, data: { period, ...pipeline(oppP), ...stamp } });
    if (want("facturation")) w.push({ path: `summaries/facturation_${period}`, data: { period, ...facturation(inv), ...stamp } });
    if (want("rentabilite")) w.push({ path: `summaries/rentabilite_${period}`, data: { period, ...rentabilite(ord), ...stamp } });
    if (want("clients")) w.push({ path: `summaries/clients_${period}`, data: { period, rows: byEntity(ord, inv, (x) => x.client), ...stamp } });
    if (want("domaines")) w.push({ path: `summaries/domaines_${period}`, data: { period, rows: byEntity(ord, inv, (x) => x.bu), ...stamp } });
  }

  // Enregistre la liste des périodes disponibles (pour le sélecteur front).
  w.push({ path: "config/periods", data: { available: periods, currentFy } });

  let batch = db.batch(), n = 0;
  for (const it of w) {
    batch.set(db.doc(it.path), it.data, { merge: true });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  return { written: w.map((x) => x.path), currentFy, periods };
}

module.exports = { recomputeAll, filterInvoices };
