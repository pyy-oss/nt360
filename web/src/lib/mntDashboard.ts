// Tableau de bord du module Contrats de maintenance (Lot 6) — agrégats PURS dérivés des collections
// DÉJÀ chargées par le module (mnt_contrats, mnt_tickets) + le summary de risque. Aucune I/O, aucun
// nouvel appel serveur : le cockpit consolide ce que le module lit déjà. Testable sans React.
// Convention ERP : dates ISO AAAA-MM-JJ, montants FCFA entiers, statuts en code applicatif.

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

type ContratLike = { id?: string; fp?: string | null; client?: string; statut?: string; montantEngage?: number; dateFin?: string | null };
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
