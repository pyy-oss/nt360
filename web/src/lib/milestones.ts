// Miroir client de functions/domain/milestones.js (défaut d'échéancier). Garder ALIGNÉ avec le back :
// le serveur fait AUTORITÉ (la tendance de facturation dérive des jalons effectifs côté aggregate) ;
// ce miroir ne sert qu'à PRÉ-REMPLIR l'éditeur (l'utilisateur ajuste puis enregistre).
export type Milestone = { date: string; amount: number };

export const DEFAULT_MILESTONE_COUNT = 3;

/** Échéancier par défaut : `amount` réparti uniformément sur `n` jalons, étalés régulièrement sur les
 *  mois futurs de l'exercice jusqu'au 31/12. Déterministe. Σ jalons = `amount` (reliquat sur le dernier). */
export function defaultMilestones(amount: number, asOf: string, fy: number, n = DEFAULT_MILESTONE_COUNT): Milestone[] {
  const total = Math.round(Number(amount) || 0);
  const count = Math.max(1, Math.floor(Number(n) || DEFAULT_MILESTONE_COUNT));
  if (total <= 0) return [];
  const y = Number(fy);
  const asOfYm = String(asOf || "").slice(0, 7);
  const asOfYear = asOfYm.slice(0, 4);
  const curMonth = Number(asOfYm.slice(5, 7)) || 0;
  let firstMonth = asOfYear === String(y) ? curMonth + 1 : asOfYear > String(y) ? 12 : 1;
  if (firstMonth > 12) firstMonth = 12;
  const span = 12 - firstMonth + 1;
  const base = Math.floor(total / count);
  const list: Milestone[] = [];
  for (let i = 0; i < count; i++) {
    const idx = span <= 1 || count <= 1 ? 0 : Math.round((i * (span - 1)) / (count - 1));
    const month = Math.min(firstMonth + idx, 12);
    const amt = i === count - 1 ? total - base * (count - 1) : base;
    list.push({ date: `${y}-${String(month).padStart(2, "0")}-28`, amount: amt });
  }
  return list;
}
