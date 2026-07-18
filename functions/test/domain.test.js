import { describe, it, expect } from "vitest";
const { overview } = require("../domain/chaine");
const { backlogFy } = require("../domain/backlog");
const { pipeline } = require("../domain/pipeline");
const { suppliers } = require("../domain/fournisseurs");
const { facturation, rentabilite, byEntity } = require("../domain/reporting");
const { filterInvoices } = require("../lib/aggregate");

const ORDERS = [
  { fp: "FP/2026/1", client: "ACME", bu: "ICT", yearPo: 2026, cas: 1000, raf: 400, mb: 210, suppliers: [{ name: "HIPERDIST", amount: 300 }] },
  { fp: "FP/2025/2", client: "BETA", bu: "CLOUD", yearPo: 2025, cas: 500, raf: 0, mb: 100, suppliers: [{ name: "WESTCON", amount: 200 }] },
  { fp: "FP/2026/3", client: "ACME", bu: "ICT", yearPo: 2026, cas: 800, raf: 800, mb: 160, suppliers: [{ name: "HIPERDIST", amount: 100 }] },
];
const INVOICES = [
  { numero: "A1", fp: "FP/2026/1", client: "ACME", bu: "ICT", date: "2026-01-10", amountHt: 600 },
  { numero: "A2", fp: "FP/2026/1", client: "ACME", bu: "ICT", date: "2026-02-10", amountHt: 300 },
  { numero: "B1", fp: "FP/2025/2", client: "BETA", bu: "CLOUD", date: "2025-06-10", amountHt: 500 },
];
const OPPS = [
  { oppId: "o1", client: "ACME", am: "DATCHA", bu: "ICT", amount: 1000, stage: 4, probability: 0.6, weighted: 600, closingDate: "2026-03-01" },
  { oppId: "o2", client: "BETA", am: "KOUADIO", bu: "CLOUD", amount: 2000, stage: 2, probability: 0.25, weighted: 500, closingDate: "2026-04-01" },
  { oppId: "o3", client: "GAMMA", am: "DATCHA", bu: "ICT", amount: 5000, stage: 8, probability: 0.05, weighted: 250 },
  { oppId: "o4", client: "D", am: "X", bu: "ICT", amount: 100, stage: 6, probability: 1, weighted: 100 },
  { oppId: "o5", client: "E", am: "Y", bu: "ICT", amount: 100, stage: 7, probability: 0, weighted: 0 },
  // Éligible au pondéré : actif (stage 3) + IdC ≥ 90 %.
  { oppId: "o6", client: "ACME", am: "DATCHA", bu: "ICT", amount: 1000, stage: 3, probability: 0.95, weighted: 950, closingDate: "2026-05-01" },
];

