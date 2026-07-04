// Jalons de facturation par projet (≤ 15) : { date: "YYYY-MM-DD", amount: FCFA }. Module PUR (testable).
// Ils sont la SOURCE UNIQUE de l'échéancier de facturation d'un projet et servent à :
//   • dériver le report N+1 = Σ jalons dont la date est APRÈS le 31/12 de l'exercice ;
//   • alimenter la tendance de facturation (Σ jalons par mois, jusqu'au 31/12) ;
//   • détecter la DÉRIVE vs le RAF projetable (Σ jalons ≠ RAF → « à réconcilier »).
// Règle stricte de saisie (validée à l'éditeur) : Σ jalons = RAF projetable du projet.
const MAX_MILESTONES = 15;

/** Nettoie/valide une liste de jalons : dates ISO, montants entiers > 0, triés par date, ≤ 15.
 *  Déterministe et idempotent (normalize(normalize(x)) === normalize(x)). */
function normalizeMilestones(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => ({ date: m && m.date ? String(m.date).slice(0, 10) : "", amount: Math.round(Number(m && m.amount) || 0) }))
    .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date) && m.amount > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, MAX_MILESTONES);
}

/** Σ des montants des jalons (après normalisation). */
function milestonesTotal(list) {
  return normalizeMilestones(list).reduce((s, m) => s + m.amount, 0);
}

/** Report N+1 dérivé : Σ des jalons strictement APRÈS le 31/12 de l'exercice `fy`. Borné à `rafProj`
 *  (sûreté en cas de dérive Σ jalons ≠ RAF) quand rafProj est fourni. */
function reportedFromMilestones(list, fy, rafProj) {
  const cutoff = `${fy}-12-31`;
  const after = normalizeMilestones(list).filter((m) => m.date > cutoff).reduce((s, m) => s + m.amount, 0);
  return rafProj == null ? after : Math.max(0, Math.min(after, rafProj));
}

/** Σ des jalons du mois `ym` ("YYYY-MM") — pour la tendance de facturation (planifié). */
function plannedInMonth(list, ym) {
  return normalizeMilestones(list).filter((m) => m.date.slice(0, 7) === String(ym)).reduce((s, m) => s + m.amount, 0);
}

module.exports = { MAX_MILESTONES, normalizeMilestones, milestonesTotal, reportedFromMilestones, plannedInMonth };
