import { describe, it, expect } from "vitest";
import { computeMntDashboard, slaAgenda, mntCompliance, mntRenouvellements, mntTypeStats, ECHEANCE_PROCHE_JOURS } from "./mntDashboard";

const asOf = "2026-07-15";

describe("computeMntDashboard", () => {
  it("ARR : normalise le montant PAR ÉCHÉANCE en base annuelle, sur les seuls contrats actifs", () => {
    const d = computeMntDashboard(
      [
        { statut: "actif", echeanceType: "mensuel", montantEngage: 1_000_000 },    // × 12 = 12 000 000
        { statut: "actif", echeanceType: "trimestriel", montantEngage: 500_000 },  // × 4  =  2 000 000
        { statut: "actif", echeanceType: "annuel", montantEngage: 3_000_000 },     // × 1  =  3 000 000
        { statut: "brouillon", echeanceType: "annuel", montantEngage: 9_000_000 }, // exclu (non actif)
        { statut: "resilie", echeanceType: "annuel", montantEngage: 9_000_000 },   // exclu
      ],
      [],
      asOf,
    );
    expect(d.contratsTotal).toBe(5);
    expect(d.contratsActifs).toBe(3);
    // 12M + 2M + 3M = 17M (avant le fix : 1M+0,5M+3M = 4,5M, un total sans signification car périodicités mélangées).
    expect(d.arrActifs).toBe(17_000_000);
    expect(d.parStatut).toEqual({ actif: 3, brouillon: 1, resilie: 1 });
  });

  it("repère les échéances proches (0..60 j) des contrats actifs, triées, exclut passées et lointaines", () => {
    const d = computeMntDashboard(
      [
        { id: "a", client: "X", statut: "actif", dateFin: "2026-08-01" }, // +17 j → proche
        { id: "b", client: "Y", statut: "actif", dateFin: "2026-07-20" }, // +5 j → proche
        { id: "c", client: "Z", statut: "actif", dateFin: "2026-07-10" }, // passée → exclue
        { id: "d", client: "W", statut: "actif", dateFin: "2027-01-01" }, // lointaine → exclue
        { id: "e", client: "V", statut: "suspendu", dateFin: "2026-07-16" }, // non actif → exclu
      ],
      [],
      asOf,
    );
    expect(d.echeancesProches.map((e) => e.id)).toEqual(["b", "a"]);
    expect(d.echeancesProches[0].jours).toBe(5);
    expect(ECHEANCE_PROCHE_JOURS).toBe(60);
  });

  it("ne compte comme ouverts que les tickets ouvert|en_cours et les ventile par priorité", () => {
    const d = computeMntDashboard(
      [],
      [
        { statut: "ouvert", priorite: "haute" },
        { statut: "en_cours", priorite: "haute" },
        { statut: "ouvert", priorite: "basse" },
        { statut: "resolu", priorite: "critique" }, // clos-like → exclu
        { statut: "clos", priorite: "critique" },   // exclu
      ],
      asOf,
    );
    expect(d.ticketsTotal).toBe(5);
    expect(d.ticketsOuverts).toBe(3);
    expect(d.parPriorite).toEqual({ haute: 2, basse: 1 });
  });
});

describe("slaAgenda — calendrier SLA des tickets ouverts", () => {
  const H = 3600000;
  const c1 = { id: "C1", engagements: [
    { type: "prise_en_compte", couverture: "h24", seuilHeures: 4 },
    { type: "resolution", couverture: "h24", seuilHeures: 24 },
  ] };

  it("liste les SLA en attente d'un ticket ouvert, rompu d'abord", () => {
    const now = 5 * H; // prise en compte (dûe à 4h) dépassée, résolution (dûe à 24h) en cours
    const tickets = [{ id: "T1", contratId: "C1", client: "ACME", titre: "Panne", priorite: "haute", statut: "ouvert", ouvertMs: 0, priseEnCompteMs: null, resoluMs: null }];
    const a = slaAgenda(tickets, [c1], now);
    expect(a.map((x) => x.slaType)).toEqual(["prise_en_compte", "resolution"]);
    expect(a[0].state).toBe("rompu");
    expect(a[0].remainingMs).toBe(-1 * H); // 4h - 5h
    expect(a[1].state).toBe("en_cours");
    expect(a[1].remainingMs).toBe(19 * H);
  });

  it("un ticket pris en charge n'a plus de SLA de prise en compte en attente", () => {
    const tickets = [{ id: "T1", contratId: "C1", statut: "en_cours", ouvertMs: 0, priseEnCompteMs: 2 * H, resoluMs: null }];
    expect(slaAgenda(tickets, [c1], 5 * H).map((x) => x.slaType)).toEqual(["resolution"]);
  });

  it("un ticket résolu/clos est exclu du calendrier", () => {
    const tickets = [{ id: "T1", contratId: "C1", statut: "resolu", ouvertMs: 0, priseEnCompteMs: 1 * H, resoluMs: 3 * H }];
    expect(slaAgenda(tickets, [c1], 100 * H)).toEqual([]);
  });

  it("sans engagement du type, aucune échéance n'est inventée", () => {
    const c2 = { id: "C2", engagements: [{ type: "resolution", couverture: "h24", seuilHeures: 24 }] };
    const tickets = [{ id: "T2", contratId: "C2", statut: "ouvert", ouvertMs: 0, priseEnCompteMs: null, resoluMs: null }];
    expect(slaAgenda(tickets, [c2], 5 * H).map((x) => x.slaType)).toEqual(["resolution"]);
  });
});

