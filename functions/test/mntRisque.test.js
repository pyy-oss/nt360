// Test du moteur de risque PUR (Lot 5). Vérifie les 4 signaux, le score, les paliers, et l'exclusion
// des contrats non vivants. Aucun I/O.
import { describe, it, expect } from "vitest";
const { mntRisque, RISK_STATUTS, ECHEANCE_PROCHE_JOURS } = require("../domain/mntRisque");

// Horloge fixe (déterminisme) : 2026-07-15, base UTC.
const ASOF = "2026-07-15";
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

describe("mntRisque — paliers & population", () => {
  it("contrat vivant COMPLET sans signal → Vert (score 0)", () => {
    const r = mntRisque({
      // complet : au moins un engagement (scorable) + date de fin lointaine (pas d'échéance) + AUCUNE facture
      // due (montant 0 → pas de sous-facturation) + aucun ticket → 0 signal → sain (« vert »), pas « incomplet ».
      contrats: [{ id: "c1", fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-06-01", dateFin: "2027-06-01", echeanceType: "mensuel", montantEngage: 0, engagements: [{ type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: 8, quota: null }] }],
      tickets: [], invoices: [], asOf: ASOF, nowMs: NOW,
    });
    expect(r.total).toBe(1);
    expect(r.items[0].niveau).toBe("vert");
    expect(r.items[0].score).toBe(0);
    expect(r.atRisk).toBe(0);
  });

  it("contrat INCOMPLET (ni engagement, ni date de fin, ni montant) → « incomplet » ≠ Vert (R6, audit)", () => {
    const r = mntRisque({
      contrats: [{ id: "c1", fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-06-01", echeanceType: "mensuel", montantEngage: 0, engagements: [] }],
      tickets: [], invoices: [], asOf: ASOF, nowMs: NOW,
    });
    expect(r.items[0].niveau).toBe("incomplet"); // pas « sain » par défaut
    expect(r.items[0].score).toBe(0);
    expect(r.counts.incomplet).toBe(1);
    expect(r.counts.vert).toBe(0);
    expect(r.atRisk).toBe(0); // une dette de saisie n'est pas un risque avéré
  });

  it("brouillon / échu / résilié : EXCLUS du scoring (terminal ou pas engagé)", () => {
    const base = { fp: "FP/2026/1", client: "A", dateDebut: "2026-06-01", echeanceType: "mensuel", montantEngage: 0, engagements: [] };
    const r = mntRisque({
      contrats: [
        { id: "c1", statut: "brouillon", ...base },
        { id: "c2", statut: "echu", ...base },
        { id: "c3", statut: "resilie", ...base },
        { id: "c4", statut: "suspendu", ...base },
      ],
      tickets: [], invoices: [], asOf: ASOF, nowMs: NOW,
    });
    expect(RISK_STATUTS.has("actif")).toBe(true);
    expect(r.total).toBe(1); // seul le suspendu est scoré
    expect(r.items[0].id).toBe("c4");
  });
});

describe("mntRisque — signal SLA rompu", () => {
  const contrat = { id: "c1", fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-06-01", echeanceType: "annuel", montantEngage: 0, engagements: [{ type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: 8, quota: null }] };

  it("ticket non résolu au-delà du seuil ouvré → rompu → signal + score", () => {
    // Ouvert lundi 2026-07-06 00:00 UTC, seuil 8 h, non résolu, now = mercredi → dépassé.
    const r = mntRisque({
      contrats: [contrat],
      tickets: [{ id: "t1", contratId: "c1", ouvertMs: day("2026-07-06"), priseEnCompteMs: null, resoluMs: null, dateJour: "2026-07-06" }],
      invoices: [], asOf: ASOF, nowMs: NOW,
    });
    expect(r.items[0].slaRompus).toBe(1);
    expect(r.items[0].signals.some((s) => s.type === "sla_rompu")).toBe(true);
    expect(r.items[0].score).toBeGreaterThan(0);
  });

  it("ticket résolu dans le seuil → aucun SLA rompu", () => {
    const r = mntRisque({
      contrats: [contrat],
      tickets: [{ id: "t1", contratId: "c1", ouvertMs: day("2026-07-06"), priseEnCompteMs: null, resoluMs: day("2026-07-06") + 2 * 3600000, dateJour: "2026-07-06" }],
      invoices: [], asOf: ASOF, nowMs: NOW,
    });
    expect(r.items[0].slaRompus).toBe(0);
  });

  it("opposabilité (ADR-P24) : le SLA est jugé sur engagementsSnapshot du ticket, pas sur le contrat COURANT", () => {
    // Contrat COURANT : résolution 8 h (serait rompu). Le ticket a été ouvert sous une version PLUS LARGE
    // (seuil 10000 h, figé dans engagementsSnapshot) → NON rompu : la version en vigueur à l'ouverture prime.
    const tOpen = day("2026-07-06");
    const rSnap = mntRisque({
      contrats: [contrat],
      tickets: [{ id: "t1", contratId: "c1", ouvertMs: tOpen, priseEnCompteMs: null, resoluMs: null, dateJour: "2026-07-06",
        engagementsSnapshot: [{ type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: 10000, quota: null }] }],
      invoices: [], asOf: ASOF, nowMs: NOW,
    });
    expect(rSnap.items[0].slaRompus).toBe(0); // jugé sur le snapshot (large), pas sur le contrat courant (8 h)
    // MÊME ticket SANS snapshot → repli sur le contrat courant (8 h) → rompu. Preuve de non-régression :
    // en l'absence de snapshot, la sortie est IDENTIQUE au comportement d'avant le versionnement.
    const rFallback = mntRisque({
      contrats: [contrat],
      tickets: [{ id: "t1", contratId: "c1", ouvertMs: tOpen, priseEnCompteMs: null, resoluMs: null, dateJour: "2026-07-06" }],
      invoices: [], asOf: ASOF, nowMs: NOW,
    });
    expect(rFallback.items[0].slaRompus).toBe(1);
  });

  it("prise en compte : ticket résolu en PREMIER CONTACT (sans en_cours) n'est PAS rompu à tort (audit BUG1)", () => {
    // Engagement « prise_en_compte » 4 h. Ticket ouvert→resolu directement (priseEnCompteMs null car jamais
    // passé en_cours), résolu en 1 h. La prise en compte a eu lieu AU PLUS TARD à la résolution (1 h < 4 h)
    // → respecté. Avant le correctif, markMs=null basculait en « rompu » (échéance ancienne dépassée).
    const cPec = { id: "c1", fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-06-01", echeanceType: "annuel", montantEngage: 0, engagements: [{ type: "prise_en_compte", couverture: "ouvre_lun_ven", seuilHeures: 4, quota: null }] };
    const r = mntRisque({
      contrats: [cPec],
      tickets: [{ id: "t1", contratId: "c1", ouvertMs: day("2026-07-06"), priseEnCompteMs: null, resoluMs: day("2026-07-06") + 3600000, dateJour: "2026-07-06" }],
      invoices: [], asOf: ASOF, nowMs: NOW,
    });
    expect(r.items[0].slaRompus).toBe(0);
  });
});

describe("mntRisque — échéance proche", () => {
  const mk = (dateFin) => ({ id: "c1", fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-01-01", dateFin, echeanceType: "annuel", montantEngage: 0, engagements: [] });
  it("dateFin à 30 j → signal echeance_proche", () => {
    const r = mntRisque({ contrats: [mk("2026-08-10")], tickets: [], invoices: [], asOf: ASOF, nowMs: NOW });
    expect(r.items[0].signals.some((s) => s.type === "echeance_proche")).toBe(true);
    expect(r.items[0].joursAvantFin).toBe(26);
  });
  it("dateFin à > 90 j → PAS de signal (jours renseigné informatif)", () => {
    const r = mntRisque({ contrats: [mk("2026-12-31")], tickets: [], invoices: [], asOf: ASOF, nowMs: NOW });
    expect(r.items[0].signals.some((s) => s.type === "echeance_proche")).toBe(false);
    expect(r.items[0].joursAvantFin).toBeGreaterThan(ECHEANCE_PROCHE_JOURS);
  });
  it("ADR-041 — seuil unifié à 90 j : dateFin à ~75 j déclenche désormais le signal (n'aurait rien signalé à 60 j)", () => {
    expect(ECHEANCE_PROCHE_JOURS).toBe(90);
    const r = mntRisque({ contrats: [mk("2026-09-28")], tickets: [], invoices: [], asOf: ASOF, nowMs: NOW }); // +75 j
    expect(r.items[0].joursAvantFin).toBe(75);
    expect(r.items[0].signals.some((s) => s.type === "echeance_proche")).toBe(true);
  });
  it("dateFin dépassée → signal + poids maximal (30)", () => {
    const r = mntRisque({ contrats: [mk("2026-07-01")], tickets: [], invoices: [], asOf: ASOF, nowMs: NOW });
    const s = r.items[0].signals.find((x) => x.type === "echeance_proche");
    expect(s).toBeTruthy();
    expect(r.items[0].joursAvantFin).toBeLessThan(0);
  });
});

describe("mntRisque — quota dépassé", () => {
  it("plus de tickets ce mois que le quota → signal", () => {
    const contrat = { id: "c1", fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-06-01", echeanceType: "annuel", montantEngage: 0, engagements: [{ type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: 100, quota: 2 }] };
    const tickets = ["2026-07-01", "2026-07-05", "2026-07-10"].map((d, i) => ({ id: `t${i}`, contratId: "c1", ouvertMs: day(d), priseEnCompteMs: null, resoluMs: day(d) + 3600000, dateJour: d }));
    const r = mntRisque({ contrats: [contrat], tickets, invoices: [], asOf: ASOF, nowMs: NOW });
    const s = r.items[0].signals.find((x) => x.type === "quota_depasse");
    expect(s).toBeTruthy();
    expect(s.depassement).toBe(1); // 3 ouverts - quota 2
  });
});

describe("mntRisque — échéancier : contrat non démarré (audit BUG3)", () => {
  it("dateDebut FUTURE sur contrat actif → 0 échéance due → PAS de sous-facturation", () => {
    const contrat = { id: "c1", fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-09-01", echeanceType: "mensuel", montantEngage: 100000, engagements: [] };
    const r = mntRisque({ contrats: [contrat], tickets: [], invoices: [], asOf: ASOF, nowMs: NOW });
    expect(r.items[0].signals.some((s) => s.type === "sous_facturation")).toBe(false);
    expect(r.items[0].sousFacturation.engage).toBe(0);
    expect(r.items[0].niveau).toBe("vert");
  });
});

describe("mntRisque — sous-facturation", () => {
  it("engagé > facturé → signal sous_facturation avec écart entier XOF", () => {
    // Mensuel 100 000 XOF/mois, début 2026-06-01, asOf 2026-07-15 → 2 échéances dues = 200 000 engagé.
    // Facturé réel = 50 000 → écart 150 000 (sous-facturation).
    const contrat = { id: "c1", fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-06-01", echeanceType: "mensuel", montantEngage: 100000, engagements: [] };
    const r = mntRisque({ contrats: [contrat], tickets: [], invoices: [{ fp: "FP/2026/0001", amountHt: 50000 }], asOf: ASOF, nowMs: NOW });
    const s = r.items[0].signals.find((x) => x.type === "sous_facturation");
    expect(s).toBeTruthy();
    expect(s.engage).toBe(200000);
    expect(s.facture).toBe(50000); // rapproché par fpKey malgré les zéros de tête
    expect(s.ecart).toBe(150000);
  });
});

describe("mntRisque — rentabilité (palier de marge, DO Lot 5)", () => {
  const mk = (id) => ({ id, fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-06-01", echeanceType: "annuel", montantEngage: 0, engagements: [] });
  it("palier « negative » → signal marge_faible(severite=negative) + score 30 (Rouge) + margeNiveau exposé", () => {
    const r = mntRisque({ contrats: [mk("c1")], tickets: [], invoices: [], asOf: ASOF, nowMs: NOW, margeByContrat: { c1: "negative" } });
    const s = r.items[0].signals.find((x) => x.type === "marge_faible");
    expect(s).toBeTruthy();
    expect(s.severite).toBe("negative");
    expect(r.items[0].margeNiveau).toBe("negative");
    expect(r.items[0].score).toBe(30);
    expect(r.items[0].niveau).toBe("rouge");
  });
  it("palier « faible » pèse moins (score 15, Ambre) que « negative »", () => {
    const r = mntRisque({ contrats: [mk("c1")], tickets: [], invoices: [], asOf: ASOF, nowMs: NOW, margeByContrat: { c1: "faible" } });
    expect(r.items[0].signals.find((x) => x.type === "marge_faible").severite).toBe("faible");
    expect(r.items[0].score).toBe(15);
    expect(r.items[0].niveau).toBe("ambre");
  });
  it("sans palier fourni (marge saine/inconnue) → aucun signal marge, margeNiveau null", () => {
    const r = mntRisque({ contrats: [mk("c1")], tickets: [], invoices: [], asOf: ASOF, nowMs: NOW });
    expect(r.items[0].signals.some((x) => x.type === "marge_faible")).toBe(false);
    expect(r.items[0].margeNiveau).toBe(null);
  });
});

describe("mntRisque — score cumulé & palier critique", () => {
  it("plusieurs signaux → Critique (score ≥ 60) + comptage cohérent", () => {
    const contrat = { id: "c1", fp: "FP/2026/1", client: "A", statut: "actif", dateDebut: "2026-06-01", dateFin: "2026-07-20", echeanceType: "mensuel", montantEngage: 100000, engagements: [{ type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: 8, quota: null }] };
    const r = mntRisque({
      contrats: [contrat],
      tickets: [
        { id: "t1", contratId: "c1", ouvertMs: day("2026-07-01"), priseEnCompteMs: null, resoluMs: null, dateJour: "2026-07-01" },
        { id: "t2", contratId: "c1", ouvertMs: day("2026-07-02"), priseEnCompteMs: null, resoluMs: null, dateJour: "2026-07-02" },
      ],
      invoices: [], asOf: ASOF, nowMs: NOW,
    });
    expect(r.items[0].niveau).toBe("critique");
    expect(r.items[0].score).toBeGreaterThanOrEqual(60);
    expect(r.counts.critique).toBe(1);
    expect(r.atRisk).toBe(1);
  });
});
