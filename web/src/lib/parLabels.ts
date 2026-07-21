// Libellés FR + tons de badge du module Partenariats (par_), côté front. Miroir des CODES produits par
// functions/domain/par*.js (statuts, paliers) — seuls les libellés affichés vivent ici (02-REGLES.md).
// Palette de tons alignée sur le reste de l'ERP (emerald/gold/clay/plum/neutral) : un vert veut dire
// « conforme » partout. Pur → testable sans React.

export type Tone = "emerald" | "gold" | "clay" | "plum" | "neutral" | "steel";

// Statut de conformité d'un partenariat (parQuota.partnershipQuotaStatus).
export const PARTNERSHIP_STATUS_LABEL: Record<string, string> = {
  on_track: "Conforme", at_risk: "À risque", non_compliant: "Non conforme", non_evalue: "Non évalué",
};
export function partnershipTone(s?: string): Tone {
  switch (s) { case "on_track": return "emerald"; case "at_risk": return "gold"; case "non_compliant": return "clay"; default: return "neutral"; }
}

// Statut de validité d'une certification (parCertification.computeCertStatus).
export const CERT_STATUS_LABEL: Record<string, string> = {
  active: "Valide", expiring_soon: "Bientôt expirée", expired: "Expirée",
};
export function certStatusTone(s?: string): Tone {
  switch (s) { case "active": return "emerald"; case "expiring_soon": return "gold"; case "expired": return "clay"; default: return "neutral"; }
}

// Palier d'alerte du cycle de vie (parAlert.alertBucket) : libellé + ton (urgence croissante).
export const ALERT_BUCKET_LABEL: Record<string, string> = {
  expired: "Expirée", j7: "≤ 7 j", j30: "≤ 30 j", j60: "≤ 60 j", j90: "≤ 90 j",
};
export function alertBucketTone(b?: string): Tone {
  switch (b) { case "expired": return "plum"; case "j7": return "clay"; case "j30": return "gold"; default: return "steel"; }
}

// Statut d'une assignation (parAssignment.ASSIGNMENT_STATUSES + effectiveStatus).
export const ASSIGNMENT_STATUS_LABEL: Record<string, string> = {
  a_planifier: "À planifier", planifie: "Planifiée", en_formation: "En formation", en_retard: "En retard", obtenu: "Obtenue",
};
export function assignmentTone(s?: string): Tone {
  switch (s) { case "obtenu": return "emerald"; case "en_formation": return "steel"; case "en_retard": return "clay"; case "planifie": return "gold"; default: return "neutral"; }
}

// Palier d'une relance d'assignation (parAssignment.assignmentWatch.bucket = "retard" | "j<offset>").
export function relanceBucketLabel(b?: string): string {
  if (b === "retard") return "En retard";
  const m = /^j(\d+)$/.exec(b || ""); return m ? `≤ ${m[1]} j` : (b || "—");
}
export function relanceBucketTone(b?: string): Tone {
  if (b === "retard") return "clay"; const m = /^j(\d+)$/.exec(b || ""); return m && Number(m[1]) <= 7 ? "gold" : "steel";
}

// Statut de VALIDATION du plan d'affaires (miroir fichier direction : Validé / Presque validé / Non validé).
export const VALIDATION_STATUS_LABEL: Record<string, string> = {
  valide: "Validé", presque_valide: "Presque validé", non_valide: "Non validé",
};
export function validationTone(s?: string): Tone {
  switch (s) { case "valide": return "emerald"; case "presque_valide": return "gold"; case "non_valide": return "clay"; default: return "neutral"; }
}
// Libellés des quatre axes du plan d'affaires (objectif BP vs réalisé YTD).
export const BP_AXIS_LABEL: Record<string, string> = {
  pipeline: "Pipeline", booking: "Booking", cert: "Certifications", growth: "Croissance",
};

// Avantages programme (PAR-L3) — miroir des statuts de functions/domain/parBenefits.js.
export const DEALREG_STATUS_LABEL: Record<string, string> = {
  soumis: "Soumise", approuve: "Approuvée", rejete: "Rejetée", expire: "Expirée",
};
export function dealregTone(s?: string): Tone {
  switch (s) { case "approuve": return "emerald"; case "soumis": return "gold"; case "rejete": return "clay"; case "expire": return "plum"; default: return "neutral"; }
}
export const MDF_STATUS_LABEL: Record<string, string> = {
  accorde: "Accordé", consomme: "Consommé", rembourse: "Remboursé", expire: "Expiré",
};
export function mdfTone(s?: string): Tone {
  switch (s) { case "accorde": return "emerald"; case "consomme": return "steel"; case "rembourse": return "plum"; case "expire": return "clay"; default: return "neutral"; }
}
export const REBATE_STATUS_LABEL: Record<string, string> = {
  attendu: "Attendu", reclame: "Réclamé", recu: "Reçu", abandonne: "Abandonné",
};
export function rebateTone(s?: string): Tone {
  switch (s) { case "recu": return "emerald"; case "reclame": return "gold"; case "attendu": return "steel"; case "abandonne": return "neutral"; default: return "neutral"; }
}

export const label = (map: Record<string, string>, v?: string): string => (v ? map[v] || v : "—");
