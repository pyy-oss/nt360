import { describe, it, expect } from "vitest";
import { computeMntDashboard, recurringRevenue, slaAgenda, engagementsForTicket, mntCompliance, mntRenouvellements, mntTypeStats, ECHEANCE_PROCHE_JOURS } from "./mntDashboard";

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

  it("repère les échéances proches (0..90 j, ADR-041) des contrats actifs, triées, exclut passées et lointaines", () => {
    const d = computeMntDashboard(
      [
        { id: "a", client: "X", statut: "actif", dateFin: "2026-08-01", echeanceType: "mensuel", montantEngage: 1_000_000 }, // +17 j → proche, ARR 12M
        { id: "b", client: "Y", statut: "actif", dateFin: "2026-07-20" }, // +5 j → proche
        { id: "f", client: "U", statut: "actif", dateFin: "2026-10-01" }, // +78 j → proche (dans la fenêtre 90 j, était HORS à 60 j)
        { id: "c", client: "Z", statut: "actif", dateFin: "2026-07-10" }, // passée → exclue
        { id: "d", client: "W", statut: "actif", dateFin: "2027-01-01" }, // +170 j → exclue (> 90)
        { id: "e", client: "V", statut: "suspendu", dateFin: "2026-07-16" }, // non actif → exclu
      ],
      [],
      asOf,
    );
    expect(d.echeancesProches.map((e) => e.id)).toEqual(["b", "a", "f"]); // f (78 j) inclus depuis ADR-041
    expect(d.echeancesProches[0].jours).toBe(5);
    // `arr` = enjeu annualisé PAR échéance (même annualise() que le KPI ARR) ; montant absent → 0.
    expect(d.echeancesProches.find((e) => e.id === "a")?.arr).toBe(12_000_000);
    expect(d.echeancesProches.find((e) => e.id === "b")?.arr).toBe(0);
    expect(ECHEANCE_PROCHE_JOURS).toBe(90);
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

describe("recurringRevenue — revenu récurrent consolidé (MRR/ARR, DO Lot 4)", () => {
  it("consolide l'ARR (= annualise) des contrats ACTIFS, MRR = ARR/12, ventilé par BU/client/périodicité", () => {
    const r = recurringRevenue([
      { statut: "actif", bu: "ICT", client: "ACME", echeanceType: "mensuel", montantEngage: 1_000_000 },    // ARR 12M
      { statut: "actif", bu: "ICT", client: "BETA", echeanceType: "annuel", montantEngage: 3_000_000 },      // ARR 3M
      { statut: "actif", bu: "CLOUD", client: "ACME", echeanceType: "trimestriel", montantEngage: 500_000 }, // ARR 2M
      { statut: "brouillon", bu: "ICT", client: "X", echeanceType: "annuel", montantEngage: 9_000_000 },     // exclu
      { statut: "resilie", bu: "ICT", client: "Y", echeanceType: "annuel", montantEngage: 9_000_000 },       // exclu
    ]);
    expect(r.contratsActifs).toBe(3);
    expect(r.totalArr).toBe(17_000_000);           // 12M + 3M + 2M — identique à arrActifs du tableau de bord
    expect(r.totalMrr).toBe(Math.round(17_000_000 / 12)); // 1 416 667
    // Par BU : ICT (12M+3M=15M) devant CLOUD (2M).
    expect(r.byBu.map((g) => [g.key, g.arr])).toEqual([["ICT", 15_000_000], ["CLOUD", 2_000_000]]);
    expect(r.byBu[0].contrats).toBe(2);
    // Par client : ACME (12M+2M=14M) devant BETA (3M).
    expect(r.byClient.map((g) => g.key)).toEqual(["ACME", "BETA"]);
    expect(r.byClient[0].arr).toBe(14_000_000);
    // Par périodicité : mensuel 12M, annuel 3M, trimestriel 2M.
    expect(r.byPeriodicite.map((g) => [g.key, g.arr])).toEqual([["mensuel", 12_000_000], ["annuel", 3_000_000], ["trimestriel", 2_000_000]]);
    expect(r.byBu[0].mrr).toBe(Math.round(15_000_000 / 12));
  });
  it("aucun contrat actif → tout à zéro, listes vides", () => {
    const r = recurringRevenue([{ statut: "brouillon", montantEngage: 1_000_000, echeanceType: "annuel" }]);
    expect(r.contratsActifs).toBe(0);
    expect(r.totalArr).toBe(0);
    expect(r.totalMrr).toBe(0);
    expect(r.byBu).toEqual([]);
  });

  // PARITÉ back↔front (Lot 5b, ADR-043) — la MÊME fixture que functions/test/mntRecurring.test.js
  // (RECURRING_FIXTURE / RECURRING_EXPECTED) doit donner les MÊMES totaux, sinon le snapshot MRR back
  // divergerait du MRR affiché front (invariant « même métrique = même nombre »). Si l'un des deux change,
  // ce test OU son jumeau back casse.
  it("parité back↔front : totaux identiques à recurringTotals (mntRecurring.js)", () => {
    const r = recurringRevenue([
      { statut: "actif", echeanceType: "mensuel", montantEngage: 100_000 },
      { statut: "actif", echeanceType: "trimestriel", montantEngage: 300_000 },
      { statut: "actif", echeanceType: "annuel", montantEngage: 2_400_000 },
      { statut: "brouillon", echeanceType: "mensuel", montantEngage: 999_000 },
      { statut: "echu", echeanceType: "annuel", montantEngage: 999_000 },
      { statut: "resilie", echeanceType: "mensuel", montantEngage: 999_000 },
    ]);
    // Identique à RECURRING_EXPECTED côté back.
    expect({ contratsActifs: r.contratsActifs, totalArr: r.totalArr, totalMrr: r.totalMrr })
      .toEqual({ contratsActifs: 3, totalArr: 4_800_000, totalMrr: 400_000 });
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

  it("opposabilité (ADR-P24) : le SLA du ticket suit engagementsSnapshot (figé), pas le contrat courant", () => {
    // Contrat courant : résolution 24 h. Ticket figé sous une résolution 4 h (engagementsSnapshot) →
    // à now=5 h, il est ROMPU sur le snapshot (4 h), alors que le contrat courant (24 h) ne le romprait pas.
    const tickets = [{ id: "T1", contratId: "C1", statut: "ouvert", ouvertMs: 0, priseEnCompteMs: null, resoluMs: null,
      engagementsSnapshot: [{ type: "resolution", couverture: "h24", seuilHeures: 4 }] }];
    const a = slaAgenda(tickets, [c1], 5 * H);
    const res = a.find((x) => x.slaType === "resolution")!;
    expect(res.state).toBe("rompu"); // jugé sur le snapshot 4 h
  });
});

describe("engagementsForTicket — repli opposable (ADR-P24)", () => {
  const contrat = { id: "C1", engagements: [{ type: "resolution", couverture: "h24", seuilHeures: 24 }] };
  it("retourne le snapshot du ticket quand présent", () => {
    const snap = [{ type: "prise_en_compte", couverture: "h24", seuilHeures: 2 }];
    expect(engagementsForTicket({ engagementsSnapshot: snap }, contrat)).toBe(snap);
  });
  it("repli sur les engagements courants du contrat quand le snapshot est absent (non-régression)", () => {
    expect(engagementsForTicket({}, contrat)).toBe(contrat.engagements);
    expect(engagementsForTicket({ engagementsSnapshot: null }, contrat)).toBe(contrat.engagements);
    expect(engagementsForTicket(null, null)).toEqual([]);
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
