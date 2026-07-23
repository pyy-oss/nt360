import { describe, it, expect } from "vitest";
const { cashflow, decaissements, monthList } = require("../domain/cashflow");

describe("cashflow — échéancier des encaissements", () => {
  const INV = [
    { amountHt: 1000, date: "2026-06-01", dueDate: "2026-07-15", paid: false }, // mois courant (échéance)
    { amountHt: 500, date: "2026-06-20", dueDate: "2026-08-10", paid: false },   // mois +1
    { amountHt: 400, date: "2026-09-05", paid: false },                          // pas d'échéance → repli sur la date (mois +2)
    { amountHt: 150, paid: false },                                              // ni échéance ni date → mois courant
    { amountHt: 300, date: "2026-05-01", dueDate: "2026-05-31", paid: false },   // échue → en retard
    { amountHt: 200, date: "2026-06-01", dueDate: "2027-06-01", paid: false },   // au-delà de l'horizon
    { amountHt: 700, date: "2026-06-01", dueDate: "2026-07-01", paid: true },    // encaissée → exclue
  ];
  const ORDERS = [{ raf: 600 }, { raf: 0 }, { raf: 1200 }]; // Σ RAF = 1800
  const cf = cashflow(INV, ORDERS, "2026-07-01", { horizon: 6 });

  it("horizon = 6 mois glissants à partir du mois courant", () => {
    expect(cf.months).toHaveLength(6);
    expect(cf.months[0].month).toBe("2026-07");
    expect(cf.months[1].month).toBe("2026-08");
    expect(cf.months[5].month).toBe("2026-12");
  });
  it("AR au mois d'échéance ; repli sur la date ; ni l'un ni l'autre → mois courant", () => {
    expect(cf.months[0].ar).toBe(1150); // 1000 (éch. 07-15) + 150 (aucune date → mois courant)
    expect(cf.months[1].ar).toBe(500);  // éch. 08-10
    expect(cf.months[2].ar).toBe(400);  // pas d'échéance → date 09-05
  });
  it("créance échue isolée en « en retard » (hors échéancier futur)", () => {
    expect(cf.overdue).toBe(300);
    expect(cf.overdueCount).toBe(1);
    expect(cf.months.reduce((s, m) => s + m.ar, 0)).toBe(2050); // 1150 + 500 + 400
  });
  it("créance au-delà de l'horizon comptée à part (beyond)", () => {
    expect(cf.beyond).toBe(200); // éch. 2027-06
  });
  it("exclut les factures encaissées", () => {
    expect(cf.totalAR).toBe(2550); // 1000+500+400+150+300+200 (paid exclue)
    expect(cf.openCount).toBe(6);
  });
  it("backlog RAF étalé également sur l'horizon (indicatif)", () => {
    expect(cf.totalRaf).toBe(1800);
    expect(cf.months[0].backlog).toBe(300); // 1800 / 6
  });
  it("AR cumulé croissant", () => {
    expect(cf.months[0].cumulAr).toBe(1150);
    expect(cf.months[2].cumulAr).toBe(2050);
    expect(cf.months[5].cumulAr).toBe(2050);
  });
  it("monthList gère le passage d'année", () => {
    expect(monthList("2026-11-15", 4)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
  it("« en retard » au JOUR : une échéance passée DANS le mois courant est échue (pas ce mois)", () => {
    const cf2 = cashflow([
      { amountHt: 500, date: "2026-07-01", dueDate: "2026-07-05", paid: false }, // échue avant le 10
      { amountHt: 300, date: "2026-07-01", dueDate: "2026-07-20", paid: false }, // à venir ce mois
    ], [], "2026-07-10", { horizon: 3 });
    expect(cf2.overdue).toBe(500);        // 07-05 < 07-10 → en retard (jour), pas « ce mois »
    expect(cf2.months[0].ar).toBe(300);   // seule la 07-20 reste attendue ce mois
  });
});

describe("cashflow — avoirs nettés + RAF borné (audit cash)", () => {
  it("un AVOIR réduit l'encaissement attendu le plus proche (cohérent AR ↔ CAF)", () => {
    const cf = cashflow([
      { client: "ACME", amountHt: 1000, dueDate: "2026-07-15", paid: false },
      { client: "ACME", amountHt: -400, date: "2026-06-01", paid: false }, // avoir
    ], [], "2026-07-01", { horizon: 6 });
    expect(cf.grossAR).toBe(1000);
    expect(cf.avoirs).toBe(400);
    expect(cf.totalAR).toBe(600);          // net
    expect(cf.months[0].ar).toBe(600);     // avoir imputé sur le mois courant (le plus proche)
  });
  it("RAF NÉGATIF (commande sur-facturée) ne retranche pas du backlog cash", () => {
    const cf = cashflow([], [{ raf: 1200 }, { raf: -500 }], "2026-07-01", { horizon: 6 });
    expect(cf.totalRaf).toBe(1200); // le RAF négatif est borné à 0, pas soustrait
  });
});

describe("decaissements — payable = BC FACTURÉ (règle SOA), engagement à part", () => {
  const BC = [
    { amountXof: 1000, status: "facture", etaContrat: "2026-08-15" }, // FACTURÉ → payable mois +1
    { amountXof: 500, status: "facture", etaReel: "2026-06-01" },     // FACTURÉ, ETA passée → overdue
    { amountXof: 300, status: "facture" },                            // FACTURÉ sans ETA → mois courant
    { amountXof: 200, status: "facture", etaContrat: "2027-06-01" },  // FACTURÉ au-delà de l'horizon
    { amountXof: 700, status: "emis", etaContrat: "2026-08-15" },     // engagé (non facturé) → engagement
    { amountXof: 400, status: "livre", etaReel: "2026-06-01" },       // engagé, ETA passée → engagement imminent
    { amountXof: 999, status: "solde", etaContrat: "2026-08-01" },    // payé → exclu
    { amountXof: 0, status: "facture", etaContrat: "2026-08-01" },    // montant nul → exclu
  ];
  const d = decaissements(BC, "2026-07-01", { horizon: 6 });
  it("payable (facturé) : ETA inconnue → mois courant, ETA passée → overdue, au-delà à part", () => {
    expect(d.months[0].out).toBe(300);  // facturé sans ETA
    expect(d.months[1].out).toBe(1000); // facturé ETA 08-15
    expect(d.overdue).toBe(500);        // facturé ETA passée
    expect(d.overdueCount).toBe(1);
    expect(d.total).toBe(2000);         // 1000 + 500 + 300 + 200 (que du facturé)
    expect(d.beyond).toBe(200);
    expect(d.openCount).toBe(4);        // 4 lignes facturées
  });
  it("engagement (BC non facturés) compté À PART, hors payable", () => {
    expect(d.engagedTotal).toBe(1100);  // 700 (emis) + 400 (livre)
    expect(d.engagedCount).toBe(2);
    expect(d.months[1].engaged).toBe(700); // emis ETA 08-15
    expect(d.months[0].engaged).toBe(400); // livre ETA passée → imminent (mois courant)
  });
  it("les BC engagés n'entrent PAS dans le payable (total/out)", () => {
    const sumOut = d.months.reduce((s, m) => s + m.out, 0);
    expect(sumOut + d.beyond + d.overdue).toBe(d.total); // additivité sur le seul facturé
  });
  it("complétude ETA sur le payable facturé", () => {
    expect(d.etaKnown).toBe(1700);        // facturés à ETA : 1000 + 500 + 200
    expect(d.noEtaCount).toBe(1);         // un facturé sans ETA (300)
    expect(d.etaCompleteness).toBeCloseTo(0.85);
  });
  it("complétude = 1 quand rien de facturé (aucune division par zéro)", () => {
    const empty = decaissements([{ amountXof: 500, status: "emis" }], "2026-07-01");
    expect(empty.total).toBe(0);
    expect(empty.etaCompleteness).toBe(1);
    expect(empty.engagedTotal).toBe(500);
  });
});

describe("decaissements — VÉRITÉ DU COÛT (ADR-P21) : drapeau soaFromInvoices propagé au payable cash", () => {
  // Même sémantique que le solde SOA (domain/fournisseurs) : drapeau actif → le payable dérive des
  // FACTURES FOURNISSEUR RÉELLES ; le statut BC « facturé » est SUPERSEDÉ (ni payable ni engagement).
  // Sans cette symétrie, SOA et cash portaient DEUX vérités du dû fournisseur (audit 40 axes).
  const BC = [
    { bcNumber: "BC-1", supplier: "S", amountXof: 1000, status: "facture", etaReel: "2026-08-10" }, // supersedé
    { bcNumber: "BC-2", supplier: "S", amountXof: 700, status: "emis", etaReel: "2026-08-15" },     // engagement inchangé
  ];
  const INV = [
    { supplier: "S", amountXof: 400, date: "2026-08-05" },  // payable août
    { supplier: "S", amountXof: 250, date: "2026-05-01" },  // date passée → échu
    { supplier: "S", amountXof: 150 },                       // sans date → mois courant
  ];
  it("drapeau ACTIF : payable = factures réelles, BC « facturé » ignoré, engagement conservé", () => {
    const d = decaissements(BC, "2026-07-01", { soaFromInvoices: true, supplierInvoices: INV });
    expect(d.total).toBe(800);            // 400 + 250 + 150 — PAS le BC facturé (1000)
    expect(d.overdue).toBe(250);
    expect(d.months[1].out).toBe(400);    // août
    expect(d.months[0].out).toBe(150);    // sans date → mois courant
    expect(d.noEtaCount).toBe(1);
    expect(d.engagedTotal).toBe(700);     // l'engagement BC ne change pas
  });
  it("drapeau OFF (défaut) : comportement historique intact (BC facturé = payable, factures ignorées)", () => {
    const d = decaissements(BC, "2026-07-01", { supplierInvoices: INV });
    expect(d.total).toBe(1000);
    expect(d.engagedTotal).toBe(700);
  });
});

// ADR-068 — BC « annulé » : ni payable ni engagement de trésorerie (hors compte, comme un soldé).
describe("decaissements — BC annulé hors cash (ADR-068)", () => {
  const { decaissements } = require("../domain/cashflow");
  it("annule exclu du payable et de l'engagement ; l'émis témoin reste engagé", () => {
    const d = decaissements([
      { amountXof: 700, status: "annule", etaContrat: "2026-08-15" },
      { amountXof: 300, status: "emis", etaContrat: "2026-08-15" },
    ], "2026-07-01", { horizon: 6 });
    expect(d.total).toBe(0);          // aucun payable
    expect(d.engagedTotal).toBe(300); // seul l'émis engage la trésorerie
  });
});
