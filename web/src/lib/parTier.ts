// Progression de niveau de partenariat (par_) — PUR. À partir des NIVEAUX d'un partenaire (tiers, rang
// croissant) et de la COUVERTURE de ses exigences de quota (déjà calculée par le backend, summary
// par_quotas : une ligne par exigence avec holders/minCount/ok), on dérive :
//   - le NIVEAU TENU : le plus haut niveau tel que lui ET tous les niveaux inférieurs sont entièrement
//     couverts (on ne « tient » Gold que si Silver et Authorized le sont aussi — échelle cumulative) ;
//   - le PROCHAIN NIVEAU : le premier niveau (par rang) non entièrement couvert, et l'ÉCART = ses exigences
//     manquantes (cible, détenteurs actuels vs minimum, manque).
// Aucun re-calcul de couverture : on ne fait que INTERPRÉTER les `ok` du summary (invariant de parité —
// même population, mêmes nombres que la carte Conformité).

export type Tier = { id: string; name: string; rank: number };
export type CoverageRow = { tierId: string; target: string; minCount: number; holders: number; ok: boolean };
export type TierGap = { target: string; holders: number; minCount: number; missing: number };
export type TierProgress = {
  achieved: Tier | null; // niveau tenu (null si même le plus bas n'est pas couvert)
  next: Tier | null;     // prochain niveau à décrocher (null si tous tenus)
  gaps: TierGap[];        // exigences manquantes du prochain niveau
};

// Un niveau est « couvert » si toutes ses exigences sont ok. Un niveau SANS exigence est couvert (rien à
// satisfaire) — cohérent avec le backend qui ne bloque pas sur l'absence d'exigence.
export function tierProgress(tiers: Tier[] | null | undefined, coverage: CoverageRow[] | null | undefined): TierProgress {
  const sorted = (tiers || []).slice().sort((a, b) => a.rank - b.rank);
  const byTier = new Map<string, CoverageRow[]>();
  for (const r of coverage || []) {
    const arr = byTier.get(r.tierId) || [];
    arr.push(r); byTier.set(r.tierId, arr);
  }
  const metOf = (tierId: string) => (byTier.get(tierId) || []).every((r) => r.ok); // vide → true

  // Niveau tenu = plus haut niveau contigu depuis le bas dont toutes les exigences (et celles d'en dessous)
  // sont couvertes. On s'arrête à la première rupture de la chaîne.
  let achieved: Tier | null = null;
  for (const t of sorted) {
    if (metOf(t.id)) achieved = t; else break;
  }
  // Prochain niveau = premier niveau non couvert par rang (celui qui a rompu la chaîne, ou plus haut).
  const next = sorted.find((t) => !metOf(t.id)) || null;
  const gaps: TierGap[] = next
    ? (byTier.get(next.id) || []).filter((r) => !r.ok).map((r) => ({ target: r.target, holders: r.holders, minCount: r.minCount, missing: Math.max(0, r.minCount - r.holders) }))
    : [];
  return { achieved, next, gaps };
}
