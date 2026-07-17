// Suggestions de contrats de maintenance (Lot 7) — repère, dans le carnet de commandes, les affaires
// qui RESSEMBLENT à de la maintenance/récurrent et n'ont PAS encore de contrat mnt_. PUR (aucune I/O) :
// le module fournit les commandes (useCommandesRows), les contrats existants (mnt_contrats) et la
// canonicalisation fpKey. Heuristique par mots-clés sur la désignation (affaire) + le client — jamais
// une création automatique : chaque suggestion ouvre la fiche contrat PRÉ-REMPLIE, l'humain valide.

import type { MntContrat } from "../types";
import { ECHEANCES } from "./mntContrat";
import { plausibleYear } from "./ids";

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

type OrderLike = { fp?: string; client?: string; bu?: string; am?: string; affaire?: string | null; cas?: number; dateCommande?: string | null; yearPo?: number };
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

// Candidat envoyé à l'IA (affaire du carnet SANS contrat). L'IA juge le FOND — on ne pré-filtre donc PAS
// sur les mots-clés (sinon on lui cache justement les affaires récurrentes SANS mot-clé évident, tout
// l'intérêt de « doper à l'IA »). On borne le lot en priorisant les signaux mots-clés puis le montant.
export interface MntCandidate { fp: string; client: string; bu: string; am: string; affaire: string; cas: number }

/**
 * Construit le lot de candidats à soumettre à l'IA : TOUTES les affaires du carnet sans contrat, bornées.
 * Priorité d'inclusion : affaires à signaux mots-clés d'abord, puis le plus gros montant.
 * @param cap borne le lot (défaut 60 — aligné sur le plafond serveur)
 */
export function mntCandidatePool(
  orders: OrderLike[],
  contrats: ContratLike[],
  normalizeFp: (v?: string | null) => string | null,
  cap = 60,
): MntCandidate[] {
  const have = new Set((contrats || []).map((c) => normalizeFp(c.fp)).filter((x): x is string => !!x));
  const seen = new Set<string>();
  const out: (MntCandidate & { _kw: number })[] = [];
  for (const o of orders || []) {
    const fp = normalizeFp(o.fp);
    if (!fp || have.has(fp) || seen.has(fp)) continue;
    seen.add(fp);
    const text = `${norm(o.affaire)} ${norm(o.client)}`;
    const kw = MNT_KEYWORDS.filter((k) => text.includes(k)).length;
    out.push({
      fp: o.fp || fp, client: o.client || "", bu: o.bu || "", am: o.am || "",
      affaire: o.affaire || "", cas: Number(o.cas) || 0, _kw: kw,
    });
  }
  out.sort((a, b) => b._kw - a._kw || b.cas - a.cas || a.client.localeCompare(b.client));
  return out.slice(0, cap).map(({ _kw, ...c }) => c);
}

// --- Brouillon de contrat pré-rempli depuis une commande (Lot 9 : création en masse depuis les suggestions) ---
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validIso = (s?: string | null): string | null => (s && ISO.test(s) ? s : null);

/** Ajoute `n` mois à une date ISO AAAA-MM-JJ (jour ramené au dernier jour du mois si dépassement). PUR. */
export function addMonths(iso: string, n: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1 + n;
  let d = Number(m[3]);
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(); // 0 du mois suivant = dernier jour du mois courant
  if (d > last) d = last;
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Brouillon de contrat pré-rempli depuis une commande, prêt à écrire via `upsertMntContrat`. PUR.
 * Règle métier (ADR-020) : `dateDebut` = date de la commande (repli AAAA-01-01 sur le millésime PO
 * plausible, sinon aujourd'hui) ; `dateFin` = dateDebut + 12 mois ; `montantEngage` = CAS de la commande ;
 * `statut` = brouillon (jamais actif d'office) ; `echeanceType` = échéance suggérée ou « annuel ».
 * @param o        commande source (fp, client, bu, am, cas, dateCommande, yearPo)
 * @param todayIso date du jour ISO (injectée → fonction pure) utilisée en dernier repli
 * @param echeance périodicité suggérée (IA) — retenue seulement si dans l'énumération
 */
export function buildContratDraft(
  o: OrderLike,
  todayIso: string,
  echeance?: string | null,
): MntContrat {
  // Autorité unique de plausibilité des millésimes (ids) — pas de ré-implémentation de la fenêtre (audit 2026-07).
  const yr = plausibleYear(o.yearPo); // année plausible ([2015 .. année+3]) ou 0
  const dateDebut = validIso(o.dateCommande) || (yr > 0 ? `${yr}-01-01` : todayIso);
  const dateFin = addMonths(dateDebut, 12) || dateDebut;
  const ech = echeance && (ECHEANCES as readonly string[]).includes(echeance) ? echeance : "annuel";
  return {
    fp: o.fp || "", client: o.client || "", bu: o.bu || "", am: o.am || "",
    statut: "brouillon", echeanceType: ech, dateDebut, dateFin,
    montantEngage: Math.max(0, Math.round(Number(o.cas) || 0)), deviseEngage: "XOF", engagements: [],
  };
}
