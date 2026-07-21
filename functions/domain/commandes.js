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
const { fpKey, plausibleYear, num } = require("../lib/ids");

// Lignes P&L au N° FP ILLISIBLE (fpKey null : séquence absente/factice, année à 5 chiffres, libellé non
// conforme) portant un CAS : mergeCommandes les ÉCARTE silencieusement du carnet → perte de CA invisible
// (ni au CAS, ni au backlog, ni en anomalie). On les EXPOSE pour qu'elles soient corrigées. PURE.
function illegibleOrders(orders) {
  return (orders || []).filter((o) => !fpKey(o && o.fp) && num(o && o.cas) > 0);
}

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
  // casPnl = CAS d'ORIGINE de la ligne P&L, CONSERVÉ même si une opp gagnée / fiche écrase ensuite `cas`
  // (étapes 2/3). Sert au contrôle de cohérence AMONT « écart de valorisation » (alerts/dataQuality) : sans
  // lui, la valeur P&L écrasée est perdue et l'écart opp↔P&L devient indétectable. Additif, ne change aucun calcul.
  // Année de PO : la colonne Excel fait foi quand elle est PLAUSIBLE ; sinon (vide, 1900, 20226…)
  // on la dérive du N° FP lui-même (FP/AAAA/N — millésime structurel de l'affaire). Sans ce repli,
  // la ligne remonte en « commande sans année » au Centre de correction alors que le FP porte l'année.
  for (const o of orders || []) {
    const k = fpKey(o.fp);
    if (k) merge(k, { ...o, fp: k, affaire: o.designation || "", casPnl: num(o.cas), pnlSource: "manuel", yearPo: plausibleYear(o.yearPo) || yearOfFp(k) });
  }
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
      affaire: o.designation || prev.affaire || "", // priorité opp gagnée > P&L (la fiche, appliquée ensuite, prime)
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

  // 4. REPLI MARGE (ADR-056) : une commande adossée au P&L SANS « MB TOTAL » et SANS fiche n'a aucune
  //    marge → le taux mb/CAS vaut 0 partout (Rentabilité, atterrissage N+1, backlog). On dérive alors la
  //    marge du MB PRÉVISIONNEL de l'opp du même FP (mbPrev, en %) : mb = mbPrev% × CAS. DERNIER rang
  //    d'autorité (fiche > MB TOTAL P&L > opp). Le levier est `mb` (montant) et non `marginPct` car, dès
  //    que CAS>0, tous les consommateurs calculent le taux via mb/CAS et IGNORENT marginPct. Flag
  //    `mbSource="opp"` = marge ESTIMÉE (jamais confondue avec une marge P&L réelle) ; coût laissé inconnu
  //    (costTotal non posé) → le flag « coût absent » subsiste. mbPrev est un %, jamais mélangé à un montant.
  const oppMbByFp = new Map(); // FP → mbPrev (%) : opp la plus avancée (stage) d'abord, puis mbPrev le + élevé (déterministe)
  for (const o of opps || []) {
    const fp = fpKey(o && o.fp);
    const p = Number(o && o.mbPrev);
    if (!fp || !Number.isFinite(p) || p <= 0) continue;
    const st = Number(o.stage) || 0;
    const cur = oppMbByFp.get(fp);
    if (!cur || st > cur.st || (st === cur.st && p > cur.p)) oppMbByFp.set(fp, { p, st });
  }
  for (const [fp, cmd] of byFp) {
    if (cmd.pnlSource === "fiche") continue; // la fiche fait autorité sur la marge
    // On n'estime QUE si le parseur P&L a EXPLICITEMENT confirmé l'absence de MB TOTAL (mbPresent === false).
    // Une ligne P&L pas encore ré-importée (mbPresent absent/undefined) est AMBIGUË (0 réel vs absent) → on ne
    // touche à rien : jamais d'estimation sur des données legacy, aucune marge P&L réelle (fût-elle 0) écrasée.
    if (cmd.mbPresent !== false) continue;
    const cas = Number(cmd.cas) || 0;
    if (cas <= 0) continue;                  // CAS 0 = hors périmètre rentabilité (taux via marginPct, non concerné)
    const est = oppMbByFp.get(fp);
    if (!est) continue;                      // aucune opp porteuse de MB pour ce FP → marge laissée vide
    merge(fp, { mb: Math.round((est.p / 100) * cas), mbSource: "opp" });
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

module.exports = { mergeCommandes, illegibleOrders };
