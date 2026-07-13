// Cockpit QUALITÉ DES DONNÉES — consolide les anomalies d'INGESTION (hygiène des données) pour
// fiabiliser les imports en continu : lignes en quarantaine implicite, champs manquants, ruptures
// de rattachement, incohérences. Distinct du « Centre d'alertes » (alertes MÉTIER actionnables).
// Module PUR (testable).
const { fpKey } = require("../lib/ids");
const { ALERT_DEFAULTS } = require("./thresholds");

const SEV_RANK = { high: 0, medium: 1, low: 2 };

// Définitions des anomalies (prédicat + libellé + réf) — SOURCE UNIQUE partagée par dataQuality()
// (comptes + échantillon) et par le Centre de correction (records complets à corriger). Ordre libre :
// dataQuality re-trie par sévérité puis compte. Chaque def : { type, severity, label, records, ref }.
function issueDefs(orders, invoices, opps, bcLines, sheets, thr, staleOpps, agedOpps) {
  orders = orders || []; invoices = invoices || []; opps = opps || [];
  bcLines = bcLines || []; sheets = sheets || []; staleOpps = staleOpps || []; agedOpps = agedOpps || [];
  // Number.isFinite → un seuil configuré à 0 (valide) n'est PAS écrasé par le défaut (le `||` le ferait,
  // en contradiction avec alerts.js). Cf. audit P2.
  const surfacPct = (thr && Number.isFinite(thr.surfacturationPct)) ? thr.surfacturationPct : ALERT_DEFAULTS.surfacturationPct;

  // Σ facturé par FP CANONIQUE (fpKey) — sinon un même FP formaté différemment côté facture/commande
  // fausse la surfacturation (sous-comptage). Clé cohérente avec orderFps ci-dessous.
  const billed = {};
  for (const i of invoices) { const k = fpKey(i.fp); if (k) billed[k] = (billed[k] || 0) + (i.amountHt || 0); }

  const numAm = (x) => { const a = String(x.am || "").trim(); return a !== "" && /^[\d.,\s]+$/.test(a); };
  const active = opps.filter((o) => o.stage >= 1 && o.stage <= 5);
  const orderFps = new Set(orders.map((o) => fpKey(o.fp)).filter(Boolean));
  // DOUBLONS PROBABLES (import en DELTA) : quand une clé métier change à la source ou que l'ordre des
  // lignes bouge, le ré-import crée un nouveau document et LAISSE l'ancien → doublon. On SIGNALE les
  // groupes de même signature métier pour arbitrage manuel (on ne supprime rien en mode delta).
  const dupGroups = (arr, keyFn) => {
    const g = {};
    for (const x of arr) { const k = keyFn(x); if (!k || /^\|+$/.test(k)) continue; (g[k] = g[k] || []).push(x); }
    return Object.values(g).filter((grp) => grp.length > 1);
  };
  // Clé de doublon sur FP CANONIQUE (fpKey) : un même FP zero-paddé/espacé différemment au ré-import
  // ne doit pas échapper à la détection (sinon faux négatifs — deux docs jugés distincts).
  const oppDups = dupGroups(opps, (o) => [o.client, o.amount, o.stage, o.am, fpKey(o.fp), o.closingDate].map((v) => String(v ?? "")).join("|")).map((grp) => grp[0]);
  const bcDups = dupGroups(bcLines, (b) => [fpKey(b.fp), b.supplier, b.amountXof, b.expenseType, b.bcNumber].map((v) => String(v ?? "")).join("|")).map((grp) => grp[0]);

  const def = (type, severity, records, label, ref) => ({ type, severity, records, label, ref });
  return [
    // Factures
    // « N° FP inconnu » = le FP CANONIQUE (fpKey) de la facture n'est PAS parmi les FP de commande.
    // On teste l'appartenance FRAÎCHE à orderFps (et non le drapeau `linked`, qui pouvait rester périmé à
    // false quand le FP était formaté différemment côté facture/commande → fausses « non rattachées »).
    def("factures_orphelines", "high", invoices.filter((i) => { const k = fpKey(i.fp); return !k || !orderFps.has(k); }), "Factures non rattachées à une commande (N° FP inconnu)", (i) => i.numero || i.fp),
    def("factures_sans_date", "medium", invoices.filter((i) => !i.date), "Factures sans date de facturation", (i) => i.numero),
    def("factures_sans_echeance", "low", invoices.filter((i) => !i.dueDate), "Factures sans date d'échéance (prévision cash imprécise)", (i) => i.numero),
    def("surfacturation", "high", orders.filter((o) => (o.cas || 0) > 0 && (billed[fpKey(o.fp)] || 0) > (o.cas || 0) * (1 + surfacPct)), "Commandes surfacturées (Σ factures > CAS)", (o) => o.fp),
    // Commandes
    def("commandes_sans_annee", "medium", orders.filter((o) => !(o.yearPo > 0)), "Commandes sans année de PO (atterrissage faussé)", (o) => o.fp),
    def("commandes_sans_client", "medium", orders.filter((o) => !o.client), "Commandes sans client", (o) => o.fp),
    def("commandes_sans_am", "low", orders.filter((o) => !o.am), "Commandes sans commercial (AM)", (o) => o.fp),
    // AM purement numérique = colonne mal mappée à l'import (ex. « 35 ») → attribution commerciale faussée.
    def("am_invalide", "medium", orders.filter(numAm), "Commandes dont l'AM est un nombre (colonne mal mappée — ré-importer)", (o) => o.fp),
    // Opportunités
    def("opps_sans_dprev", "medium", active.filter((o) => !o.closingDate), "Opportunités actives sans D Prev (non projetables)", (o) => o.client),
    def("opps_sans_montant", "low", active.filter((o) => !(o.amount > 0)), "Opportunités actives sans montant", (o) => o.client),
    // GAGNÉES sans N° FP : ne peuvent pas devenir commande (perte de CAS/backlog silencieuse).
    def("opps_gagnees_sans_fp", "high", opps.filter((o) => o.stage === 6 && !o.fp), "Opportunités GAGNÉES sans N° FP (non transformables en commande)", (o) => o.client),
    // GAGNÉES avec N° FP mais SANS ligne P&L : règle P&L strict → non comptées en commande. Réconciliation
    // opp↔P&L à faire (Dossier client / inscrire la ligne au P&L), sinon CAS/backlog absents.
    def("opps_gagnees_sans_pnl", "high", opps.filter((o) => o.stage === 6 && o.fp && !orderFps.has(fpKey(o.fp))), "Opportunités GAGNÉES sans ligne P&L (à réconcilier au P&L — non comptées en commande)", (o) => o.fp || o.client),
    // Opportunités FANTÔMES : retirées de la feuille LIVE sans clôture (7/9), EXCLUES du pipeline.
    def("opps_fantomes", "low", staleOpps, "Opportunités retirées de LIVE sans clôture (exclues du pipeline — à clôturer 7/9 ou ré-importer)", (o) => o.fp || o.client),
    // Auto-perte par âge (règle source LIVE : > 1 an ET IdC ≤ 90 %) : exclues du pipeline pondéré.
    def("opps_agees", "medium", agedOpps, "Opportunités périmées (> 1 an, confiance ≤ 90 %) — considérées PERDUES par la règle source, exclues du pipeline", (o) => o.fp || o.client),
    // Lignes BC
    def("bc_sans_fp", "low", bcLines.filter((b) => !b.fp), "Lignes BC sans N° FP (non rattachables)", (b) => b.bcNumber || b.supplier),
    def("bc_sans_fournisseur", "low", bcLines.filter((b) => !b.supplier), "Lignes BC sans fournisseur", (b) => b.bcNumber),
    // BC RÉEL (avec N° BC) à montant XOF nul : souvent une devise étrangère non convertie.
    def("bc_montant_zero", "medium", bcLines.filter((b) => b.bcNumber && !((b.amountXof || 0) > 0)), "BC émis à montant XOF nul (devise étrangère à convertir ?)", (b) => b.bcNumber),
    // Fiches affaire
    def("fiches_sans_vente", "low", sheets.filter((s) => !(s.saleTotal > 0)), "Fiches affaire sans prix de vente", (s) => s.fp),
    // Doublons
    def("opps_doublons", "medium", oppDups, "Opportunités en doublon probable (même client/montant/étape/AM/FP/D Prev — ré-import en delta)", (o) => o.fp || o.client),
    def("bc_doublons", "low", bcDups, "Lignes BC en doublon probable (même FP/fournisseur/montant/type)", (b) => b.bcNumber || b.supplier || b.fp),
  ];
}

function dataQuality(orders, invoices, opps, bcLines, sheets, thr, staleOpps, agedOpps) {
  orders = orders || []; invoices = invoices || []; opps = opps || [];
  bcLines = bcLines || []; sheets = sheets || [];

  const issues = [];
  for (const d of issueDefs(orders, invoices, opps, bcLines, sheets, thr, staleOpps, agedOpps)) {
    if (d.records.length) issues.push({ type: d.type, severity: d.severity, count: d.records.length, label: d.label, refs: d.records.slice(0, 10).map(d.ref).map((x) => String(x || "—")) });
  }
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

module.exports = { dataQuality, issueDefs };