describe("overview — chaîne (§7)", () => {
  const ov = overview(ORDERS, INVOICES, OPPS);
  it("commandes / facturé CAF (Σ factures, orphelines incluses) / RAF période", () => {
    expect(ov.commandes).toBe(2300);
    expect(ov.facture).toBe(1400); // CAF = Σ factures datées (non additif avec CAS/Backlog)
    expect(ov.rafPeriode).toBe(1200);
    expect(ov.backlog).toBe(1200); // sans opts → RAF période (rétro-compat)
    expect(ov.backlogCount).toBe(2); // FP/2026/1 (raf 400) + FP/2026/3 (raf 800)
  });
  it("facturé = CAF (Σ factures), orphelines incluses (facturation réelle)", () => {
    const ov2 = overview(ORDERS, [...INVOICES, { numero: "X", fp: "FP/9999/9", amountHt: 777 }], OPPS);
    expect(ov2.facture).toBe(2177); // 1400 + 777 : une facture orpheline reste du CA facturé
  });
  it("backlog GLISSANT fourni via opts (indépendant de la période)", () => {
    const ov3 = overview(ORDERS, INVOICES, OPPS, { backlog: 9999, backlogCount: 42 });
    expect(ov3.backlog).toBe(9999);
    expect(ov3.backlogCount).toBe(42);
    expect(ov3.rafPeriode).toBe(1200);
    // Taux de facturation = Facturé / (Facturé + Backlog) : ici Facturé=1400, Backlog=9999.
    expect(ov3.ratios.tauxFacturation).toBeCloseTo(1400 / (1400 + 9999), 6);
  });
  it("encaissé = Σ factures PAYÉES de la période ; taux d'encaissement = Encaissé / Facturé (DO Lot 4)", () => {
    const inv = [
      { numero: "P1", fp: "FP/2026/1", date: "2026-01-10", amountHt: 600, paid: true },
      { numero: "P2", fp: "FP/2026/1", date: "2026-02-10", amountHt: 300, paid: false }, // facturée, non encaissée
      { numero: "P3", fp: "FP/2025/2", date: "2025-06-10", amountHt: 100, paid: true },
    ];
    const ovp = overview(ORDERS, inv, OPPS);
    expect(ovp.facture).toBe(1000);                 // 600 + 300 + 100
    expect(ovp.encaisse).toBe(700);                 // 600 + 100 (payées)
    expect(ovp.ratios.tauxEncaissement).toBeCloseTo(700 / 1000, 6);
    // Aucune facture payée → encaissé 0, taux 0 (rétro-compat : INVOICES n'ont pas de drapeau paid).
    expect(ov.encaisse).toBe(0);
    expect(ov.ratios.tauxEncaissement).toBe(0);
  });
  it("certitudes = pondéré certain (IdC≥90%) à 100% du montant ; commandes suivies à part", () => {
    expect(ov.pondCertain).toBe(1000); // o6 éligible, valorisé à 100% du montant
    expect(ov.certitudes).toBe(1000);
  });
  it("taux de facturation = Facturé / (Facturé + Backlog)", () => {
    // Facturé (CAF) = 1400 ; Backlog (sans opts → RAF période) = 1200 → 1400/2600.
    expect(ov.ratios.tauxFacturation).toBeCloseTo(1400 / (1400 + 1200), 6);
  });
  it("taux de conversion vente = Commande / (Commande + Certitude + 20%·[70-90%[ + 10%·[50-70%[ + Perdu)", () => {
    // Commande=2300 ; Certitude(≥90%)=o6=1000 ; [70-90%[=0 ; [50-70%[=o1(0.6)=1000 ; Perdu=o5=100.
    // Dénominateur = 2300 + 1000 + 0 + 0.1·1000 + 100 = 3500.
    expect(ov.perdu).toBe(100);
    expect(ov.ratios.tauxConversionVente).toBeCloseTo(2300 / 3450, 6); // convDenom = 2300 (cmd) + 1050 (pipeline projeté : 1000 + 5%·1000) + 100 (perdu)
  });
  it("exclusion « déjà au carnet » par FP CANONIQUE : opp ouverte au FP formaté autrement n'est PAS double-comptée (audit fiabilité, parité atterrissage)", () => {
    // Commande FP/2026/1 (canonique) ; opp ENCORE OUVERTE (stage 3, IdC 95 %) portant le MÊME FP mais
    // formaté avec des zéros de tête. Elle est déjà dans `commandes` (CAS) → doit être EXCLUE du pipeline
    // projeté (avant correctif : test d'appartenance sur le FP brut ⇒ non exclue ⇒ pondéré gonflé).
    const ord = [{ fp: "FP/2026/1", client: "ACME", cas: 1000, raf: 0, mb: 0 }];
    const openBooked = [{ client: "ACME", fp: "FP/2026/001", stage: 3, probability: 0.95, amount: 1000 }];
    const ov4 = overview(ord, [], openBooked);
    expect(ov4.pipelineProjete).toBe(0); // l'opp « déjà au carnet » est exclue → aucun pipeline projeté
    // Sans le correctif, elle serait valorisée à 100 % (≥90 %) → pipelineProjete = 1000.
  });
});

