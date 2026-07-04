// Miroir CLIENT du moteur de projection serveur (functions/domain/projection.js). DOIT rester aligné.
// 3 niveaux de certitude DISJOINTS (bornes d'IdC fixes), chacun activable/pondérable via
// config/projection. Défaut : Certitudes 100 % · Forecast 20 % · Pipe 5 % (tous actifs).

export type TierKey = "certitudes" | "forecast" | "pipe";
export type Tier = { key: TierKey; min: number; label: string; band: string; weight: number; active: boolean };
export type ProjectionConfig = Partial<Record<TierKey, { active?: boolean; weight?: number }>>;

const DEFS: { key: TierKey; min: number; weight: number; label: string; band: string }[] = [
  { key: "certitudes", min: 0.9, weight: 1, label: "Certitudes", band: "≥ 90 %" },
  { key: "forecast", min: 0.7, weight: 0.2, label: "Forecast", band: "70-90 %" },
  { key: "pipe", min: 0.5, weight: 0.05, label: "Pipe", band: "50-70 %" },
];

/** Fusionne la config sur les défauts (poids borné [0,1], actif par défaut). Tableau ordonné min ↓. */
export function normalizeTiers(cfg?: ProjectionConfig): Tier[] {
  const g = cfg || {};
  return DEFS.map((d) => {
    const c = g[d.key] || {};
    const weight = typeof c.weight === "number" && c.weight >= 0 && c.weight <= 1 ? c.weight : d.weight;
    const active = c.active === undefined ? true : !!c.active;
    return { key: d.key, min: d.min, label: d.label, band: d.band, weight, active };
  });
}

/** Pondération de projection d'une opp : poids du 1er niveau atteint, 0 si niveau inactif. */
export function projectionWeight(o: { probability?: number; amount?: number }, tiers?: Tier[]): number {
  const t = tiers || normalizeTiers();
  const p = o.probability || 0, amt = o.amount || 0;
  for (const tier of t) if (p >= tier.min) return tier.active ? amt * tier.weight : 0;
  return 0;
}
