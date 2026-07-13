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

// Fenêtre de CLÔTURE cible : septembre → novembre (mois 9,10,11). Les projets DÉJÀ en facturation y
// voient leur reliquat CONCENTRÉ (clôture différée à l'automne) — cf. pilotage CODIR : combler le creux
// sept–nov et aplatir le pic d'août. Poids appliqué à ces mois vs les autres mois cibles.
const CLOSE_WINDOW = [9, 10, 11];
const CLOSE_WEIGHT = 3;

/** Échéancier PAR DÉFAUT / AUTO-GÉNÉRÉ (repli quand un projet n'a pas de jalons saisis) : `amount`
 *  réparti sur les mois de l'exercice, DU MOIS COURANT au 31/12 (inclus — le mois courant reçoit donc
 *  du planifié : le « reste à facturer » du mois en cours n'est plus systématiquement nul), UN jalon
 *  par mois (plus de trous sept/nov). Pondération selon l'avancement :
 *   • projet DÉJÀ en facturation (`opts.started`, taux > 0) → reliquat CONCENTRÉ sur la fenêtre de
 *     clôture sept–nov encore à venir (×CLOSE_WEIGHT) ; jalon léger sur les autres mois → clôture
 *     différée à l'automne, pic d'août aplati ;
 *   • projet PAS ENCORE facturé → réparti UNIFORMÉMENT du mois courant à décembre.
 *  DÉTERMINISTE (aucun aléa) : même entrée → même échéancier — condition sine qua non de la cohérence
 *  des recalculs. Tous les jalons ≤ 31/12 → report N+1 dérivé = 0 (le repli n'introduit aucun report
 *  fantôme). Σ jalons = `amount` (le reliquat d'arrondi tombe sur décembre, dernier mois).
 *  @param {object} [opts] { started?: boolean } — projet déjà en cours de facturation (taux > 0). */
function defaultMilestones(amount, asOf, fy, opts = {}) {
  const total = Math.round(Number(amount) || 0);
  if (total <= 0) return [];
  const started = !!(opts && opts.started);
  const y = Number(fy);
  const asOfYm = String(asOf || "").slice(0, 7);
  const asOfYear = asOfYm.slice(0, 4);
  const curMonth = Number(asOfYm.slice(5, 7)) || 0;
  // Premier mois cible : le mois COURANT (inclus) si on est dans l'exercice ; janvier si asOf le précède ;
  // décembre s'il le suit (exercice écoulé → tout au 31/12).
  let firstMonth = asOfYear === String(y) ? curMonth : asOfYear > String(y) ? 12 : 1;
  if (firstMonth < 1) firstMonth = 1;
  if (firstMonth > 12) firstMonth = 12;
  const months = [];
  for (let m = firstMonth; m <= 12; m++) months.push(m);
  // Concentration sur la fenêtre de clôture UNIQUEMENT si le projet est démarré ET qu'au moins un mois
  // sept–nov est encore à venir ; sinon répartition uniforme.
  const windowOpen = started && CLOSE_WINDOW.some((m) => m >= firstMonth);
  const weights = months.map((m) => (windowOpen && CLOSE_WINDOW.includes(m) ? CLOSE_WEIGHT : 1));
  const wSum = weights.reduce((s, w) => s + w, 0);
  const lastIdx = months.length - 1;
  const list = [];
  let acc = 0;
  for (let i = 0; i < months.length; i++) {
    const amt = i === lastIdx ? total - acc : Math.floor((total * weights[i]) / wSum); // reliquat sur déc.
    if (i !== lastIdx) acc += amt;
    if (amt > 0) list.push({ date: `${y}-${String(months[i]).padStart(2, "0")}-28`, amount: amt });
  }
  return normalizeMilestones(list);
}

module.exports = { MAX_MILESTONES, DEFAULT_MILESTONE_COUNT, CLOSE_WINDOW, CLOSE_WEIGHT, normalizeMilestones, milestonesTotal, reportedFromMilestones, plannedInMonth, defaultMilestones };
