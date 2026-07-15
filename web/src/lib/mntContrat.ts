// Contrats de maintenance (mnt_) — libellés FR + tons de statut, côté front. Les VALEURS (code
// applicatif) sont le miroir de functions/domain/mntContrat.js ; seuls les LIBELLÉS affichés vivent
// ici (métier en français, technique en code — 02-REGLES.md). Pur → testable.
export const STATUTS = ["brouillon", "actif", "suspendu", "echu", "resilie"] as const;
export const ECHEANCES = ["mensuel", "trimestriel", "annuel"] as const;
export const SLA_TYPES = ["prise_en_compte", "resolution"] as const;
export const COUVERTURES = ["ouvre_lun_ven", "h24"] as const;

export const STATUT_LABEL: Record<string, string> = {
  brouillon: "Brouillon", actif: "Actif", suspendu: "Suspendu", echu: "Échu", resilie: "Résilié",
};
export const ECHEANCE_LABEL: Record<string, string> = {
  mensuel: "Mensuel", trimestriel: "Trimestriel", annuel: "Annuel",
};
export const SLA_TYPE_LABEL: Record<string, string> = {
  prise_en_compte: "Prise en compte", resolution: "Résolution",
};
export const COUVERTURE_LABEL: Record<string, string> = {
  ouvre_lun_ven: "Jours ouvrés (Lun–Ven)", h24: "24/7",
};

// Ton de badge du statut (palette existante : emerald=actif, steel=brouillon, gold=attention, clay=fin).
export function statutTone(statut?: string): "emerald" | "steel" | "gold" | "clay" | "neutral" {
  switch (statut) {
    case "actif": return "emerald";
    case "brouillon": return "steel";
    case "suspendu": return "gold";
    case "echu": return "gold";
    case "resilie": return "clay";
    default: return "neutral";
  }
}

export const label = (map: Record<string, string>, v?: string): string => (v ? map[v] || v : "—");
