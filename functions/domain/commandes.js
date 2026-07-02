// Fusion des COMMANDES (source de vérité de « Commandes » + « Rentabilité » + realiseCas).
// Précédence par clé FP : Fiche affaire  >  Opportunité GAGNÉE  >  P&L.
//   • Sans fiche ni opp gagnée : on garde la commande P&L existante.
//   • Opp gagnée (stage 6) → commande : CAS = montant de l'opp, marge inconnue (0).
//   • Fiche affaire → écrase TOUT : CAS = prix de vente Neurones, marge/coût, client, AM, affaire.
// RAF : DÉRIVÉ pour toutes les sources = max(CAS − facturé, 0), où facturé = Σ factures du FP
// (tous exercices). Le CAS peut dater d'une année antérieure et la facturation s'étaler sur
// plusieurs exercices : le RAF reste juste (glissant). On n'utilise plus le RAF figé de l'Excel.
// Module PUR (testable).
const { fpKey } = require("../lib/ids");

const yearOf = (d) => (d ? String(d).slice(0, 4) : "");
const yearOfFp = (fp) => { const m = String(fp || "").match(/\/(\d{4})\//); return m ? Number(m[1]) : 0; };

/**
 * @param {object[]} orders commandes P&L (orders/{fp})
 * @param {object[]} opps opportunités (opportunities/*)
 * @param {object[]} sheets fiches affaire (projectSheets/*)
 * @param {object[]} invoices factures (invoices/*) — pour déduire le RAF
 * @returns {object[]} commandes fusionnées
 */
function mergeCommandes(orders, opps, sheets, invoices) {
  const billed = {};
  for (const i of invoices || []) if (i.fp) billed[i.fp] = (billed[i.fp] || 0) + (i.amountHt || 0);

  const byFp = new Map();
  const merge = (fp, data) => { if (!fp) return; byFp.set(fp, { ...(byFp.get(fp) || { fp }), ...data }); };

  // 1. P&L (base la plus faible). pnlSource = "manuel" : la marge/coût vient de l'import P&L Excel.
  for (const o of orders || []) if (o.fp) merge(o.fp, { ...o, pnlSource: "manuel" });

  // 2. Opportunités GAGNÉES (stage 6) → commandes ; écrasent le CAS du P&L.
  //    On CONSERVE la marge P&L existante (elle n'est pas connue de l'opp) et sa provenance.
  //    Garde-fou : une opp gagnée sans montant exploitable n'écrase PAS un CAS P&L valide et
  //    ne crée pas de commande fantôme à 0 (sinon perte silencieuse du CA).
  for (const o of opps || []) {
    if ((o.stage || 0) !== 6) continue;
    const fp = fpKey(o.fp);
    if (!fp) continue;
    const prev = byFp.get(fp) || {};
    if (!((o.amount || 0) > 0) && !((prev.cas || 0) > 0)) continue; // ni montant opp, ni CAS P&L → rien
    merge(fp, {
      fp, client: o.client, bu: o.bu || prev.bu, am: o.am,
      cas: (o.amount || 0) > 0 ? o.amount : (prev.cas || 0),
      mb: prev.mb || 0, costTotal: prev.costTotal ?? null, marginPct: prev.marginPct ?? null,
      yearPo: Number(yearOf(o.closingDate)) || yearOfFp(fp) || prev.yearPo || 0,
      suppliers: prev.suppliers || [], source: "opp_won",
      pnlSource: prev.pnlSource || null, // origine de la marge si un P&L existait
    });
  }

  // 3. Fiches affaire → écrasent TOUT (client, AM, affaire, CAS = vente, marge, coût).
  //    pnlSource = "fiche" : la marge/coût vient de la fiche affaire.
  //    Garde-fou : une fiche sans prix de vente exploitable (champ non parsé → 0) n'écrase PAS
  //    la commande existante (P&L / opp gagnée) — on évite d'annuler un CA réel par un 0.
  for (const s of sheets || []) {
    const fp = fpKey(s.fp);
    if (!fp) continue;
    if (!((s.saleTotal || 0) > 0)) continue; // fiche sans vente exploitable → conserve l'existant
    const prev = byFp.get(fp) || {};
    merge(fp, {
      fp, client: s.client || prev.client, affaire: s.affaire, am: s.commercial || prev.am,
      cas: s.saleTotal, mb: s.margin || 0, costTotal: s.costTotal, marginPct: s.marginPct,
      bu: prev.bu, yearPo: prev.yearPo || yearOfFp(fp) || 0,
      suppliers: prev.suppliers || [], source: "fiche", pnlSource: "fiche",
    });
  }

  // RAF DÉRIVÉ pour TOUTES les sources : RAF = max(CAS − Σfactures du FP, 0).
  // `billed[fp]` somme les factures de TOUS les exercices → le RAF reste juste même quand le
  // CAS date d'une année antérieure et que la facturation s'étale sur plusieurs exercices.
  // On n'utilise plus le « RAF total » figé de l'Excel P&L (instantané pouvant précéder des
  // factures → double-comptage Facturé+Backlog dans la projection CAF). L'identité
  // CAS = Facturé + RAF est ainsi garantie pour chaque commande.
  return [...byFp.values()].map((o) => ({
    ...o,
    raf: Math.max((o.cas || 0) - (billed[o.fp] || 0), 0),
  }));
}

module.exports = { mergeCommandes };
