// Design "Forest & Gold" — palette et helpers (BUILD_KIT §12, aligné au prototype).
// Les valeurs référencent les VARIABLES CSS de thème (définies dans index.css) : ainsi les styles
// inline et les couleurs de graphes (Recharts) suivent automatiquement le thème clair/sombre.
export const T = {
  bg: "rgb(var(--bg))",
  panel: "rgb(var(--panel))",
  panel2: "rgb(var(--panel2))",
  line: "rgb(var(--line))",
  ink: "rgb(var(--ink))",
  dim: "rgb(var(--muted))",
  faint: "rgb(var(--faint))",
  gold: "rgb(var(--gold))",
  emerald: "rgb(var(--emerald))",
  clay: "rgb(var(--clay))",
  steel: "rgb(var(--steel))",
  plum: "rgb(var(--plum))",
} as const;

export const colors = T; // alias historique

// Couleurs par BU / étape pipeline / statut BC (identiques au prototype).
export const BU_COL: Record<string, string> = { ICT: T.emerald, CLOUD: T.steel, FORMATION: T.gold, AUTRE: T.faint };
export const buColors = BU_COL;
// Une teinte DISTINCTE par étape : ne pas coder des sens opposés (Négo ≠ Perdu, Contrat ≠ Gagné)
// avec la même couleur — lisibilité + daltonisme.
export const STAGE_COL: Record<number, string> = { 1: T.steel, 2: T.dim, 3: T.plum, 4: T.gold, 5: "#5FB0A0", 6: T.emerald, 7: T.clay, 8: "#B07A3C", 9: T.faint };
export const BC_COL: Record<string, string> = { a_emettre: T.faint, emis: T.steel, livre: T.gold, facture: T.plum, solde: T.emerald };

/** Formatage FCFA : Md / M / k. Distingue l'ABSENCE de donnée ("—") d'un vrai zéro ("0"). */
export function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!isFinite(n)) return "—"; // NaN / Infinity = donnée invalide, pas un zéro
  if (n === 0) return "0";
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

/** Formatage pourcentage. Absence de donnée → "—" (pas "0%"). */
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}
