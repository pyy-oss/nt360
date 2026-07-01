// Design "Forest & Gold" — palette et helpers (BUILD_KIT §12, aligné au prototype).
export const T = {
  bg: "#0E1613",
  panel: "#151F1A",
  panel2: "#1B2721",
  line: "#26352D",
  ink: "#EEF3EF",
  dim: "#8FA89B",
  faint: "#5E7268",
  gold: "#C9A24B",
  emerald: "#46C08A",
  clay: "#D9694C",
  steel: "#6E9DC0",
  plum: "#A98AC4",
} as const;

export const colors = T; // alias historique

// Couleurs par BU / étape pipeline / statut BC (identiques au prototype).
export const BU_COL: Record<string, string> = { ICT: "#46C08A", CLOUD: "#6E9DC0", FORMATION: "#C9A24B", AUTRE: "#5E7268" };
export const buColors = BU_COL;
export const STAGE_COL: Record<number, string> = { 1: "#6E9DC0", 2: "#8FA89B", 3: "#C9A24B", 4: "#D9694C", 5: "#46C08A", 6: "#46C08A", 7: "#D9694C", 8: "#A98AC4", 9: "#5E7268" };
export const BC_COL: Record<string, string> = { a_emettre: "#5E7268", emis: "#6E9DC0", livre: "#C9A24B", facture: "#A98AC4", solde: "#46C08A" };

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

/** Montant complet avec séparateurs (tooltips, exports) : 1 085 668. */
export function fmtFull(v: number | null | undefined): string {
  const n = Math.round(Number(v) || 0);
  return n.toLocaleString("fr-FR").replace(/ |,/g, " ");
}

/** Formatage pourcentage. */
export function pct(v: number | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n)) return "0%";
  return (n * 100).toFixed(1) + "%";
}
