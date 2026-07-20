// Risque des contrats de maintenance (Lot 5) — libellés FR + tons de badge, côté front. Miroir des
// CODES produits par functions/domain/mntRisque.js (matérialisés dans summaries/mnt_risque) ; seuls
// les libellés affichés vivent ici (02-REGLES.md). Palette de risque = ADR-008 (emerald/gold/clay/plum).
// Pur → testable sans React.

// « incomplet » = NON SCORÉ (données de pilotage insuffisantes) — distinct de « vert » (sain) : un contrat
// sans engagement/date de fin/montant ne doit pas paraître sain à tort (R6, miroir de mntRisque.js).
export type Niveau = "vert" | "ambre" | "rouge" | "critique" | "incomplet";
export type SignalType = "sla_rompu" | "echeance_proche" | "quota_depasse" | "sous_facturation" | "marge_faible";

export const NIVEAU_LABEL: Record<string, string> = {
  vert: "Vert", ambre: "Ambre", rouge: "Rouge", critique: "Critique", incomplet: "Non scoré",
};

// Ton de badge du niveau : mêmes teintes que la priorité de ticket (ADR-008/014) — un rouge veut dire
// « danger » partout. vert=emerald, ambre=gold, rouge=clay, critique=plum ; incomplet=neutre (donnée à compléter).
export function niveauTone(n?: string): "emerald" | "gold" | "clay" | "plum" | "neutral" {
  switch (n) {
    case "vert": return "emerald";
    case "ambre": return "gold";
    case "rouge": return "clay";
    case "critique": return "plum";
    case "incomplet": return "neutral";
    default: return "neutral";
  }
}

export const SIGNAL_LABEL: Record<string, string> = {
  sla_rompu: "SLA rompu",
  echeance_proche: "Échéance proche",
  quota_depasse: "Quota dépassé",
  sous_facturation: "Sous-facturation",
  marge_faible: "Marge faible",
};

export interface RisqueSignal { type: SignalType; count?: number; jours?: number; depassement?: number; quota?: number; ecart?: number; engage?: number; facture?: number; pct?: number; severite?: "negative" | "faible" }
export interface RisqueItem {
  id: string; fp: string | null; client: string; am: string; bu: string; statut: string;
  score: number; niveau: Niveau; signals: RisqueSignal[];
  slaRompus: number; joursAvantFin: number | null; quotaDepasse: number;
  margeNiveau?: "negative" | "faible" | null; // palier de marge (jamais le montant — confidentiel, ADR-034)
  sousFacturation: { engage: number; facture: number; ecart: number };
}
export interface RisqueSummary { items: RisqueItem[]; counts: Record<Niveau, number>; total: number; atRisk: number; asOf: string | null }

// Libellé court d'un signal (avec sa valeur) pour la pastille de synthèse.
export function signalText(s: RisqueSignal): string {
  const base = SIGNAL_LABEL[s.type] || s.type;
  if (s.type === "sla_rompu" && s.count) return `${base} (${s.count})`;
  if (s.type === "echeance_proche" && s.jours != null) return s.jours <= 0 ? `${base} (dépassée)` : `${base} (${s.jours} j)`;
  if (s.type === "quota_depasse" && s.depassement) return `${base} (+${s.depassement})`;
  if (s.type === "marge_faible") return s.severite === "negative" ? "Marge négative" : "Marge faible";
  return base;
}

export const label = (map: Record<string, string>, v?: string): string => (v ? map[v] || v : "—");
