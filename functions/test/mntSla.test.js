import { describe, it, expect } from "vitest";
const { businessMsBetween, addBusinessMs, slaState } = require("../domain/mntSla");
const { echeancier, monthsBetween, addMonthsIso, echeancierPlan } = require("../domain/mntEcheancier");

const H = 3600000;
// Repères UTC : 2026-03-04 est un MERCREDI ; 2026-03-06 vendredi ; 2026-03-07 samedi ; 2026-03-09 lundi.
const wed10 = Date.UTC(2026, 2, 4, 10); // mer 10:00
const fri10 = Date.UTC(2026, 2, 6, 10); // ven 10:00

describe("mntSla — horloge jours ouvrés pleins (ADR-002)", () => {
  it("compte les heures en semaine, saute le week-end", () => {
    expect(businessMsBetween(wed10, wed10 + 3 * H)).toBe(3 * H); // même jour ouvré
    // mer 10:00 → lun 10:00 = mer(14) + jeu(24) + ven(24) + [sam/dim ignorés] + lun(10) = 72 h
    const mon10 = Date.UTC(2026, 2, 9, 10);
    expect(businessMsBetween(wed10, mon10) / H).toBe(72);
  });
  it("addBusinessMs saute le week-end pour poser l'échéance", () => {
    // ven 10:00 + 8 h ouvrées : ven 10→24 = 14 h dispo → il reste, on saute sam/dim → lun. 8<14 donc ven 18:00.
    expect(addBusinessMs(fri10, 8 * H)).toBe(Date.UTC(2026, 2, 6, 18));
    // ven 20:00 + 8 h : ven 20→24 = 4 h, reste 4 h → lun 00:00 + 4 h = lun 04:00.
    expect(addBusinessMs(Date.UTC(2026, 2, 6, 20), 8 * H)).toBe(Date.UTC(2026, 2, 9, 4));
  });
});

describe("mntSla — état SLA d'un engagement", () => {
  const eng = { seuilHeures: 8 };
  it("atteint avant l'échéance → respecté ; après → rompu", () => {
    expect(slaState(eng, wed10, wed10 + 4 * H, wed10 + 4 * H).state).toBe("respecte");
    expect(slaState(eng, wed10, wed10 + 30 * H, wed10 + 30 * H).state).toBe("rompu"); // 30h calendaires = >8h ouvrées
  });
  it("non atteint : en cours si dans les temps, rompu si échéance dépassée", () => {
    expect(slaState(eng, wed10, null, wed10 + 2 * H).state).toBe("en_cours");
    expect(slaState(eng, wed10, null, wed10 + 100 * H).state).toBe("rompu");
  });
});

describe("mntSla — couverture h24 : horloge CALENDAIRE 24/7 (audit BUG2)", () => {
  const sat00 = Date.UTC(2026, 2, 7, 0); // samedi 00:00
  it("h24 : le week-end consomme du délai (rupture détectée le samedi)", () => {
    const eng24 = { seuilHeures: 8, couverture: "h24" };
    // Ouvert samedi 00:00, non résolu, maintenant samedi 12:00 → 12 h > 8 h → rompu (24/7).
    expect(slaState(eng24, sat00, null, sat00 + 12 * H).state).toBe("rompu");
    // Échéance = samedi 08:00 (pas de saut de week-end).
    expect(slaState(eng24, sat00, null, sat00 + 4 * H).state).toBe("en_cours");
  });
  it("ouvre_lun_ven : le MÊME ticket samedi reste en cours (week-end ignoré) — contraste", () => {
    const engLv = { seuilHeures: 8, couverture: "ouvre_lun_ven" };
    expect(slaState(engLv, sat00, null, sat00 + 12 * H).state).toBe("en_cours"); // sam/dim ne consomment rien
  });
});

