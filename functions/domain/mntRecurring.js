// Domain PUR — Revenu récurrent (MRR/ARR) des contrats de maintenance (mnt_), Lot 5b. Aucun I/O.
// MIROIR BACK EXACT de web/src/lib/mntDashboard.ts → recurringRevenue (mêmes nombres, invariant CLAUDE.md
// « une même métrique calculée à deux endroits doit donner le même nombre »). Sert au snapshot quotidien
// summaries/mnt_mrrSnapshot (ADR-043) pour l'historisation de tendance.
//
//   ARR (Annual Recurring Revenue) = montant PAR ÉCHÉANCE annualisé (× échéances/an).
//   MRR (Monthly Recurring Revenue) = ARR / 12, arrondi au niveau AGRÉGÉ (pas par contrat) pour éviter la
//   dérive d'arrondi cumulée — IDENTIQUE au front.
//   Assiette = contrats ACTIFS uniquement (un brouillon n'est pas engagé, un échu/résilié ne court plus) —
//   cohérent avec arrActifs du tableau de bord et avec recurringRevenue.

// Mois par période — miroir de functions/domain/mntEcheancier.PERIOD_MONTHS et de mntDashboard.ts.
const PERIOD_MONTHS = { mensuel: 1, trimestriel: 3, annuel: 12 };
const annualiseMontant = (montantEngage, echeanceType) =>
  (Number(montantEngage) || 0) * (12 / (PERIOD_MONTHS[echeanceType] || 1));

/**
 * Totaux de revenu récurrent des contrats ACTIFS. PUR.
 * @param {object[]} contrats [{ statut, echeanceType, montantEngage }]
 * @returns {{ contratsActifs:number, totalArr:number, totalMrr:number }} (FCFA entiers)
 */
function recurringTotals(contrats) {
  let contratsActifs = 0, totalArr = 0;
  for (const c of Array.isArray(contrats) ? contrats : []) {
    if ((c && c.statut ? c.statut : "brouillon") !== "actif") continue; // même assiette que le front
    contratsActifs++;
    totalArr += annualiseMontant(c.montantEngage, c.echeanceType);
  }
  return {
    contratsActifs,
    totalArr: Math.round(totalArr),
    totalMrr: Math.round(totalArr / 12), // MRR dérivé de l'ARR au niveau agrégé (parité front)
  };
}

module.exports = { PERIOD_MONTHS, annualiseMontant, recurringTotals };
