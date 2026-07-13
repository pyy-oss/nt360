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

/** Mois (1-12) d'une date epoch ms, en UTC (déterministe), ou 0 si invalide. */
function monthOfMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const d = new Date(n);
  return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1); // AAAAMM pour comparer année+mois
}

/** Échéancier PAR DÉFAUT / AUTO-GÉNÉRÉ (repli quand un projet n'a pas de jalons saisis).
 *  PILOTÉ PAR LA DATE DE CLÔTURE RÉELLE quand elle est connue et À VENIR :
 *   • `opts.closeMs` (date de fin prév. / contractuelle remontée de ClickUp) tombant dans l'exercice et
 *     AU MOIS COURANT OU APRÈS → UN seul jalon, tout le RAF sur ce mois de clôture (relief piloté par les
 *     vraies échéances, pas de lissage artificiel).
 *   • Sinon (aucune date, date PASSÉE, ou hors exercice) → repli : courbe pondérée NON UNIFORME sur les
 *     mois du MOIS COURANT au 31/12, poids croissants vers la fin d'année (facturation qui monte vers la
 *     clôture) → pas de plateaux identiques (« trop linéaire »), pas de trou, mois courant non nul.
 *  DÉTERMINISTE (aucun aléa) : même entrée → même échéancier — condition sine qua non de la cohérence des
 *  recalculs. Tous les jalons ≤ 31/12 → report N+1 dérivé = 0. Σ jalons = `amount` (reliquat sur décembre).
 *  @param {object} [opts] { closeMs?: number } — date de clôture attendue (epoch ms). */
function defaultMilestones(amount, asOf, fy, opts = {}) {
  const total = Math.round(Number(amount) || 0);
  if (total <= 0) return [];
  const y = Number(fy);
  const asOfYm = String(asOf || "").slice(0, 7);
  const asOfYear = asOfYm.slice(0, 4);
  const curMonth = Number(asOfYm.slice(5, 7)) || 0;
  // Premier mois cible : le mois COURANT (inclus) si on est dans l'exercice ; janvier si asOf le précède ;
  // décembre s'il le suit (exercice écoulé → tout au 31/12).
  let firstMonth = asOfYear === String(y) ? curMonth : asOfYear > String(y) ? 12 : 1;
  if (firstMonth < 1) firstMonth = 1;
  if (firstMonth > 12) firstMonth = 12;

  // 1) Date de clôture réelle dans l'exercice et non passée → un seul jalon sur ce mois.
  const closeYm = monthOfMs(opts && opts.closeMs);          // AAAAMM ou 0
  if (closeYm) {
    const cy = Math.floor(closeYm / 100), cm = closeYm % 100;
    if (cy === y && cm >= firstMonth && cm <= 12) {
      return normalizeMilestones([{ date: `${y}-${String(cm).padStart(2, "0")}-28`, amount: total }]);
    }
  }

  // 2) Repli : courbe pondérée croissante (poids 1,2,3… vers décembre) → non plate, sans trou.
  const months = [];
  for (let m = firstMonth; m <= 12; m++) months.push(m);
  const weights = months.map((_, i) => i + 1);
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

module.exports = { MAX_MILESTONES, DEFAULT_MILESTONE_COUNT, monthOfMs, normalizeMilestones, milestonesTotal, reportedFromMilestones, plannedInMonth, defaultMilestones };