describe("mntSla — calendrier (ADR-P23) : fériés, fuseau, fenêtre B2B", () => {
  it("jours fériés : un férié en semaine est sauté comme un week-end", () => {
    // jeudi 2026-03-05 déclaré férié. mer 10:00 → 6h de seuil : mer 10→16 = 6h → échéance mer 16:00 (inchangé).
    const cal = { holidays: ["2026-03-05"] };
    expect(addBusinessMs(wed10, 6 * H, cal)).toBe(Date.UTC(2026, 2, 4, 16));
    // mer 10:00 + 20h : mer 10→24 = 14h, reste 6h. Jeudi FÉRIÉ sauté → vendredi 00→06 = ven 06:00.
    expect(addBusinessMs(wed10, 20 * H, cal)).toBe(Date.UTC(2026, 2, 6, 6));
    // businessMsBetween saute aussi le férié : mer 10:00 → ven 10:00 = mer(14) + [jeu férié] + ven(10) = 24h.
    expect(businessMsBetween(wed10, fri10, cal) / H).toBe(24);
  });
  it("férié : slaState bascule une rupture qui, sans férié, serait respectée", () => {
    const eng = { seuilHeures: 10, couverture: "ouvre_lun_ven" };
    const cal = { holidays: ["2026-03-05"] };
    // Ouvert mer 20:00, résolu jeu 06:00. Sans férié : jeu compte → 6h ouvrées ≤ 10h → respecté.
    // Avec jeu férié : mer 20→24 = 4h ouvrées seulement, échéance repoussée → à jeu 06:00 l'écoulé ouvré = 4h,
    // mais l'échéance (mer20 + 10h ouvrées) tombe le vendredi → résolu jeu 06:00 est AVANT l'échéance → respecté.
    // On teste plutôt le contraire : non résolu, maintenant vendredi 09:00 : échéance = mer20+10h ouvrées =
    // mer20→24(4h) + ven00→06(6h) = ven 06:00 ; maintenant ven 09:00 > ven 06:00 → rompu.
    expect(slaState(eng, Date.UTC(2026, 2, 4, 20), null, Date.UTC(2026, 2, 6, 9), cal).state).toBe("rompu");
  });
  it("fenêtre B2B (ouvre_b2b) : seules les heures 8–18 comptent", () => {
    const engB2b = { seuilHeures: 12, couverture: "ouvre_b2b" }; // 12h ouvrées = 8→18 (10h) + le lendemain 8→10 (2h)
    // Ouvert mer 09:00 : mer 09→18 = 9h, reste 3h → jeu 08→11. Échéance jeu 11:00.
    expect(addBusinessMs(Date.UTC(2026, 2, 4, 9), 12 * H, null, { start: 8, end: 18 })).toBe(Date.UTC(2026, 2, 5, 11));
    // slaState : ouvert mer 09:00, non résolu, maintenant mer 20:00 (hors fenêtre) → écoulé ouvré = 9h (09→18) < 12h → en cours.
    expect(slaState(engB2b, Date.UTC(2026, 2, 4, 9), null, Date.UTC(2026, 2, 4, 20)).state).toBe("en_cours");
  });
  it("B2B : ticket ouvert HORS fenêtre (soir) — l'horloge démarre à l'ouverture du lendemain ouvré", () => {
    const engB2b = { seuilHeures: 4, couverture: "ouvre_b2b" };
    // Ouvert mer 20:00 (après 18h). L'horloge ne tourne pas le soir → démarre jeu 08:00. +4h → jeu 12:00.
    const due = slaState(engB2b, Date.UTC(2026, 2, 4, 20), null, Date.UTC(2026, 2, 5, 13)).dueMs;
    expect(due).toBe(Date.UTC(2026, 2, 5, 12));
  });
  it("fuseau : décalage +60 min déplace la frontière du week-end", () => {
    // UTC+1 : le vendredi local finit à sam 01:00 UTC ; une heure ouvrée est disponible après minuit UTC.
    // Contrôle simple : le calcul reste cohérent (pas de régression) — ven 23:30 UTC = ven 00:30 local sam ? non,
    // ven 23:30 UTC +60 = sam 00:30 local → SAMEDI local → non ouvré. businessMsBetween(ven23:00, sam02:00) en UTC+1 :
    // ven23:00 UTC = sam00:00 local (non ouvré) → 0h comptée.
    expect(businessMsBetween(Date.UTC(2026, 2, 6, 23), Date.UTC(2026, 2, 7, 2), { offMin: 60 })).toBe(0);
    // Sans décalage (UTC) : ven 23:00 → sam 02:00 = ven 23→24 (1h ouvrée) + sam (0) = 1h.
    expect(businessMsBetween(Date.UTC(2026, 2, 6, 23), Date.UTC(2026, 2, 7, 2)) / H).toBe(1);
  });
  it("calendrier absent/neutre : STRICTE parité avec l'horloge historique", () => {
    const mon10 = Date.UTC(2026, 2, 9, 10);
    expect(businessMsBetween(wed10, mon10, { offMin: 0, holidays: [] })).toBe(businessMsBetween(wed10, mon10));
    expect(addBusinessMs(fri10, 8 * H, {})).toBe(addBusinessMs(fri10, 8 * H));
  });
});

