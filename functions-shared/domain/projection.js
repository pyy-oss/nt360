// Moteur de PROJECTION du pipeline — 3 niveaux de certitude (IdC), chacun ACTIVABLE et PONDÉRABLE.
// « On ne mélange pas les patates et les carottes » : les 3 niveaux sont des cohortes DISJOINTES
// (par borne d'IdC) et le pondéré projeté est la SOMME des seuls niveaux ACTIFS, décomposable.
//
// Bornes d'IdC FIXES (≥ 90 % · 70-90 % · 50-70 %) ; POIDS + ACTIVATION configurables via
// config/projection (édité en Admin), consommés par le recompute serveur ET le miroir client.
// Défaut : les 3 niveaux actifs — Certitudes 100 % · Forecast 20 % · Pipe 5 %.
const TIER_DEFS = [
  { key: "certitudes", min: 0.9, weight: 1,    label: "Certitudes", band: "≥ 90 %" },
  { key: "forecast",   min: 0.7, weight: 0.2,  label: "Forecast",   band: "70-90 %" },
  { key: "pipe",       min: 0.5, weight: 0.05, label: "Pipe",       band: "50-70 %" },
];

// Normalisation d'échelle de l'IdC. L'IdC est saisi/stocké en POURCENTAGE (0-100) dans toute l'app ;
// les paliers ci-dessus raisonnent en 0-1. `p01` ramène toute valeur en 0-1 : > 1 ⇒ pourcentage (÷100),
// sinon déjà un ratio (données historiques 0-1 tolérées → aucune migration). Identité pour p ≤ 1.
const p01 = (p) => { const n = Number(p) || 0; return n > 1 ? n / 100 : n; };

/** Fusionne la config (config/projection) sur les défauts et borne les valeurs. Renvoie un tableau
 *  ORDONNÉ du niveau le plus haut au plus bas (indispensable pour projectionWeight). */
function normalizeTiers(cfg) {
  const g = cfg || {};
  return TIER_DEFS.map((d) => {
    const c = g[d.key] || {};
    const weight = typeof c.weight === "number" && c.weight >= 0 && c.weight <= 1 ? c.weight : d.weight;
    const active = c.active === undefined ? true : !!c.active;
    return { key: d.key, min: d.min, label: d.label, band: d.band, weight, active };
  });
}

/** Pondération de projection d'une opp : applique le poids du 1er niveau atteint (par IdC), 0 si le
 *  niveau est désactivé ou si l'IdC est sous le plancher du plus bas niveau. */
function projectionWeight(o, tiers) {
  const t = tiers || normalizeTiers();
  const p = p01((o && o.probability) || 0), amt = (o && o.amount) || 0;
  for (const tier of t) { // ordonné min décroissant : 0.9 → 0.7 → 0.5
    if (p >= tier.min) return tier.active ? amt * tier.weight : 0;
  }
  return 0;
}

/** Décompose un ensemble d'opps par niveau (brut / pondéré / compte) — pour afficher chaque cohorte
 *  SÉPARÉMENT (jamais un seul nombre mélangé). Le pondéré d'un niveau désactivé est 0. */
function tierBreakdown(opps, tiers) {
  const t = tiers || normalizeTiers();
  const out = t.map((tier) => ({ key: tier.key, label: tier.label, band: tier.band, weight: tier.weight, active: tier.active, brut: 0, pond: 0, count: 0 }));
  for (const o of opps || []) {
    const p = p01(o.probability || 0), amt = o.amount || 0;
    const idx = t.findIndex((tier) => p >= tier.min);
    if (idx < 0) continue;
    out[idx].brut += amt;
    out[idx].count++;
    out[idx].pond += out[idx].active ? amt * out[idx].weight : 0;
  }
  return out;
}

module.exports = { TIER_DEFS, normalizeTiers, projectionWeight, tierBreakdown, p01 };
