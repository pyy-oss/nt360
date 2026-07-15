// Risque des contrats de maintenance (Lot 5) — libellés FR + tons de badge, côté front. Miroir des
// CODES produits par functions/domain/mntRisque.js (matérialisés dans summaries/mnt_risque) ; seuls
// les libellés affichés vivent ici (02-REGLES.md). Palette de risque = ADR-008 (emerald/gold/clay/plum).
// Pur → testable sans React.

export type Niveau = "vert" | "ambre" | "rouge" | "critique";
export type SignalType = "sla_rompu" | "echeance_proche" | "quota_depasse" | "sous_facturation";

export const NIVEAU_LABEL: Record<string, string> = {
  vert: "Vert", ambre: "Ambre", rouge: "Rouge", critique: "Critique",
};

// Ton de badge du niveau : mêmes teintes que la priorité de ticket (ADR-008/014) — un rouge veut dire
// « danger » partout. vert=emerald, ambre=gold, rouge=clay, critique=plum.
export function niveauTone(n?: string): "emerald" | "gold" | "clay" | "plum" | "neutral" {
  switch (n) {
    case "vert": return "emerald";
    case "ambre": return "gold";
    case "rouge": return "clay";
    case "critique": return "plum";
    default: return "neutral";
  }
}

export const SIGNAL_LABEL: Record<string, string> = {
  sla_rompu: "SLA rompu",
  echeance_proche: "Échéance proche",
  quota_depasse: "Quota dépassé",
  sous_facturation: "Sous-facturation",
};

export interface RisqueSignal { type: SignalType; count?: number; jours?: number; depassement?: number; quota?: number; ecart?: number; engage?: number; facture?: number; pct?: number }
export interface RisqueItem {
  id: string; fp: string | null; client: string; am: string; bu: string; statut: string;
  score: number; niveau: Niveau; signals: RisqueSignal[];
  slaRompus: number; joursAvantFin: number | null; quotaDepasse: number;
  sousFacturation: { engage: number; facture: number; ecart: number };
}
export interface RisqueSummary { items: RisqueItem[]; counts: Record<Niveau, number>; total: number; atRisk: number; asOf: string | null }

// Libellé court d'un signal (avec sa valeur) pour la pastille de synthèse.
export function signalText(s: RisqueSignal): string {
  const base = SIGNAL_LABEL[s.type] || s.type;
  if (s.type === "sla_rompu" && s.count) return `${base} (${s.count})`;
  if (s.type === "echeance_proche" && s.jours != null) return s.jours <= 0 ? `${base} (dépassée)` : `${base} (${s.jours} j)`;
  if (s.type === "quota_depasse" && s.depassement) return `${base} (+${s.depassement})`;
  return base;
}

export const label = (map: Record<string, string>, v?: string): string => (v ? map[v] || v : "—");