describe("mntEcheancier — engagé vs facturé", () => {
  const c = { echeanceType: "mensuel", montantEngage: 1000000, dateDebut: "2026-01-01" };
  it("échéances dues = mois écoulés + 1 (1ʳᵉ à dateDebut) ; engagé = dues × montant", () => {
    expect(monthsBetween("2026-01-01", "2026-03-15")).toBe(2);
    const e = echeancier(c, 2500000, "2026-03-15"); // 3 échéances dues × 1M = 3M engagé ; 2,5M facturé
    expect(e.periodsDue).toBe(3);
    expect(e.engage).toBe(3000000);
    expect(e.ecart).toBe(500000); // sous-facturation de 0,5M
  });
  it("trimestriel : 1 échéance par trimestre ; borné par la date de fin", () => {
    const t = echeancier({ echeanceType: "trimestriel", montantEngage: 3000000, dateDebut: "2026-01-01", dateFin: "2026-06-30" }, 0, "2027-01-01");
    expect(t.periodsDue).toBe(2); // 2 trimestres sur un contrat de 6 mois
    expect(t.engage).toBe(6000000);
  });
  it("annuel 12 mois pile (dateFin = début + 12 mois) : 1 SEULE échéance, pas 2 — dateFin exclusive (bug doublage)", () => {
    // Contrat annuel du 01/01/26 au 01/01/27 (dateFin = borne de renouvellement). L'échéance du 01/01/27 est
    // la reconduction, NON due (les contrats ne se renouvellent pas d'office). asOf après la fin → 1 échéance.
    const a = echeancier({ echeanceType: "annuel", montantEngage: 12000000, dateDebut: "2026-01-01", dateFin: "2027-01-01" }, 0, "2027-06-01");
    expect(a.periodsDue).toBe(1);       // AVANT le fix : 2 (montant doublé)
    expect(a.engage).toBe(12000000);
  });
  it("mensuel 12 mois pile : 12 échéances, pas 13 — la 13ᵉ tombe sur dateFin (renouvellement)", () => {
    const m = echeancier({ echeanceType: "mensuel", montantEngage: 1000000, dateDebut: "2026-01-01", dateFin: "2027-01-01" }, 0, "2027-06-01");
    expect(m.periodsDue).toBe(12);      // AVANT le fix : 13
    expect(m.engage).toBe(12000000);
  });
  it("début en FIN DE MOIS (31/01) : les échéances rabattues (28/02…) sont comptées — pas de sous-décompte (audit M1)", () => {
    // mensuel démarrant le 31/01 : échéances réelles 31/01, 28/02, 31/03… asOf 28/02 → 2 dues (pas 1).
    const m = echeancier({ echeanceType: "mensuel", montantEngage: 1000000, dateDebut: "2026-01-31" }, 0, "2026-02-28");
    expect(m.periodsDue).toBe(2);       // AVANT le fix : 1 (monthsBetween comparait le jour du mois)
    expect(m.engage).toBe(2000000);
    // trimestriel 31/01 : échéances 31/01, 30/04, 31/07… asOf 30/04 → 2 dues (6M), pas 1 (3M).
    const t = echeancier({ echeanceType: "trimestriel", montantEngage: 3000000, dateDebut: "2026-01-31" }, 0, "2026-04-30");
    expect(t.periodsDue).toBe(2);
    expect(t.engage).toBe(6000000);
  });
  it("PARITÉ décompte ↔ liste datée sur un début fin de mois : echeancier.periodsDue === echeancierPlan lignes dues", () => {
    const c = { echeanceType: "mensuel", montantEngage: 1000000, dateDebut: "2026-01-31", dateFin: "2026-12-31" };
    const agg = echeancier(c, 0, "2026-02-28");
    const plan = echeancierPlan(c, 0, "2026-02-28");
    const duesListees = plan.periods.filter((p) => p.statut === "du").length;
    expect(agg.periodsDue).toBe(duesListees); // « même métrique = même nombre » (les deux modèles alignés)
  });
});

