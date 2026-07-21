// Miroir client de functions/domain/milestones.js (défaut d'échéancier). Garder ALIGNÉ avec le back :
// le serveur fait AUTORITÉ (la tendance de facturation dérive des jalons effectifs côté aggregate) ;
// ce miroir ne sert qu'à PRÉ-REMPLIR l'éditeur (l'utilisateur ajuste puis enregistre).
export type Milestone = { date: string; amount: number };

import { plausibleYear } from "./ids";

/** Report N+1 dérivé des jalons — MIROIR de functions/domain/milestones.js:reportedFromMilestones, avec
 *  le MÊME bornage que normalizeMilestones (date AAAA-MM-JJ + millésime plausible — un jalon « 20226-… »
 *  n'est compté d'aucun côté) : Σ des jalons datés APRÈS `cutoff` (31/12 de l'exercice), bornée à
 *  [0, cap] (RAF projetable). Extrait de CarryoverCard (backlog.tsx) pour être TESTABLE — la logique
 *  miroir inline dans le composant n'était couverte par aucun test (audit backlog, axe 9). */
export function reportedFromMilestones(ms: Milestone[] | null | undefined, cutoff: string, cap: number): number {
  if (!ms || !ms.length) return 0;
  const after = ms.filter((x) => {
    const d = String(x.date || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && plausibleYear(d.slice(0, 4)) > 0 && d > cutoff;
  }).reduce((s, x) => s + (x.amount || 0), 0);
  return Math.max(0, Math.min(after, cap));
}

export const DEFAULT_MILESTONE_COUNT = 3;

/** Échéancier par défaut — MIROIR EXACT du repli serveur (functions/domain/milestones.js:defaultMilestones,
 *  audit backlog H1 « miroir désaligné ») : courbe pondérée CROISSANTE (poids 1,2,3… vers décembre) sur les
 *  mois du MOIS COURANT (inclus) au 31/12 — pas de plateau uniforme, pas de décalage d'un mois — et jalon
 *  UNIQUE au mois de clôture si `opts.closeMs` (date ClickUp) tombe dans l'exercice et n'est pas passée.
 *  Sans cet alignement, « Répartir par défaut » CHANGEAIT la prévision (billingTrend suit le défaut serveur)
 *  alors que l'utilisateur croyait valider l'existant. Déterministe ; Σ jalons = `amount` (reliquat déc.). */
export function defaultMilestones(amount: number, asOf: string, fy: number, opts: { closeMs?: number } = {}): Milestone[] {
  const total = Math.round(Number(amount) || 0);
  if (total <= 0) return [];
  const y = Number(fy);
  const asOfYm = String(asOf || "").slice(0, 7);
  const asOfYear = asOfYm.slice(0, 4);
  const curMonth = Number(asOfYm.slice(5, 7)) || 0;
  let firstMonth = asOfYear === String(y) ? curMonth : asOfYear > String(y) ? 12 : 1;
  if (firstMonth < 1) firstMonth = 1;
  if (firstMonth > 12) firstMonth = 12;

  // 1) Date de clôture réelle dans l'exercice et non passée → un seul jalon sur ce mois (parité serveur).
  const closeMs = Number(opts.closeMs) || 0;
  if (closeMs > 0) {
    const d = new Date(closeMs);
    if (!Number.isNaN(d.getTime())) {
      const cy = d.getUTCFullYear(), cm = d.getUTCMonth() + 1;
      if (cy === y && cm >= firstMonth && cm <= 12) return [{ date: `${y}-${String(cm).padStart(2, "0")}-28`, amount: total }];
    }
  }

  // 2) Repli : courbe pondérée croissante (poids 1,2,3… vers décembre) — reliquat d'arrondi sur décembre.
  const months: number[] = [];
  for (let m = firstMonth; m <= 12; m++) months.push(m);
  const weights = months.map((_, i) => i + 1);
  const wSum = weights.reduce((s, w) => s + w, 0);
  const lastIdx = months.length - 1;
  const list: Milestone[] = [];
  let acc = 0;
  for (let i = 0; i < months.length; i++) {
    const amt = i === lastIdx ? total - acc : Math.floor((total * weights[i]) / wSum);
    if (i !== lastIdx) acc += amt;
    if (amt > 0) list.push({ date: `${y}-${String(months[i]).padStart(2, "0")}-28`, amount: amt });
  }
  return list;
}
