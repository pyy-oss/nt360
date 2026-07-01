// Design "Forest & Gold" — tokens conservés du prototype (BUILD_KIT §12).
export const colors = {
  bg: "#0E1613",
  panel: "#151F1A",
  ink: "#EEF3EF",
  gold: "#C9A24B",
  emerald: "#46C08A",
  clay: "#D9694C",
  steel: "#6E9DC0",
  plum: "#A98AC4",
} as const;

// Couleurs par BU.
export const buColors = {
  ICT: colors.emerald,
  CLOUD: colors.steel,
  FORMATION: colors.gold,
  AUTRE: colors.plum,
} as const;

export const fonts = {
  display: "'Bricolage Grotesque', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
} as const;

/** Formatage FCFA : Md / M / k (garde anti-NaN/zéro, §18.7). */
export function fmt(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + " Md";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + " M";
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + " k";
  return String(Math.round(n));
}

/** Formatage pourcentage. */
export function pct(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n)) return "0%";
  return (n * 100).toFixed(1) + "%";
}