describe("backlogFy — ancré FY, indépendant de la période (§7)", () => {
  it("total = Σ RAF des commandes ouvertes", () => {
    const b = backlogFy(ORDERS, 2026);
    expect(b.total).toBe(1200); // 400 + 800 (FP/2025/2 a raf=0 → exclu)
    expect(b.count).toBe(2);
    expect(b.byBu.ICT).toBe(1200);
    expect(b.byVintage["2026"]).toBe(1200);
    expect(b.fy).toBe(2026);
  });
  it("inchangé quelle que soit la période (pas de filtre période)", () => {
    expect(backlogFy(ORDERS, 2026).total).toBe(backlogFy(ORDERS, 2025).total);
  });
  it("ventile le RAF ouvert : curaté Excel vs dérivé (diagnostic)", () => {
    const orders = [
      { fp: "FP/2026/1", client: "ACME", bu: "ICT", yearPo: 2026, cas: 1000, raf: 400, rafSource: "excel", facture: 600 },
      { fp: "FP/2026/3", client: "GAMMA", bu: "ICT", yearPo: 2026, cas: 800, raf: 800, rafSource: "derive", facture: 0, source: "opp_won" },
      { fp: "FP/2025/2", client: "BETA", bu: "CLOUD", yearPo: 2025, cas: 500, raf: 0, rafSource: "excel" }, // fermé → exclu
    ];
    const b = backlogFy(orders, 2026);
    expect(b.total).toBe(1200);
    expect(b.totalExcel).toBe(400);
    expect(b.totalDerive).toBe(800);
    expect(b.countExcel).toBe(1);
    expect(b.countDerive).toBe(1);
    expect(b.deriveTop[0]).toMatchObject({ fp: "FP/2026/3", raf: 800, cas: 800, facture: 0, source: "opp_won" });
  });
  it("normalise bu/client/fp manquants (jamais d'undefined → écriture Firestore valide)", () => {
    const orders = [
      { fp: "FP/2026/9", cas: 500, raf: 500, rafSource: "derive" }, // bu/client absents
    ];
    const b = backlogFy(orders, 2026);
    for (const row of [...b.top, ...b.deriveTop]) {
      expect(row.bu).toBe("AUTRE");
      expect(row.client).toBe("");
      expect(Object.values(row).every((v) => v !== undefined)).toBe(true);
    }
  });
});

describe("pipeline — pondéré = PROJECTION tiérée (100/20/10), conversion", () => {
  const p = pipeline(OPPS);
  it("brut = funnel active ; pondéré = projection tiérée", () => {
    expect(p.tot.brut).toBe(4000); // active 1-5 : 1000 + 2000 + 1000
    // o6 (0.95→100%·1000) + o1 (0.6→5%·1000=50) + o2 (0.25→0) = 1050.
    expect(p.tot.weighted).toBe(1050);
    expect(p.tot.countConf).toBe(2); // o6 et o1 contribuent (IdC ≥ 50 %) ; o2 non
    expect(p.confianceMin).toBe(0.9);
  });
  it("suspendu (8) séparé", () => {
    expect(p.susp.brut).toBe(5000);
    expect(p.susp.count).toBe(1);
  });
  it("conversion win-rate = gagné/(gagné+perdu)", () => {
    expect(p.conv).toBe(0.5);
  });
  it("pondéré par AM = projection tiérée des actives", () => {
    expect(p.byAM.DATCHA).toBe(1050); // o6 (1000) + o1 (5%·1000 = 50)
    expect(p.byAM.KOUADIO).toBe(0);   // o2 active mais IdC 0.25 → projeté 0
  });
  it("conversion par commercial (byAmConv)", () => {
    const byAm = Object.fromEntries(p.byAmConv.map((x) => [x.am, x]));
    expect(byAm.DATCHA.activeCount).toBe(2); // o1 + o6
    expect(byAm.DATCHA.weighted).toBe(1050); // o6 (1000) + o1 (5%·1000 = 50)
    expect(byAm.X.won).toBe(1); // o4 gagné
    expect(byAm.X.conv).toBe(1);
    expect(byAm.Y.lost).toBe(1); // o5 perdu
    expect(byAm.Y.conv).toBe(0);
  });
  it("closing = null sans asOf (rétro-compat)", () => {
    expect(p.closing).toBeNull();
  });
  it("analyse du closing (D Prev) : retard / trimestre + stale (projection tiérée)", () => {
    const pc = pipeline(OPPS, "2026-04-15");
    const b = pc.closing.buckets;
    // Actives (1-5) : o1 (03-01, passé), o2 (04-01, passé), o6 (05-01, T2 futur)
    expect(b.retard.count).toBe(2);
    expect(b.retard.brut).toBe(3000); // 1000 + 2000
    expect(b.trim.count).toBe(1);     // o6 (mai, même trimestre qu'avril)
    expect(pc.closing.staleCount).toBe(2);
    expect(pc.closing.staleTop[0].weighted).toBe(50); // o1 projeté (5%·1000) devant o2 (0)
  });
  it("ancienneté du retard : tranches d'âge + retard moyen", () => {
    const pc = pipeline(OPPS, "2026-04-15");
    const oa = pc.closing.overdueAge;
    expect(oa.d30.count).toBe(1);  // o2 (04-01 → 14 j)
    expect(oa.d30.brut).toBe(2000);
    expect(oa.d90.count).toBe(1);  // o1 (03-01 → 45 j)
    expect(oa.d90.brut).toBe(1000);
    expect(oa.dPlus.count).toBe(0);
    expect(pc.closing.avgOverdueDays).toBe(30); // round((45 + 14) / 2)
  });
  it("pondéré NET du carnet : une opp active dont le FP est déjà commande est exclue de la projection (parité chaine/atterrissage)", () => {
    // o6 (IdC 0.95 → 100 % · 1000) porte FP/2026/9 ; une commande sur ce FP la « booke » → déjà au CAS.
    const opps = OPPS.map((o) => (o.oppId === "o6" ? { ...o, fp: "FP/2026/9" } : o));
    const base = pipeline(opps);            // sans orders → aucune exclusion
    const net = pipeline(opps, undefined, undefined, [{ fp: "FP/2026/0009" }]); // FP canonique (zéros de tête)
    expect(base.tot.weighted).toBe(1050);   // o6 (1000) + o1 (50)
    expect(net.tot.weighted).toBe(50);      // o6 retirée du pondéré (déjà au carnet), o1 conservée
    expect(net.tot.count).toBe(3);          // funnel actif BRUT inchangé (o1, o2, o6)
    expect(net.byAM.DATCHA).toBe(50);       // pondéré AM net du carnet
    const datcha = net.byAmConv.find((x) => x.am === "DATCHA");
    expect(datcha.activeCount).toBe(2);     // activeCount reste brut (o1 + o6)
    expect(datcha.weighted).toBe(50);       // weighted net du carnet
  });
});

