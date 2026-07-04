// Jalons de facturation par projet (≤ 15) : { date: "YYYY-MM-DD", amount: FCFA }. Module PUR (testable).
// Ils sont la SOURCE UNIQUE de l'échéancier de facturation d'un projet et servent à :
//   • dériver le report N+1 = Σ jalons dont la date est APRÈS le 31/12 de l'exercice ;
//   • alimenter la tendance de facturation (Σ jalons par mois, jusqu'au 31/12) ;
//   • détecter la DÉRIVE vs le RAF projetable (Σ jalons ≠ RAF → « à réconcilier »).
// Règle stricte de saisie (validée à l'éditeur) : Σ jalons = RAF projetable du projet.
const MAX_MILESTONES = 15;
const DEFAULT_MILESTONE_COUNT = 3;

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

/** Échéancier PAR DÉFAUT (repli quand un projet n'a pas de jalons saisis) : `amount` réparti
 *  UNIFORMÉMENT sur `n` jalons (défaut 3), étalés régulièrement sur les mois FUTURS de l'exercice
 *  jusqu'au 31/12 — pour aligner la facturation restante sur la tendance sans saisie manuelle.
 *  DÉTERMINISTE (aucun aléa) : même entrée → même échéancier, condition sine qua non de la cohérence
 *  des recalculs (un tirage aléatoire ferait « bouger » la tendance à chaque recompute). Tous les
 *  jalons sont datés ≤ 31/12 → report N+1 dérivé = 0 (le repli n'introduit aucun report fantôme).
 *  Repli d'exercice écoulé (asOf en décembre / après l'exercice) : tout au 31/12. Σ jalons = `amount`
 *  (le reliquat d'arrondi tombe sur le dernier jalon). */
function defaultMilestones(amount, asOf, fy, n = DEFAULT_MILESTONE_COUNT) {
  const total = Math.round(Number(amount) || 0);
  const count = Math.max(1, Math.floor(Number(n) || DEFAULT_MILESTONE_COUNT));
  if (total <= 0) return [];
  const y = Number(fy);
  const asOfYm = String(asOf || "").slice(0, 7);
  const asOfYear = asOfYm.slice(0, 4);
  const curMonth = Number(asOfYm.slice(5, 7)) || 0;
  // Fenêtre de mois cibles, bornée à décembre : les mois FUTURS de l'exercice (strictement après le
  // mois courant) si on est dans l'exercice ; toute l'année si asOf le précède ; décembre s'il le suit.
  let firstMonth = asOfYear === String(y) ? curMonth + 1 : asOfYear > String(y) ? 12 : 1;
  if (firstMonth > 12) firstMonth = 12; // asOf en décembre → repli sur décembre
  const span = 12 - firstMonth + 1;     // nombre de mois disponibles (≥ 1)
  const base = Math.floor(total / count);
  const list = [];
  for (let i = 0; i < count; i++) {
    const idx = span <= 1 || count <= 1 ? 0 : Math.round((i * (span - 1)) / (count - 1));
    const month = Math.min(firstMonth + idx, 12);
    const amt = i === count - 1 ? total - base * (count - 1) : base; // reliquat d'arrondi sur le dernier
    list.push({ date: `${y}-${String(month).padStart(2, "0")}-28`, amount: amt });
  }
  return normalizeMilestones(list);
}

module.exports = { MAX_MILESTONES, DEFAULT_MILESTONE_COUNT, normalizeMilestones, milestonesTotal, reportedFromMilestones, plannedInMonth, defaultMilestones };
