// Cockpit QUALITÉ DES DONNÉES — consolide les anomalies d'INGESTION (hygiène des données) pour
// fiabiliser les imports en continu : lignes en quarantaine implicite, champs manquants, ruptures
// de rattachement, incohérences. Distinct du « Centre d'alertes » (alertes MÉTIER actionnables).
// Module PUR (testable).
const { fpKey } = require("../lib/ids");
const { ALERT_DEFAULTS } = require("./thresholds");

const SEV_RANK = { high: 0, medium: 1, low: 2 };

function dataQuality(orders, invoices, opps, bcLines, sheets, thr) {
  orders = orders || []; invoices = invoices || []; opps = opps || [];
  bcLines = bcLines || []; sheets = sheets || [];
  const surfacPct = (thr && thr.surfacturationPct) || ALERT_DEFAULTS.surfacturationPct; // seuil de surfacturation (même défaut que les alertes)

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
  add("surfacturation", "high", orders.filter((o) => (o.cas || 0) > 0 && (billed[o.fp] || 0) > (o.cas || 0) * (1 + surfacPct)), "Commandes surfacturées (Σ factures > CAS)", (o) => o.fp);

  // Commandes
  add("commandes_sans_annee", "medium", orders.filter((o) => !(o.yearPo > 0)), "Commandes sans année de PO (atterrissage faussé)", (o) => o.fp);
  add("commandes_sans_client", "medium", orders.filter((o) => !o.client), "Commandes sans client", (o) => o.fp);
  add("commandes_sans_am", "low", orders.filter((o) => !o.am), "Commandes sans commercial (AM)", (o) => o.fp);
  // AM purement numérique = colonne mal mappée à l'import (ex. « 35 ») → attribution commerciale faussée.
  const numAm = (x) => { const a = String(x.am || "").trim(); return a !== "" && /^[\d.,\s]+$/.test(a); };
  add("am_invalide", "medium", orders.filter(numAm), "Commandes dont l'AM est un nombre (colonne mal mappée — ré-importer)", (o) => o.fp);

  // Opportunités
  const active = opps.filter((o) => o.stage >= 1 && o.stage <= 5);
  add("opps_sans_dprev", "medium", active.filter((o) => !o.closingDate), "Opportunités actives sans D Prev (non projetables)", (o) => o.client);
  add("opps_sans_montant", "low", active.filter((o) => !(o.amount > 0)), "Opportunités actives sans montant", (o) => o.client);
  // GAGNÉES sans N° FP : ne peuvent pas devenir commande (perte de CAS/backlog silencieuse).
  add("opps_gagnees_sans_fp", "high", opps.filter((o) => o.stage === 6 && !o.fp), "Opportunités GAGNÉES sans N° FP (non transformables en commande)", (o) => o.client);
  // GAGNÉES avec N° FP mais SANS ligne P&L : règle P&L strict → non comptées en commande. Ce sont
  // des réconciliations opp↔P&L à faire (saisir la ligne au P&L de l'Excel), sinon CAS/backlog absents.
  const orderFps = new Set(orders.map((o) => fpKey(o.fp)).filter(Boolean));
  add("opps_gagnees_sans_pnl", "high", opps.filter((o) => o.stage === 6 && o.fp && !orderFps.has(fpKey(o.fp))), "Opportunités GAGNÉES sans ligne P&L (à réconcilier au P&L — non comptées en commande)", (o) => o.fp || o.client);

  // Lignes BC
  add("bc_sans_fp", "low", bcLines.filter((b) => !b.fp), "Lignes BC sans N° FP (non rattachables)", (b) => b.bcNumber || b.supplier);
  add("bc_sans_fournisseur", "low", bcLines.filter((b) => !b.supplier), "Lignes BC sans fournisseur", (b) => b.bcNumber);
  // BC RÉEL (avec N° BC) à montant XOF nul : souvent une devise étrangère non convertie → exposition
  // fournisseur & décaissements sous-estimés. À fiabiliser (saisir la contre-valeur XOF).
  add("bc_montant_zero", "medium", bcLines.filter((b) => b.bcNumber && !((b.amountXof || 0) > 0)), "BC émis à montant XOF nul (devise étrangère à convertir ?)", (b) => b.bcNumber);

  // Fiches affaire
  add("fiches_sans_vente", "low", sheets.filter((s) => !(s.saleTotal > 0)), "Fiches affaire sans prix de vente", (s) => s.fp);

  // DOUBLONS PROBABLES (import en DELTA) : quand une clé métier change à la source ou que l'ordre des
  // lignes bouge, le ré-import crée un nouveau document et LAISSE l'ancien → doublon. On ne SUPPRIME
  // rien (mode delta) : on SIGNALE les groupes de même signature métier pour arbitrage manuel.
  const dupGroups = (arr, keyFn) => {
    const g = {};
    for (const x of arr) { const k = keyFn(x); if (!k || /^\|+$/.test(k)) continue; (g[k] = g[k] || []).push(x); }
    return Object.values(g).filter((grp) => grp.length > 1);
  };
  const oppDups = dupGroups(opps, (o) => [o.client, o.amount, o.stage, o.am, o.fp, o.closingDate].map((v) => String(v ?? "")).join("|")).map((grp) => grp[0]);
  add("opps_doublons", "medium", oppDups, "Opportunités en doublon probable (même client/montant/étape/AM/FP/D Prev — ré-import en delta)", (o) => o.fp || o.client);
  const bcDups = dupGroups(bcLines, (b) => [b.fp, b.supplier, b.amountXof, b.expenseType, b.bcNumber].map((v) => String(v ?? "")).join("|")).map((grp) => grp[0]);
  add("bc_doublons", "low", bcDups, "Lignes BC en doublon probable (même FP/fournisseur/montant/type)", (b) => b.bcNumber || b.supplier || b.fp);

  issues.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || (b.count - a.count));

  // Indice de complétude : total / (total + anomalies pondérées), borné (0,1]. Le total inclut TOUTES
  // les collections auditées (dont les fiches). Cette forme SMOOTH évite la saturation à 0 : un même
  // enregistrement peut déclencher plusieurs anomalies (commande sans année + sans client + AM invalide…),
  // ce qui faisait plonger « 1 − pondéré/total » à 0 dès quelques % de données imparfaites. Ici le score
  // décroît continûment sans jamais s'effondrer, tout en restant ≈ identique sur des données propres.
  const W = { high: 1, medium: 0.5, low: 0.2 };
  const total = orders.length + invoices.length + opps.length + bcLines.length + sheets.length;
  const weighted = issues.reduce((s, i) => s + i.count * (W[i.severity] || 0), 0);
  const score = total > 0 ? total / (total + weighted) : 1;

  return {
    issues, score,
    counts: { orders: orders.length, invoices: invoices.length, opportunities: opps.length, bcLines: bcLines.length, projectSheets: sheets.length },
  };
}

module.exports = { dataQuality };
