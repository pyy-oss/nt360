// Tableau de bord du module Contrats de maintenance (Lot 6) — agrégats PURS dérivés des collections
// DÉJÀ chargées par le module (mnt_contrats, mnt_tickets) + le summary de risque. Aucune I/O, aucun
// nouvel appel serveur : le cockpit consolide ce que le module lit déjà. Testable sans React.
// Convention ERP : dates ISO AAAA-MM-JJ, montants FCFA entiers, statuts en code applicatif.

import { slaState } from "./mntSla";

export const ECHEANCE_PROCHE_JOURS = 60; // aligné sur le signal « échéance proche » du moteur de risque
const DAY = 86400000;

// Parse une date ISO AAAA-MM-JJ en millis UTC (null si absente/invalide) — même convention que l'ERP.
function parseIso(s?: string | null): number | null {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

export interface MntEcheanceProche { id: string; fp: string | null; client: string; dateFin: string; jours: number }
export interface MntDashboard {
  contratsTotal: number;
  contratsActifs: number;
  montantEngageActifs: number;      // Σ montant engagé des contrats ACTIFS (FCFA entier)
  parStatut: Record<string, number>;
  ticketsTotal: number;
  ticketsOuverts: number;           // statut ouvert | en_cours
  parPriorite: Record<string, number>; // tickets OUVERTS par priorité
  echeancesProches: MntEcheanceProche[]; // contrats actifs dont la fin tombe dans [0 .. 60] jours
}

type ContratLike = { id?: string; fp?: string | null; client?: string; statut?: string; montantEngage?: number; dateFin?: string | null; engagements?: unknown[] };
type TicketLike = { statut?: string; priorite?: string };

/** Agrège les contrats + tickets à une date donnée (asOfIso, AAAA-MM-JJ). PUR. */
export function computeMntDashboard(contrats: ContratLike[], tickets: TicketLike[], asOfIso: string): MntDashboard {
  const parStatut: Record<string, number> = {};
  const echeancesProches: MntEcheanceProche[] = [];
  let contratsActifs = 0, montantEngageActifs = 0;
  const asOf = parseIso(asOfIso);
  for (const c of contrats || []) {
    const st = c.statut || "brouillon";
    parStatut[st] = (parStatut[st] || 0) + 1;
    if (st !== "actif") continue;
    contratsActifs++;
    montantEngageActifs += Number(c.montantEngage) || 0;
    const fin = parseIso(c.dateFin);
    if (fin != null && asOf != null) {
      const jours = Math.round((fin - asOf) / DAY);
      if (jours >= 0 && jours <= ECHEANCE_PROCHE_JOURS) {
        echeancesProches.push({ id: c.id || "", fp: c.fp ?? null, client: c.client || "", dateFin: c.dateFin as string, jours });
      }
    }
  }
  echeancesProches.sort((a, b) => a.jours - b.jours);

  const parPriorite: Record<string, number> = {};
  let ticketsOuverts = 0;
  for (const t of tickets || []) {
    const st = t.statut || "ouvert";
    if (st === "ouvert" || st === "en_cours") {
      ticketsOuverts++;
      const p = t.priorite || "moyenne";
      parPriorite[p] = (parPriorite[p] || 0) + 1;
    }
  }
  return {
    contratsTotal: (contrats || []).length,
    contratsActifs, montantEngageActifs, parStatut,
    ticketsTotal: (tickets || []).length,
    ticketsOuverts, parPriorite, echeancesProches,
  };
}

// --- Contrôle de complétude / conformité des contrats (Lot 3/7 « valeur ajoutée » — conformité) ---
// Vue front PURE : parmi les contrats ACTIFS (ceux en vigueur), repère les MANQUES de conformité qui
// rendent un contrat inexploitable ou hors-cadre — aucun engagement SLA, pas de date de fin, échéance déjà
// dépassée (contrat encore « actif » alors qu'il aurait dû être renouvelé/échu), montant d'engagement nul.
// Aucune I/O ni métrique persistée → pas de miroir back. On ne juge QUE les contrats actifs (les brouillons
// sont en cours de saisie, les échus/résiliés sont sortis). « conforme » = actif sans aucun manque.
export type MntComplianceIssue = "sans_sla" | "sans_echeance" | "echeance_depassee" | "montant_nul";
export interface MntComplianceItem { id: string; fp: string | null; client: string; issues: MntComplianceIssue[] }
export interface MntComplianceResult {
  items: MntComplianceItem[];                       // contrats actifs avec ≥ 1 manque, plus de manques d'abord
  byIssue: Record<MntComplianceIssue, number>;
  activeTotal: number;
  conformes: number;
}

/** Contrôle de conformité des contrats ACTIFS à la date asOfIso (AAAA-MM-JJ). PUR. */
export function mntCompliance(contrats: ContratLike[], asOfIso: string): MntComplianceResult {
  const asOf = parseIso(asOfIso);
  const items: MntComplianceItem[] = [];
  const byIssue: Record<MntComplianceIssue, number> = { sans_sla: 0, sans_echeance: 0, echeance_depassee: 0, montant_nul: 0 };
  let activeTotal = 0;
  for (const c of contrats || []) {
    if ((c.statut || "brouillon") !== "actif") continue;
    activeTotal++;
    const issues: MntComplianceIssue[] = [];
    if (!(c.engagements && c.engagements.length)) issues.push("sans_sla");
    const fin = parseIso(c.dateFin);
    if (!c.dateFin) issues.push("sans_echeance");
    else if (fin != null && asOf != null && fin < asOf) issues.push("echeance_depassee");
    if (!(Number(c.montantEngage) > 0)) issues.push("montant_nul");
    if (issues.length) {
      for (const k of issues) byIssue[k]++;
      items.push({ id: c.id || "", fp: c.fp ?? null, client: c.client || "", issues });
    }
  }
  items.sort((a, b) => b.issues.length - a.issues.length || a.client.localeCompare(b.client));
  return { items, byIssue, activeTotal, conformes: activeTotal - items.length };
}

// --- Calendrier SLA des tickets (Lot 2/7 « valeur ajoutée » — opérationnel) ---
// Vue front PURE : pour chaque ticket OUVERT, ses échéances SLA ENCORE EN ATTENTE (prise en compte tant
// qu'il n'est pas pris en charge ; résolution tant qu'il n'est pas résolu), avec l'état live (rompu / en
// cours) calculé par le MÊME moteur slaState que la fiche (horloge jours ouvrés ou h24, ADR-002). Aucune
// I/O ni métrique persistée → pas de miroir back (comme le tableau de bord). Les horodatages sont fournis
// EN MILLIS (le module convertit les Timestamp via tsMillis avant l'appel) → fonction trivialement testable.
export interface SlaAgendaItem {
  ticketId: string; contratId: string; client: string; titre: string; priorite: string;
  slaType: "prise_en_compte" | "resolution"; dueMs: number; state: "rompu" | "en_cours"; remainingMs: number;
}
type TicketMs = {
  id?: string; contratId?: string; client?: string; titre?: string; priorite?: string; statut?: string;
  ouvertMs?: number | null; priseEnCompteMs?: number | null; resoluMs?: number | null;
};
type Eng = { type?: string; couverture?: string; seuilHeures?: number };
type ContratEng = { id?: string; engagements?: Eng[] };

/** Échéances SLA en attente des tickets ouverts, triées « rompu d'abord » puis par échéance la plus proche. PUR. */
export function slaAgenda(tickets: TicketMs[], contrats: ContratEng[], nowMs: number): SlaAgendaItem[] {
  // 1ᵉʳ engagement de chaque type par contrat (la fiche impose au plus un par type utile ici).
  const engByContrat = new Map<string, { prise_en_compte?: Eng; resolution?: Eng }>();
  for (const c of contrats || []) {
    if (!c.id) continue;
    const slot: { prise_en_compte?: Eng; resolution?: Eng } = {};
    for (const e of c.engagements || []) {
      if (e.type === "prise_en_compte" && !slot.prise_en_compte) slot.prise_en_compte = e;
      else if (e.type === "resolution" && !slot.resolution) slot.resolution = e;
    }
    engByContrat.set(c.id, slot);
  }
  const out: SlaAgendaItem[] = [];
  for (const t of tickets || []) {
    const st = t.statut || "ouvert";
    if (st !== "ouvert" && st !== "en_cours") continue; // seuls les tickets OUVERTS
    if (t.ouvertMs == null) continue;
    const engs = engByContrat.get(t.contratId || "") || {};
    const pending: { slaType: SlaAgendaItem["slaType"]; eng: any }[] = [];
    if (t.priseEnCompteMs == null && engs.prise_en_compte) pending.push({ slaType: "prise_en_compte", eng: engs.prise_en_compte });
    if (t.resoluMs == null && engs.resolution) pending.push({ slaType: "resolution", eng: engs.resolution });
    for (const p of pending) {
      const s = slaState(p.eng, t.ouvertMs, null, nowMs); // markMs=null → SLA encore en cours (état vivant)
      out.push({
        ticketId: t.id || "", contratId: t.contratId || "", client: t.client || "", titre: t.titre || "",
        priorite: t.priorite || "moyenne", slaType: p.slaType, dueMs: s.dueMs,
        state: s.state === "rompu" ? "rompu" : "en_cours", remainingMs: s.dueMs - nowMs,
      });
    }
  }
  // Rompus d'abord (les plus en retard en tête), puis les échéances les plus proches.
  out.sort((a, b) => {
    if (a.state !== b.state) return a.state === "rompu" ? -1 : 1;
    return a.dueMs - b.dueMs;
  });
  return out;
}