describe("suppliers — SOA : solde (facturé) vs engagement (§18.6)", () => {
  const bc = [
    { fp: "FP/2026/1", supplier: "HIPERDIST", amountXof: 250, status: "emis" },    // engagé (non facturé)
    { fp: "FP/2026/1", supplier: "HIPERDIST", amountXof: 400, status: "facture" }, // FACTURÉ → solde
    { fp: "FP/2026/1", supplier: "HIPERDIST", amountXof: 100, status: "solde" },   // payé → hors compte
  ];
  const credit = [{ id: "WESTCON", authorized: 1000, openingBalance: 150 }];
  const s = suppliers(ORDERS, bc, credit);
  it("exposition = Σ suppliers.amount", () => {
    expect(s.totalExpo).toBe(600); // 300 + 200 + 100
  });
  it("SOLDE = ouverture + BC facturés (non payés) ; les BC engagés/soldés n'y entrent pas", () => {
    const hip = s.bySupplier.find((x) => x.name === "HIPERDIST");
    expect(hip.solde).toBe(400);   // seul le BC « facturé » (400) ; émis (250) et soldé (100) exclus
    expect(hip.encours).toBe(400); // rétro-compat = solde
    const wes = s.bySupplier.find((x) => x.name === "WESTCON");
    expect(wes.solde).toBe(150);   // ouverture seule (aucun BC WESTCON)
  });
  it("ENGAGEMENT = BC non facturés + prévisionnel des commandes ouvertes (netté des BC)", () => {
    // HIPERDIST : BC engagé 250 ; commandes ouvertes FP/2026/1 (300) + FP/2026/3 (100) = 400 d'achat,
    // nettées des BC non soldés du couple (250+400=650 ≥ 300 pour FP1) → openPrev = 0 (FP1) + 100 (FP3).
    const hip = s.bySupplier.find((x) => x.name === "HIPERDIST");
    expect(hip.engagementBc).toBeUndefined(); // champ interne non exposé
    expect(hip.engagement).toBe(250 + 100);   // 250 (BC émis) + 100 (FP/2026/3 sans BC)
  });
  it("solde d'ouverture SOA : openingBalance saisi (rétro-compat outstanding)", () => {
    const s2 = suppliers([], [], [{ id: "ACME", authorized: 500, openingBalance: 120 }]);
    expect(s2.bySupplier.find((x) => x.name === "ACME").solde).toBe(120);
    const s3 = suppliers([], [], [{ id: "ACME", authorized: 500, outstanding: 90 }]); // ancien champ
    expect(s3.bySupplier.find((x) => x.name === "ACME").solde).toBe(90);
  });
  it("état : saturation si solde+engagement > autorisé", () => {
    const hip = s.bySupplier.find((x) => x.name === "HIPERDIST");
    expect(hip.state).toBe("non_suivi"); // pas de creditLine HIPERDIST
    // Fournisseur saturé : solde d'ouverture 200 > autorisé 100 → saturation.
    const s2 = suppliers(
      [{ fp: "FP/2026/1", raf: 100, suppliers: [{ name: "PETIT", amount: 10 }] }],
      [],
      [{ id: "PETIT", authorized: 100, openingBalance: 200 }],
    );
    expect(s2.saturated).toContain("PETIT");
    expect(Array.isArray(s2.tension)).toBe(true);
  });
});

