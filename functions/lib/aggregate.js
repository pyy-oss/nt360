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
  const [orders, invoices, opps, bcLines, creditLines, objectives] = await Promise.all([
    readAll(db, "orders"),
    readAll(db, "invoices"),
    readAll(db, "opportunities"),
    readAll(db, "bcLines"),
    readAll(db, "creditLines", true),
    readAll(db, "objectives"),
  ]);
  const fiscal = (await db.doc("config/fiscal").get()).data() || {};
  const currentFy = fiscal.currentFy || orders.reduce((mx, o) => Math.max(mx, o.yearPo || 0), 0);

  const want = (k) => !only || only.includes(k);
  const stamp = { updatedAt: FieldValue.serverTimestamp() };
  const w = []; // écritures {path, data}

  const sup = suppliers(orders, bcLines, creditLines);
  if (want("backlog")) w.push({ path: "summaries/backlog_fy", data: { ...backlogFy(orders, currentFy), ...stamp } });
  if (want("pipeline")) w.push({ path: "summaries/pipeline", data: { ...pipeline(opps), ...stamp } });
  if (want("suppliers")) w.push({ path: "summaries/suppliers", data: { ...sup, ...stamp } });
  if (want("atterrissage")) w.push({ path: `summaries/atterrissage_${currentFy}`, data: { ...atterrissage(orders, invoices, opps, objectives, currentFy), ...stamp } });
  if (want("alerts")) w.push({ path: "summaries/alerts", data: { items: alerts(orders, invoices, sup, bcLines, currentFy), fy: currentFy, ...stamp } });

  const filterOrders = (arr, p) => (p === "all" ? arr : arr.filter((o) => String(o.yearPo) === p));

  // Périodes disponibles = "Tout" + chaque année de commande (yearPo), la plus récente d'abord.
  const years = [...new Set(orders.map((o) => o.yearPo).filter((y) => y > 0))].sort((a, b) => b - a).map(String);
  const periods = ["all", ...years];
  for (const period of periods) {
    const inv = filterInvoices(invoices, period);
    const ord = filterOrders(orders, period); // commandes signées dans la période (yearPo)
    // Pipeline pondéré (IdC≥90%) = FUTUR : global, non découpé par année → Certitudes cohérentes
    // avec le KPI "Pondéré (IdC≥90%)" du module Pipeline.
    if (want("overview")) w.push({ path: `summaries/overview_${period}`, data: { period, ...overview(ord, inv, opps), ...stamp } });
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
