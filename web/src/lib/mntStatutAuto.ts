// Statut automatique des contrats (mnt_) — présentation côté front (ADR-027). La logique (règles + IA,
// seuil d'auto-application) vit côté serveur (functions/domain/mntStatutAuto.js + callable
// aiMntContratStatut) ; ici seulement les LIBELLÉS FR et les tons. Pur.
export type MntStatutSource = "regle" | "ia";
export interface MntStatutProposal {
  id: string; fp: string | null; client: string;
  current: string; proposed: string; confidence: number; motif: string; source: MntStatutSource; recommended?: boolean;
}
// PROPOSE UNIQUEMENT (incident 2026-07-17) : l'analyse n'écrit AUCUN statut ; `recommended` = confiance ≥ seuil
// (repère), l'application est un geste humain (setMntContratStatut).
export interface MntStatutRun { ok: boolean; proposals: MntStatutProposal[]; analyzed: number; threshold: number; model?: string | null }

export const STATUT_SOURCE_LABEL: Record<string, string> = { regle: "Règle", ia: "IA" };
// Confiance → ton, aligné sur le seuil d'auto-application serveur (0.85) et la palette de risque.
export function confidenceTone(c: number): "emerald" | "gold" | "clay" {
  return c >= 0.85 ? "emerald" : c >= 0.6 ? "gold" : "clay";
}
