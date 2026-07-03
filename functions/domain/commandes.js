// Fusion des COMMANDES (source de vérité de « Commandes » + « Rentabilité » + realiseCas).
//
// RÈGLE MÉTIER (P&L STRICT) : la source de vérité des commandes est l'onglet P&L de l'Excel.
// Une commande n'EXISTE que si elle a une ligne P&L (orders/{fp}). L'onglet « opp live » est la
// source de vérité du SUIVI COMMERCIAL (pipeline → certitudes), pas des commandes : une opp
// GAGNÉE ne fait que RÉCONCILIER (corriger le CAS d')une ligne P&L existante, jamais en créer une
// absente du P&L. Idem pour une fiche affaire (elle enrichit marge/coût/vente d'une ligne P&L).
//   • Opp gagnée (stage 6) sur un FP présent au P&L → CAS = montant de l'opp ; marge P&L conservée.
//   • Fiche affaire sur un FP présent au P&L → CAS = vente, marge/coût/client/AM/affaire de la fiche.
//   • Opp gagnée / fiche SANS ligne P&L → IGNORÉE (pas de commande fantôme). Signalée dans le
//     cockpit Qualité (« à réconcilier au P&L ») pour ne pas être perdue.
// RAF : toute commande ayant une base P&L, on garde son « RAF total » CURATÉ de l'Excel quand il
// est renseigné (source de vérité métier ; le rattachement facture→N° FP est incomplet, donc
// CAS − facturé SURESTIMERAIT le backlog). Ligne P&L sans RAF → dérivé max(CAS − facturé, 0).
// Module PUR (testable).
const { fpKey, plausibleYear } = require("../lib/ids");

const yearOf = (d) => (d ? String(d).slice(0, 4) : "");
// Année extraite du N° FP, BORNÉE (fenêtre plausible) : un FP mal typé « FP/2099/1 » ne doit pas
// injecter une année aberrante qui polluerait currentFy / le sélecteur de périodes.
const yearOfFp = (fp) => { const m = String(fp || "").match(/\/(\d{4})\//); return m ? plausibleYear(m[1]) : 0; };

/**
 * @param {object[]} orders commandes P&L (orders/{fp}) — COLONNE VERTÉBRALE : seule source de création
 * @param {object[]} opps opportunités (opportunities/*)
 * @param {object[]} sheets fiches affaire (projectSheets/*)
 * @param {object[]} invoices factures (invoices/*) — pour déduire le RAF
 * @returns {object[]} commandes fusionnées (toutes adossées à une ligne P&L)
 */
function mergeCommandes(orders, opps, sheets, invoices) {
  // Toutes les clés (P&L, factures, opps, fiches) passent par fpKey : mêmes graphies (casse,
  // espaces, zéros de tête) → même clé canonique. Évite les FP dédoublés et les factures non
  // rattachées (RAF dérivé surévalué).
  const billed = {};
  for (const i of invoices || []) { const k = fpKey(i.fp); if (k) billed[k] = (billed[k] || 0) + (i.amountHt || 0); }

  const byFp = new Map();
  const merge = (fp, data) => { if (!fp) return; byFp.set(fp, { ...(byFp.get(fp) || { fp }), ...data }); };

  // 1. P&L = COLONNE VERTÉBRALE. Une commande n'existe QUE si elle a une ligne P&L.
  //    pnlSource = "manuel" : la marge/coût vient de l'import P&L Excel.
  for (const o of orders || []) { const k = fpKey(o.fp); if (k) merge(k, { ...o, fp: k, affaire: o.designation || "", pnlSource: "manuel" }); }
  const pnlFps = new Set(byFp.keys()); // FP présents au P&L = seuls candidats « commande »

  // 2. Opportunités GAGNÉES (stage 6) : RÉCONCILIENT une ligne P&L existante (corrigent le CAS),
  //    sans jamais en créer une absente du P&L. On CONSERVE la marge/coût P&L (inconnus de l'opp).
  //    Garde-fou : une opp gagnée sans montant exploitable n'écrase PAS un CAS P&L valide.
  for (const o of opps || []) {
    if ((o.stage || 0) !== 6) continue;
    const fp = fpKey(o.fp);
    if (!fp || !pnlFps.has(fp)) continue; // pas de ligne P&L → pas de commande (réconciliation à faire)
    const prev = byFp.get(fp);
    merge(fp, {
      client: o.client || prev.client, bu: o.bu || prev.bu, am: o.am || prev.am,
      affaire: o.designation || prev.affaire || "", // désignation de l'opp gagnée si le P&L n'en a pas
      cas: (o.amount || 0) > 0 ? o.amount : (prev.cas || 0),
      // L'année de PO (CAS FIGÉ) vient de la ligne P&L / du N° FP en PRIORITÉ ; la D Prev de l'opp
      // (prévisionnelle, souvent une autre année) ne sert que de dernier repli.
      yearPo: prev.yearPo || yearOfFp(fp) || Number(yearOf(o.closingDate)) || 0,
      source: "opp_won",
    });
  }

  // 3. Fiches affaire : ENRICHISSENT une ligne P&L existante (client, affaire, CAS = vente,
  //    marge, coût). pnlSource = "fiche" : la marge/coût vient de la fiche. Jamais de création hors P&L.
  //    Garde-fou : une fiche sans prix de vente exploitable (0) n'écrase pas la commande existante.
  for (const s of sheets || []) {
    const fp = fpKey(s.fp);
    if (!fp || !pnlFps.has(fp)) continue; // pas de ligne P&L → ignorée
    if (!((s.saleTotal || 0) > 0)) continue; // fiche sans vente exploitable → conserve l'existant
    const prev = byFp.get(fp);
    merge(fp, {
      client: s.client || prev.client, affaire: s.affaire || prev.affaire || "", am: s.commercial || prev.am,
      cas: s.saleTotal, mb: s.margin || 0, costTotal: s.costTotal, marginPct: s.marginPct,
      source: "fiche", pnlSource: "fiche",
    });
  }

  // RAF : toute commande a désormais une base P&L. On garde le « RAF total » CURATÉ de l'Excel dès
  // qu'il est renseigné (o.raf, issu de la ligne P&L) — MÊME si une opp gagnée / fiche a écrasé le
  // CAS. Ligne P&L sans RAF Excel → dérivé max(CAS − Σfactures du FP, 0).
  return [...byFp.values()].map((o) => {
    const curated = o.raf != null; // o.raf provient toujours de la ligne P&L (opp/fiche ne le posent pas)
    const raf = curated ? o.raf : Math.max((o.cas || 0) - (billed[o.fp] || 0), 0);
    // rafSource : « excel » = RAF curaté (fiable) ; « derive » = CAS − facturé (ligne P&L sans RAF).
    return { ...o, raf, rafSource: curated ? "excel" : "derive", facture: billed[o.fp] || 0 };
  });
}

module.exports = { mergeCommandes };
