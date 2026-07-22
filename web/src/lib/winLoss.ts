import type { Opportunity } from "../types";
import { isAgedLost } from "./ids";

// TAUX DE GAIN PAR SEGMENT — regroupé par une clé de segment (origine du lead, BU…). Répond « où gagne-t-on,
// où perd-on ». Gagné = étape 6. Perdu = étape 7 (Perdu) OU 9 (Annulé, un non-gagné) OU auto-périmé par âge
// (isAgedLost) — MÊME définition que le back (oppLifecycle.isLostOpp), sinon annulés + périmées échappaient
// au dénominateur → win rate optimiste (audit commercial DC/DG). NB : les opps déjà filtrées en amont (rows
// exclut stale/aged) ne remontent pas ici — le prédicat aged-lost reste pour la parité de définition.
// PURE (aucun état, aucune horloge) → testable.
export type WinLossRow = {
  key: string; won: number; lost: number; total: number; winRate: number; winRateValue: number; wonAmount: number; lostAmount: number;
};

export function winLossBySegment(rows: Opportunity[], keyFn: (o: Opportunity) => string): WinLossRow[] {
  const m = new Map<string, WinLossRow>();
  for (const o of rows || []) {
    const st = o.stage || 0;
    const won = st === 6;
    const lost = st === 7 || st === 9 || isAgedLost(o); // perdu = Perdu OU Annulé OU auto-périmé (parité back)
    if (!won && !lost) continue; // seules les opps CLÔTURÉES (gagnées/perdues) comptent dans un taux de gain
    const k = keyFn(o) || "—";
    const e = m.get(k) || { key: k, won: 0, lost: 0, total: 0, winRate: 0, winRateValue: 0, wonAmount: 0, lostAmount: 0 };
    if (won) { e.won++; e.wonAmount += o.amount || 0; } else { e.lost++; e.lostAmount += o.amount || 0; }
    m.set(k, e);
  }
  return [...m.values()]
    // winRateValue = montant gagné / montant clôturé : complète le taux EN NOMBRE (win rate). Un écart révèle
    // qu'un segment gagne les petites affaires mais perd les grosses (ou l'inverse). Même population clôturée.
    .map((e) => ({
      ...e,
      total: e.won + e.lost,
      winRate: e.won + e.lost > 0 ? e.won / (e.won + e.lost) : 0,
      winRateValue: e.wonAmount + e.lostAmount > 0 ? e.wonAmount / (e.wonAmount + e.lostAmount) : 0,
    }))
    .sort((a, b) => b.total - a.total || b.winRate - a.winRate); // les segments les plus « joués » d'abord
}
