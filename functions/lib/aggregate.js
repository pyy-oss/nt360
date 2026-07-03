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
const { receivables } = require("../domain/receivables");
const { cashflow, decaissements } = require("../domain/cashflow");
const { am360 } = require("../domain/am360");
const { dataQuality } = require("../domain/dataQuality");
const { mergeCommandes } = require("../domain/commandes");
const { enrichBu, enrichLinks } = require("./enrich");
const { fpKey } = require("./ids");

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
  const [pnlOrders, invoices, oppsRaw, bcLines, creditLines, objectives, projectSheets] = await Promise.all([
    readAll(db, "orders"),
    readAll(db, "invoices"),
    readAll(db, "opportunities"),
    readAll(db, "bcLines"),
    readAll(db, "creditLines", true),
    readAll(db, "objectives"),
    readAll(db, "projectSheets"),
  ]);

  // Dédup inter-source : une affaire SAISIE manuellement (source 'saisie') puis ré-importée en LIVE
  // (source 'salesData', avec FP) existerait en double → double compte du pipeline. Quand un FP est
  // couvert par une opp 'salesData', on écarte la/les opps 'saisie' de MÊME FP (la version importée fait foi).
  const salesFps = new Set(oppsRaw.filter((o) => o.source === "salesData" && fpKey(o.fp)).map((o) => fpKey(o.fp)));
  const opps = oppsRaw.filter((o) => !(o.source === "saisie" && fpKey(o.fp) && salesFps.has(fpKey(o.fp))));

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
  if (want("pipeline")) w.push({ path: "summaries/pipeline", data: { ...pipeline(opps, asOf), ...stamp } }); // global (rétro-compat)
  if (want("suppliers")) w.push({ path: "summaries/suppliers", data: { ...sup, ...stamp } });
  // Créances clients (Cash / DSO) : instantané global (l'AR est un état à date, non périodé).
  const rec = receivables(invoices, asOf);
  if (want("facturation") || want("receivables")) w.push({ path: "summaries/receivables", data: { ...rec, ...stamp } });
  // Prévision de trésorerie NETTE : encaissements attendus (AR + backlog indicatif) − décaissements
  // fournisseurs (BC non soldés). Position nette mensuelle + cumul.
  if (want("facturation") || want("cashflow")) {
    const cf = cashflow(invoices, orders, asOf);
    const dec = decaissements(bcLines, asOf);
    const decBy = Object.fromEntries(dec.months.map((m) => [m.month, m.out]));
    let cumNet = 0;
    const monthsNet = cf.months.map((m) => {
      const decais = decBy[m.month] || 0;
      const net = m.ar - decais;
      cumNet += net;
      return { ...m, decaissement: decais, net, cumulNet: cumNet };
    });
    w.push({ path: "summaries/cashflow", data: {
      ...cf, months: monthsNet,
      totalDecaissement: dec.total, decaissementBeyond: dec.beyond, bcOpenCount: dec.openCount,
      ...stamp,
    } });
  }
  const att = atterrissage(orders, invoices, opps, objectives, currentFy, asOf);
  if (want("atterrissage")) w.push({ path: `summaries/atterrissage_${currentFy}`, data: { ...att, ...stamp } });
  // AM 360° : pilotage par commercial (CAS/CAF/backlog/pipeline/conversion/R-O), sans marge.
  if (want("pipeline") || want("ams")) w.push({ path: "summaries/ams", data: { ...am360(orders, invoices, opps, objectives, currentFy), ...stamp } });
  if (want("alerts")) w.push({ path: "summaries/alerts", data: { items: alerts(orders, invoices, sup, bcLines, currentFy, asOf), fy: currentFy, ...stamp } });
  // Cockpit qualité des données : hygiène d'ingestion (champs manquants, rattachements, incohérences).
  if (want("alerts") || want("dataQuality")) w.push({ path: "summaries/dataQuality", data: { ...dataQuality(orders, invoices, opps, bcLines, projectSheets), ...stamp } });
  // Commandes fusionnées matérialisées (lues par l'onglet « Commandes »).
  if (want("commandes") || want("overview")) w.push({ path: "summaries/commandes", data: {
    count: orders.length,
    rows: orders.map((o) => ({
      fp: o.fp, client: o.client || "", bu: o.bu || "AUTRE", am: o.am || "", affaire: o.affaire || null,
      cas: o.cas || 0, raf: o.raf || 0, mb: o.mb || 0, costTotal: o.costTotal ?? null, marginPct: o.marginPct ?? null,
      yearPo: o.yearPo || 0, source: o.source || null, pnlSource: o.pnlSource || null,
    })),
    ...stamp,
  } });

  // Historisation : un INSTANTANÉ daté des grandeurs clés à chaque recompute (1 point/jour,
  // ré-écrit si déjà présent). Fonde les tendances / burn-down du backlog / forecast-vs-réel.
  if (want("overview") || want("trends")) {
    const point = {
      date: asOf,
      casReel: att.realiseCas || 0, caf: att.factureN || 0, backlog: bf.total || 0,
      pipeline: att.pipelinePondere || 0, projeteCas: att.projete || 0, projeteCaf: att.cafProjete || 0,
      ar: rec.totalAR || 0, dso: rec.dso || 0, fy: currentFy,
    };
    const prev = (await db.doc("summaries/trends").get()).data();
    const points = (prev?.points || []).filter((p) => p.date !== asOf);
    points.push(point);
    points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    w.push({ path: "summaries/trends", data: { points: points.slice(-180), ...stamp } }); // ~6 mois d'historique
  }

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
    if (want("pipeline")) w.push({ path: `summaries/pipeline_${period}`, data: { period, ...pipeline(oppP, asOf), ...stamp } });
    if (want("facturation")) w.push({ path: `summaries/facturation_${period}`, data: { period, ...facturation(inv), ...stamp } });
    if (want("rentabilite")) w.push({ path: `summaries/rentabilite_${period}`, data: { period, ...rentabilite(ord), ...stamp } });
    if (want("clients")) w.push({ path: `summaries/clients_${period}`, data: { period, rows: byEntity(ord, inv, (x) => x.client), ...stamp } });
    if (want("domaines")) w.push({ path: `summaries/domaines_${period}`, data: { period, rows: byEntity(ord, inv, (x) => x.bu), ...stamp } });
  }

  // Enregistre la liste des périodes disponibles (pour le sélecteur front).
  w.push({ path: "config/periods", data: { available: periods, currentFy } });

  // Garde-fou limite Firestore (~1 Mio/doc) : summaries/commandes embarque TOUTES les lignes de
  // commande dans un seul document — au-delà d'un certain volume il dépasse la limite et le
  // batch.commit() échoue avec une erreur opaque (« internal »). On détecte le doc fautif AVANT
  // l'écriture et on lève un message explicite (path + taille) plutôt qu'une erreur illisible.
  const DOC_LIMIT = 1_000_000; // marge sous la limite dure de 1 048 576 octets
  for (const it of w) {
    const bytes = Buffer.byteLength(JSON.stringify(it.data ?? {}), "utf8");
    if (bytes > DOC_LIMIT) {
      throw new Error(`summary trop volumineux: ${it.path} ≈ ${bytes} octets (> limite Firestore ~1 Mio) — trop de lignes pour un seul document`);
    }
  }

  let batch = db.batch(), n = 0;
  for (const it of w) {
    batch.set(db.doc(it.path), it.data, { merge: true });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  return { written: w.map((x) => x.path), currentFy, periods };
}

module.exports = { recomputeAll, filterInvoices };
