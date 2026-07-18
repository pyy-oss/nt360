import type { Opportunity } from "../types";

// TAUX DE GAIN PAR SEGMENT — sur les opps CLÔTURÉES (Gagné = étape 6 / Perdu = étape 7), regroupées par une
// clé de segment (origine du lead, BU…). Répond « où gagne-t-on, où perd-on » : taux de gain = gagné /
// (gagné + perdu). Complète l'analyse win/loss LOSS-only (par concurrent / motif) déjà présente — même
// famille, angle « rate » plutôt que « pertes seules ». PURE (aucun état, aucune horloge) → testable.
export type WinLossRow = {
  key: string; won: number; lost: number; total: number; winRate: number; wonAmount: number; lostAmount: number;
};

export function winLossBySegment(rows: Opportunity[], keyFn: (o: Opportunity) => string): WinLossRow[] {
  const m = new Map<string, WinLossRow>();
  for (const o of rows || []) {
    const st = o.stage || 0;
    if (st !== 6 && st !== 7) continue; // seules les opps clôturées comptent dans un taux de gain
    const k = keyFn(o) || "—";
    const e = m.get(k) || { key: k, won: 0, lost: 0, total: 0, winRate: 0, wonAmount: 0, lostAmount: 0 };
    if (st === 6) { e.won++; e.wonAmount += o.amount || 0; } else { e.lost++; e.lostAmount += o.amount || 0; }
    m.set(k, e);
  }
  return [...m.values()]
    .map((e) => ({ ...e, total: e.won + e.lost, winRate: e.won + e.lost > 0 ? e.won / (e.won + e.lost) : 0 }))
    .sort((a, b) => b.total - a.total || b.winRate - a.winRate); // les segments les plus « joués » d'abord
}
