// Suggestions de contrats de maintenance (Lot 7) — repère, dans le carnet de commandes, les affaires
// qui RESSEMBLENT à de la maintenance/récurrent et n'ont PAS encore de contrat mnt_. PUR (aucune I/O) :
// le module fournit les commandes (useCommandesRows), les contrats existants (mnt_contrats) et la
// canonicalisation fpKey. Heuristique par mots-clés sur la désignation (affaire) + le client — jamais
// une création automatique : chaque suggestion ouvre la fiche contrat PRÉ-REMPLIE, l'humain valide.

// Mots-clés (normalisés sans accents) qui trahissent une prestation récurrente / de maintenance.
export const MNT_KEYWORDS = [
  "maintenance", "tma", "support", "infogerance", "hebergement", "licence", "abonnement",
  "sla", "garantie", "tierce", "exploitation", "supervision", "monitoring", "contrat",
  "assistance", "helpdesk", "recurrent", "renouvellement", "hotline", "astreinte",
];

// Normalisation robuste : dépouille les diacritiques, réduit les espaces, casse — comme ailleurs dans l'ERP.
const norm = (s: unknown): string =>
  String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export interface MntSuggestion {
  fp: string; client: string; bu: string; am: string; affaire: string; cas: number;
  score: number; reasons: string[];
}

type OrderLike = { fp?: string; client?: string; bu?: string; am?: string; affaire?: string | null; cas?: number };
type ContratLike = { fp?: string };

/**
 * Propose des contrats à créer à partir des commandes. PUR.
 * @param orders      carnet de commandes (Order)
 * @param contrats    contrats mnt_ existants (pour ne pas re-suggérer une affaire déjà sous contrat)
 * @param normalizeFp canonicalisation d'un N° FP (fpKey) — rapprochement commande ↔ contrat
 * @param cap         nombre max de suggestions renvoyées (défaut 30)
 */
export function suggestMntContrats(
  orders: OrderLike[],
  contrats: ContratLike[],
  normalizeFp: (v?: string | null) => string | null,
  cap = 30,
): MntSuggestion[] {
  const have = new Set((contrats || []).map((c) => normalizeFp(c.fp)).filter((x): x is string => !!x));
  const seen = new Set<string>();
  const out: MntSuggestion[] = [];
  for (const o of orders || []) {
    const fp = normalizeFp(o.fp);
    if (!fp || have.has(fp) || seen.has(fp)) continue; // déjà sous contrat, ou doublon de FP dans le carnet
    const text = `${norm(o.affaire)} ${norm(o.client)}`;
    const reasons = MNT_KEYWORDS.filter((k) => text.includes(k));
    if (!reasons.length) continue;
    seen.add(fp);
    out.push({
      fp: o.fp || fp, client: o.client || "", bu: o.bu || "", am: o.am || "",
      affaire: o.affaire || "", cas: Number(o.cas) || 0, score: reasons.length, reasons,
    });
  }
  // Plus de signaux d'abord, puis le plus gros montant (une grosse affaire récurrente prime).
  out.sort((a, b) => b.score - a.score || b.cas - a.cas || a.client.localeCompare(b.client));
  return out.slice(0, cap);
}