describe("reporting — facturation/rentabilité/entités", () => {
  it("facturation mensuelle + top clients", () => {
    const f = facturation(INVOICES);
    expect(f.total).toBe(1400);
    expect(f.monthly["2026-01"]).toBe(600);
    expect(f.topClients[0]).toEqual({ key: "ACME", value: 900 });
  });
  it("rentabilité %MB", () => {
    const r = rentabilite(ORDERS);
    expect(r.mb).toBe(470);
    expect(r.cas).toBe(2300);
    expect(r.pmb).toBeCloseTo(470 / 2300, 6);
  });
  it("rentabilité byAm + bottomAffaires (marges croissantes)", () => {
    const r = rentabilite(ORDERS);
    expect(r.byAm.length).toBeGreaterThanOrEqual(1);
    expect(r.byAm.reduce((s, a) => s + a.cas, 0)).toBe(2300);
    expect(r.bottomAffaires).toHaveLength(3);
    expect(r.bottomAffaires[0].pmb).toBeLessThanOrEqual(r.bottomAffaires[2].pmb); // trié marge croissante
    expect(r.bottomAffaires[0].pmb).toBeCloseTo(0.20, 4); // FP/2025/2 ou FP/2026/3 (0.20)
  });
  it("rentabilité — perspectives Commande (CAS) et Facturé (factures datées × taux de marge)", () => {
    const orders = [
      { fp: "FP/1", client: "A", bu: "ICT", am: "X", cas: 1000, mb: 200 }, // taux 20%
      { fp: "FP/2", client: "B", bu: "CLOUD", am: "Y", cas: 400, mb: 40 },  // taux 10%
      { fp: "FP/3", client: "C", bu: "ICT", am: "X", cas: 0, mb: 0, marginPct: 0.3 }, // cas=0 → taux via marginPct
    ];
    const invoices = [
      { fp: "FP/1", amountHt: 500 }, // 500 × 20% = 100
      { fp: "FP/2", amountHt: 400 }, // 400 × 10% = 40
      { fp: "FP/1", amountHt: 100 }, // même FP → +100 assiette, +20 marge
      { fp: "FP/3", amountHt: 100 }, // 100 × 30% = 30 (repli marginPct)
    ];
    const r = rentabilite(orders, invoices, orders);
    // Racine = perspective Commande (rétro-compat)
    expect(r.cas).toBe(1400);
    expect(r.mb).toBe(240);
    const cmd = r.perspectives.commande, fac = r.perspectives.facture;
    expect(cmd.base).toBe(1400);
    expect(cmd.mb).toBe(240);
    // Facturé : assiette = Σ factures datées (comme la vue Facturation) ; marge = taux commande × facturé
    expect(fac.base).toBe(1100);              // 500 + 400 + 100 + 100
    expect(fac.mb).toBeCloseTo(190, 6);       // 120 (FP/1) + 40 (FP/2) + 30 (FP/3)
    expect(fac.pmb).toBeCloseTo(190 / 1100, 6);
    const ict = fac.byBu.find((b) => b.bu === "ICT");
    expect(ict.base).toBe(700);               // FP/1 (600) + FP/3 (100)
    expect(ict.mb).toBeCloseTo(150, 6);       // 120 + 30
    expect(fac.bottomAffaires[0].pmb).toBeCloseTo(0.10, 6); // FP/2, marge la plus faible
  });
  it("Facturé : marge reconnue PLAFONNÉE au CAS (pas de marge sur la surfacturation)", () => {
    const orders = [{ fp: "FP/1", client: "A", bu: "ICT", am: "X", cas: 1000, mb: 200 }]; // taux 20 %
    const invoices = [{ fp: "FP/1", amountHt: 1500 }]; // surfacturé : 1500 > CAS 1000
    const fac = rentabilite(orders, invoices, orders).perspectives.facture;
    expect(fac.base).toBe(1500);      // assiette = facturé RÉEL (inchangée)
    expect(fac.mb).toBe(200);         // marge plafonnée à taux×CAS = 200 (et non 0,20×1500 = 300)
    expect(fac.pmb).toBeCloseTo(200 / 1500, 6); // %MB facturé dilué par la surfacturation (honnête)
  });
  it("plafond marge : marge NÉGATIVE aussi bornée à la perte P&L (pas d'aggravation par surfacturation)", () => {
    const orders = [{ fp: "FP/1", client: "A", bu: "ICT", am: "X", cas: 1000, mb: -100 }]; // taux -10 %
    const invoices = [{ fp: "FP/1", amountHt: 2000 }]; // surfacturé
    const fac = rentabilite(orders, invoices, orders).perspectives.facture;
    expect(fac.mb).toBe(-100); // −0,10 × min(2000,1000) = −100 (et non −200)
  });
  it("invariant inter-vues : Facturé (rentabilité) == total Facturation pour les mêmes factures", () => {
    const orders = [{ fp: "FP/1", bu: "ICT", am: "X", client: "ACME", cas: 1000, mb: 200 }];
    const invoices = [{ fp: "FP/1", amountHt: 600 }, { fp: "FP/2", amountHt: 400 }]; // FP/2 orpheline
    const r = rentabilite(orders, invoices, orders);
    const f = facturation(invoices);
    expect(r.perspectives.facture.base).toBe(f.total); // 1000 — assiette Facturé cohérente avec la vue Facturation
  });
  it("byEntity client agrège cas/facturé/backlog", () => {
    const rows = byEntity(ORDERS, INVOICES, (x) => x.client);
    const acme = rows.find((r) => r.key === "ACME");
    expect(acme.cas).toBe(1800);
    expect(acme.facture).toBe(900);
    expect(acme.backlog).toBe(1200);
  });
  it("byEntity au-delà de 100 entités → longue traîne AGRÉGÉE en « Autres » (cf. audit intégral A2)", () => {
    // 130 clients distincts, CAS décroissant → top 100 + 1 ligne « Autres (30) ».
    const many = Array.from({ length: 130 }, (_, i) => ({ client: `C${String(i).padStart(3, "0")}`, cas: 1000 - i, raf: 0, mb: 0 }));
    const rows = byEntity(many, [], (x) => x.client);
    expect(rows).toHaveLength(101); // 100 + Autres
    const other = rows[rows.length - 1];
    expect(other.isOther).toBe(true);
    expect(other.key).toBe("Autres (30)");
    // Somme préservée : Σ(top100) + Autres = Σ(tous) → aucune entité perdue silencieusement.
    const totalRows = rows.reduce((s, r) => s + r.cas, 0);
    const totalAll = many.reduce((s, r) => s + r.cas, 0);
    expect(totalRows).toBe(totalAll);
  });
  it("byEntity ≤ 100 entités → pas de ligne « Autres »", () => {
    const rows = byEntity(ORDERS, INVOICES, (x) => x.client);
    expect(rows.some((r) => r.isOther)).toBe(false);
  });
  it("byEntity avec opps → forecast (pondéré ouvert) + projeté par client (Bilan CODIR)", () => {
    const opps = [
      { client: "ACME", stage: 3, probability: 0.95, amount: 500 }, // ouverte, IdC ≥90 → certitudes ×1 = 500
      { client: "ACME", stage: 6, probability: 1, amount: 999 },    // GAGNÉE → déjà dans le CAS, exclue du forecast
      { client: "MTN", stage: 2, probability: 0.6, amount: 4000 },  // pipe ×0,05 = 200
    ];
    const rows = byEntity(ORDERS, INVOICES, (x) => x.client, opps);
    const acme = rows.find((r) => r.key === "ACME");
    expect(acme.forecast).toBe(500);              // seule l'opp ouverte, pondérée en TIÉRÉ (certitudes)
    expect(acme.projete).toBe(acme.cas + 500);    // CAS (+ certitudes) + forecast
    // sans opps : projeté = CAS (rétrocompatible).
    const plain = byEntity(ORDERS, INVOICES, (x) => x.client);
    expect(plain.find((r) => r.key === "ACME").projete).toBe(plain.find((r) => r.key === "ACME").cas);
  });
});

describe("filterInvoices — période", () => {
  it("all vs année", () => {
    expect(filterInvoices(INVOICES, "all")).toHaveLength(3);
    expect(filterInvoices(INVOICES, "2026")).toHaveLength(2);
    expect(filterInvoices(INVOICES, "2025")).toHaveLength(1);
  });
});