describe("mntCompliance — conformité STRUCTURELLE des contrats actifs", () => {
  const base = { id: "C", client: "ACME", statut: "actif", montantEngage: 1_000_000, dateFin: "2027-01-01", engagements: [{ type: "resolution" }] };
  it("ne juge que les contrats actifs ; un contrat complet est conforme", () => {
    const r = mntCompliance([{ ...base }, { ...base, id: "B", statut: "brouillon", engagements: [] }]);
    expect(r.activeTotal).toBe(1);      // le brouillon est ignoré
    expect(r.conformes).toBe(1);
    expect(r.items).toEqual([]);
  });
  it("repère chaque manque STRUCTUREL : SLA, date de fin, montant nul", () => {
    const r = mntCompliance([
      { ...base, id: "A", engagements: [] },                       // sans_sla
      { ...base, id: "B", dateFin: null },                         // sans_echeance
      { ...base, id: "D", montantEngage: 0 },                      // montant_nul
    ]);
    expect(r.byIssue).toEqual({ sans_sla: 1, sans_echeance: 1, montant_nul: 1 });
    expect(r.conformes).toBe(0);
    expect(r.activeTotal).toBe(3);
  });
  it("une échéance DÉPASSÉE n'est PAS un défaut de conformité (relève des renouvellements)", () => {
    const r = mntCompliance([{ ...base, id: "E", dateFin: "2026-01-01" }]); // fin passée mais contrat complet
    expect(r.activeTotal).toBe(1);
    expect(r.conformes).toBe(1);
    expect(r.items).toEqual([]);
  });
  it("trie par nombre de manques décroissant", () => {
    const r = mntCompliance([
      { ...base, id: "A", engagements: [{ type: "resolution" }], dateFin: null },      // 1 manque
      { ...base, id: "B", engagements: [], dateFin: null, montantEngage: 0 },          // 3 manques
    ]);
    expect(r.items[0].id).toBe("B");
    expect(r.items[0].issues.length).toBe(3);
  });
});

describe("mntRenouvellements — contrats actifs à renouveler & échéances dépassées", () => {
  const c = (id: string, statut: string, dateFin: string | null) => ({ id, client: id, statut, dateFin });
  it("classe par urgence (dépassé, ≤30 critique, ≤60 proche, ≤90 à venir), dépassés en tête, exclut > horizon", () => {
    const r = mntRenouvellements([
      c("A", "actif", "2026-07-25"), // +10 j → critique
      c("B", "actif", "2026-08-29"), // +45 j → proche
      c("C", "actif", "2026-09-28"), // +75 j → a_venir
      c("D", "actif", "2026-11-12"), // +120 j → exclu
      c("E", "actif", "2026-06-01"), // -44 j → dépassé (en tête)
    ], asOf);
    expect(r.map((x) => [x.id, x.bucket])).toEqual([["E", "depasse"], ["A", "critique"], ["B", "proche"], ["C", "a_venir"]]);
  });
  it("exclut les non-actifs et les contrats sans date de fin", () => {
    const r = mntRenouvellements([
      c("A", "brouillon", "2026-07-25"), // non actif
      c("B", "actif", null),             // pas de date de fin
    ], asOf);
    expect(r).toEqual([]);
  });
});

describe("mntTypeStats — maintenance par type vs objectifs (ADR-025)", () => {
  const c = (id: string, objectifsMaintenance?: Record<string, number> | null) => ({ id, client: id, statut: "actif", objectifsMaintenance: objectifsMaintenance ?? null });
  it("compte tickets ET interventions SÉPARÉMENT par type et par contrat + total agrégé", () => {
    const r = mntTypeStats(
      [c("A"), c("B")],
      [{ contratId: "A", typeMaintenance: "corrective" }, { contratId: "A", typeMaintenance: "corrective" }, { contratId: "B", typeMaintenance: "predictive" }],
      [{ contratId: "A", typeMaintenance: "corrective" }, { contratId: "A", typeMaintenance: "evolutive" }],
    );
    expect(r.totalTickets).toEqual({ predictive: 1, corrective: 2, evolutive: 0, veille: 0 });
    expect(r.totalInterventions).toEqual({ predictive: 0, corrective: 1, evolutive: 1, veille: 0 });
    const a = r.parContrat.find((p) => p.contratId === "A")!;
    expect(a.tickets.corrective).toBe(2);
    expect(a.interventions.corrective).toBe(1);
    expect(a.interventions.evolutive).toBe(1);
  });
  it("ignore les items non classés (typeMaintenance absent ou hors énumération)", () => {
    const r = mntTypeStats([c("A")], [{ contratId: "A" }, { contratId: "A", typeMaintenance: null }, { contratId: "A", typeMaintenance: "curative" }, { contratId: "A", typeMaintenance: "veille" }], []);
    expect(r.totalTickets).toEqual({ predictive: 0, corrective: 0, evolutive: 0, veille: 1 });
  });
  it("remonte les objectifs embarqués du contrat et n'émet pas de ligne vide (ni activité, ni objectif)", () => {
    const r = mntTypeStats(
      [c("A", { corrective: 5 }), c("B")], // B : ni objectif ni activité → exclu
      [{ contratId: "A", typeMaintenance: "corrective" }],
      [],
    );
    expect(r.parContrat.map((p) => p.contratId)).toEqual(["A"]);
    expect(r.parContrat[0].objectifs).toEqual({ corrective: 5 });
  });
  it("émet une ligne pour un contrat AVEC objectif mais SANS activité (suivi de la cible)", () => {
    const r = mntTypeStats([c("A", { predictive: 2 })], [], []);
    expect(r.parContrat).toHaveLength(1);
    expect(r.parContrat[0].tickets).toEqual({ predictive: 0, corrective: 0, evolutive: 0, veille: 0 });
  });
});
