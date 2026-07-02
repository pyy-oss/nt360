// Cockpit QUALITÉ DES DONNÉES — consolide les anomalies d'INGESTION (hygiène des données) pour
// fiabiliser les imports en continu : lignes en quarantaine implicite, champs manquants, ruptures
// de rattachement, incohérences. Distinct du « Centre d'alertes » (alertes MÉTIER actionnables).
// Module PUR (testable).
const SEV_RANK = { high: 0, medium: 1, low: 2 };

function dataQuality(orders, invoices, opps, bcLines, sheets) {
  orders = orders || []; invoices = invoices || []; opps = opps || [];
  bcLines = bcLines || []; sheets = sheets || [];

  const billed = {};
  for (const i of invoices) if (i.fp) billed[i.fp] = (billed[i.fp] || 0) + (i.amountHt || 0);

  const issues = [];
  const add = (type, severity, arr, label, refFn) => {
    if (arr.length) issues.push({ type, severity, count: arr.length, label, refs: arr.slice(0, 10).map(refFn).map((x) => String(x || "—")) });
  };

  // Factures
  add("factures_orphelines", "high", invoices.filter((i) => i.linked !== true), "Factures non rattachées à une commande (N° FP inconnu)", (i) => i.numero || i.fp);
  add("factures_sans_date", "medium", invoices.filter((i) => !i.date), "Factures sans date de facturation", (i) => i.numero);
  add("factures_sans_echeance", "low", invoices.filter((i) => !i.dueDate), "Factures sans date d'échéance (prévision cash imprécise)", (i) => i.numero);
  add("surfacturation", "high", orders.filter((o) => (o.cas || 0) > 0 && (billed[o.fp] || 0) > (o.cas || 0) * 1.005), "Commandes surfacturées (Σ factures > CAS)", (o) => o.fp);

  // Commandes
  add("commandes_sans_annee", "medium", orders.filter((o) => !(o.yearPo > 0)), "Commandes sans année de PO (atterrissage faussé)", (o) => o.fp);
  add("commandes_sans_client", "medium", orders.filter((o) => !o.client), "Commandes sans client", (o) => o.fp);
  add("commandes_sans_am", "low", orders.filter((o) => !o.am), "Commandes sans commercial (AM)", (o) => o.fp);

  // Opportunités
  const active = opps.filter((o) => o.stage >= 1 && o.stage <= 5);
  add("opps_sans_dprev", "medium", active.filter((o) => !o.closingDate), "Opportunités actives sans D Prev (non projetables)", (o) => o.client);
  add("opps_sans_montant", "low", active.filter((o) => !(o.amount > 0)), "Opportunités actives sans montant", (o) => o.client);
  // GAGNÉES sans N° FP : ne peuvent pas devenir commande (perte de CAS/backlog silencieuse).
  add("opps_gagnees_sans_fp", "high", opps.filter((o) => o.stage === 6 && !o.fp), "Opportunités GAGNÉES sans N° FP (non transformables en commande)", (o) => o.client);

  // Lignes BC
  add("bc_sans_fp", "low", bcLines.filter((b) => !b.fp), "Lignes BC sans N° FP (non rattachables)", (b) => b.bcNumber || b.supplier);
  add("bc_sans_fournisseur", "low", bcLines.filter((b) => !b.supplier), "Lignes BC sans fournisseur", (b) => b.bcNumber);

  // Fiches affaire
  add("fiches_sans_vente", "low", sheets.filter((s) => !(s.saleTotal > 0)), "Fiches affaire sans prix de vente", (s) => s.fp);

  issues.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || (b.count - a.count));

  // Score de complétude : 1 − (anomalies pondérées / total d'enregistrements), borné [0,1].
  const W = { high: 1, medium: 0.5, low: 0.2 };
  const total = orders.length + invoices.length + opps.length + bcLines.length;
  const weighted = issues.reduce((s, i) => s + i.count * (W[i.severity] || 0), 0);
  const score = total > 0 ? Math.max(0, Math.min(1, 1 - weighted / total)) : 1;

  return {
    issues, score,
    counts: { orders: orders.length, invoices: invoices.length, opportunities: opps.length, bcLines: bcLines.length, projectSheets: sheets.length },
  };
}

module.exports = { dataQuality };
