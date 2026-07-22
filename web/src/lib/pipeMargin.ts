// MARGE ATTENDUE DU PIPE — le pondéré porte le CA escompté, jamais la marge. Chaque opp porte un MB
// prévisionnel (`mbPrev`, en %) : prévision commerciale NON confidentielle (cf. pipeline.tsx). On agrège
// ici la marge attendue = Σ (pondéré × mbPrev %) sur l'assiette pipeline, le taux moyen PONDÉRÉ, et une
// ventilation par BU. Répond au « risque de marge » de l'audit DC/DG : un gros pipe à faible marge est un
// risque que le seul CA pondéré masque. PURE (aucun état, aucune horloge) → testable.
//
// mbPrev absent → 0 % : on n'INVENTE pas de marge (prudent). Le taux moyen est donc dilué par les opps sans
// MB saisi — c'est voulu (signale un pipe mal qualifié en marge), et cohérent avec l'estimation de marge de
// commande (commandes.js : mb = mbPrev% × CAS quand renseigné).
export type PipeMarginItem = { weighted: number; mbPrev?: number | null; bu?: string | null };
export type PipeMarginByBu = { bu: string; weighted: number; margin: number; marginRate: number };
export type PipeMarginResult = { weighted: number; margin: number; marginRate: number; byBu: PipeMarginByBu[] };

export function pipeExpectedMargin(items: PipeMarginItem[]): PipeMarginResult {
  let weighted = 0, margin = 0;
  const m = new Map<string, { weighted: number; margin: number }>();
  for (const it of items || []) {
    const w = Number(it.weighted) || 0;
    const rate = Number(it.mbPrev) || 0; // mbPrev absent/invalide → 0 % (pas de marge inventée)
    const mg = w * (rate / 100);
    weighted += w; margin += mg;
    const bu = (it.bu || "AUTRE").trim() || "AUTRE";
    const e = m.get(bu) || { weighted: 0, margin: 0 };
    e.weighted += w; e.margin += mg; m.set(bu, e);
  }
  const byBu = [...m.entries()]
    .map(([bu, v]) => ({ bu, weighted: Math.round(v.weighted), margin: Math.round(v.margin), marginRate: v.weighted > 0 ? v.margin / v.weighted : 0 }))
    .sort((a, b) => b.margin - a.margin);
  return { weighted: Math.round(weighted), margin: Math.round(margin), marginRate: weighted > 0 ? margin / weighted : 0, byBu };
}