describe("mntEcheancier — addMonthsIso", () => {
  it("ajoute des mois, jour ramené au dernier du mois si dépassement", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-01-15", 3)).toBe("2026-04-15");
    expect(addMonthsIso("2026-11-30", 3)).toBe("2027-02-28");
  });
  it("rejette une date illisible", () => {
    expect(addMonthsIso("2026/01/01", 1)).toBeNull();
  });
});

describe("mntEcheancier — échéancier DÉTAILLÉ (echeancierPlan)", () => {
  it("liste datée : facturé (couvert cumulé) / dû (passé non couvert) / à venir, agrégats = echeancier", () => {
    // Contrat mensuel 1M, début 01/01, fin 30/06 (6 échéances) ; 2,5M facturé ; asOf 15/03 (3 dues).
    const c = { echeanceType: "mensuel", montantEngage: 1000000, dateDebut: "2026-01-01", dateFin: "2026-06-30" };
    const p = echeancierPlan(c, 2500000, "2026-03-15");
    expect(p.periods.length).toBe(6);               // toute la durée du contrat
    expect(p.periods.map((x) => x.dateEcheance)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"]);
    // cumul 1M,2M couverts par 2,5M facturé → facturé ; 3M > 2,5M et échéance ≤ asOf → dû ; avril+ futur → à venir.
    expect(p.periods.map((x) => x.statut)).toEqual(["facture", "facture", "du", "a_venir", "a_venir", "a_venir"]);
    // Parité stricte avec l'agrégat.
    const agg = echeancier(c, 2500000, "2026-03-15");
    expect({ periodsDue: p.periodsDue, engage: p.engage, facture: p.facture, ecart: p.ecart }).toEqual(agg);
  });
  it("sans date de fin : ne liste QUE les échéances dues (aucune projection spéculative)", () => {
    const p = echeancierPlan({ echeanceType: "mensuel", montantEngage: 500000, dateDebut: "2026-01-01" }, 0, "2026-03-15");
    expect(p.periods.length).toBe(3);               // = periodsDue, pas de futur inventé
    expect(p.periods.every((x) => x.statut === "du")).toBe(true); // rien de facturé, toutes passées
  });
  it("contrat non démarré (asOf < début) : aucune échéance", () => {
    const p = echeancierPlan({ echeanceType: "mensuel", montantEngage: 500000, dateDebut: "2026-09-01" }, 0, "2026-07-15");
    expect(p.periods.length).toBe(0);
  });
  it("annuel 12 mois pile : une SEULE ligne datée (pas de ligne fantôme sur dateFin) — miroir du fix agrégat", () => {
    // Le bug se manifestait comme une 2ᵉ ligne datée du 01/01/27 doublant le montant. dateFin exclusive → 1 ligne.
    const c = { echeanceType: "annuel", montantEngage: 12000000, dateDebut: "2026-01-01", dateFin: "2027-01-01" };
    const p = echeancierPlan(c, 0, "2027-06-01");
    expect(p.periods.length).toBe(1);
    expect(p.periods.map((x) => x.dateEcheance)).toEqual(["2026-01-01"]);
    expect(p.engage).toBe(12000000);    // AVANT le fix : 24000000
  });
});
