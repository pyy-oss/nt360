import { describe, it, expect } from "vitest";
const { atterrissage } = require("../domain/atterrissage");
const { alerts } = require("../domain/alerts");

const ORDERS = [
  { fp: "FP/2026/1", client: "ACME", bu: "ICT", yearPo: 2026, cas: 1000, raf: 400, mb: 210 },
  { fp: "FP/2022/9", client: "ACME", bu: "ICT", yearPo: 2022, cas: 800, raf: 300, mb: -50 }, // marge nég + dormant
  { fp: "FP/2026/3", client: "BETA", bu: "CLOUD", yearPo: 2026, cas: 200, raf: 0, mb: 40 },
];
const INVOICES = [
  { fp: "FP/2026/1", date: "2026-01-01", amountHt: 600 },
  { fp: "FP/2025/1", date: "2025-01-01", amountHt: 400 },
];
// Pondération de projection tiérée + fenêtre D Prev = EXERCICE (les certitudes glissent :
// une D Prev passée DANS l'année compte ; seuls N-1 et N+1+ sont exclus).
const OPPS = [
  { stage: 4, probability: 0.95, amount: 1000, closingDate: "2026-05-01" }, // ≥90% + année → 100% = 1000
  { stage: 4, probability: 0.80, amount: 2000, closingDate: "2026-06-01" }, // 70–90% + année → 20% = 400
  { stage: 4, probability: 0.50, amount: 1000, closingDate: "2026-07-01" }, // 50–70% + année → 10% = 100
  { stage: 4, probability: 0.40, amount: 5000, closingDate: "2026-07-01" }, // IdC<50% → 0
  { stage: 4, probability: 0.95, amount: 300, closingDate: "2026-02-01" },  // ≥90% D Prev passée DANS l'année → glisse → 100% = 300
  { stage: 4, probability: 0.95, amount: 500, closingDate: "2025-12-01" },  // année N-1 → exclu
  { stage: 4, probability: 0.95, amount: 800, closingDate: "2027-01-15" },  // année N+1 → exclu
  { stage: 6, probability: 1.0, amount: 400, closingDate: "2026-08-01" },   // gagné (non actif) → exclu
  { stage: 8, probability: 0.95, amount: 700, closingDate: "2026-09-01" },  // suspendu (non actif) → exclu
];
const OBJ = [{ fiscalYear: 2026, scope: "global", targetCas: 4000, targetInvoiced: 4000 }];
const ASOF = "2026-03-01";

describe("atterrissage (§7)", () => {
  const a = atterrissage(ORDERS, INVOICES, OPPS, OBJ, 2026, ASOF);
  it("pipeline projeté tiéré (100%≥90 · 20%≥70 · 10%≥50) sur l'exercice → projeté CAS", () => {
    expect(a.realiseCas).toBe(1200); // 1000 + 200 (yearPo 2026)
    expect(a.pipelinePondere).toBe(1750); // 1000 + 300 (≥90%) + 400 (20%·2000) + 50 (5%·1000) ; N±1/<50%/non-actifs exclus
    expect(a.projete).toBe(2950); // 1200 + 1750
  });
  it("projeté CAF = facturé réalisé + backlog (RAF) + pipeline projeté", () => {
    expect(a.backlog).toBe(700); // RAF ouverts : 400 (FP/2026/1) + 300 (FP/2022/9)
    expect(a.cafProjete).toBe(3050); // 600 (facturé FY) + 700 (backlog) + 1750 (pipeline projeté)
  });
  it("atterrissage CAF vs cible de facturation (targetInvoiced)", () => {
    expect(a.objectifCaf).toBe(4000);
    expect(a.ecartCaf).toBe(-950); // 3050 − 4000
    expect(a.probaAtteinteCaf).toBeCloseTo(3050 / 4000, 6);
  });
  it("écart vs objectif CAS + N vs N-1", () => {
    expect(a.objectif).toBe(4000);
    expect(a.ecart).toBe(-1050); // 2950 − 4000
    expect(a.factureN).toBe(600);
    expect(a.factureN1).toBe(400);
    expect(a.croissanceFacture).toBeCloseTo(0.5, 6);
  });
  it("M1 — opp ouverte dont le FP a déjà une commande = exclue du pipeline projeté (pas de double compte)", () => {
    const ord = [{ fp: "FP/2026/5", yearPo: 2026, cas: 100, raf: 0 }];
    const op = [
      { fp: "FP/2026/5", stage: 5, probability: 0.95, amount: 100, closingDate: "2026-06-01" }, // déjà en commande → exclue
      { fp: "FP/2026/6", stage: 5, probability: 0.95, amount: 80, closingDate: "2026-06-01" },  // pas de commande → comptée
    ];
    const r = atterrissage(ord, [], op, [], 2026, "2026-03-01");
    expect(r.realiseCas).toBe(100);
    expect(r.pipelinePondere).toBe(80);   // seule FP/2026/6 (100 % de 80) ; FP/2026/5 exclue (déjà en CAS)
    expect(r.projete).toBe(180);          // 100 + 80, pas 100 + 180
  });
  it("M2 — RAF plafonné à (CAS − facturé) dans cafProjete (pas de facturé + RAF > CAS)", () => {
    const ord = [{ fp: "FP/2026/7", yearPo: 2026, cas: 100, raf: 100, facture: 60 }]; // RAF curaté non décrémenté
    const r = atterrissage(ord, [{ fp: "FP/2026/7", date: "2026-02-01", amountHt: 60 }], [], [], 2026, "2026-03-01");
    expect(r.backlog).toBe(100);          // Suivi Backlog : RAF curaté inchangé
    expect(r.backlogProjete).toBe(40);    // projection : plafonné à 100 − 60
    expect(r.cafProjete).toBe(100);       // 60 (facturé) + 40 (RAF plafonné) + 0 pipeline = 100 (= CAS), pas 160
  });
  it("cohérence closing : part du pipeline projeté « à requalifier » (D Prev passée) exposée", () => {
    // asOf = 2026-03-01 → seule l'opp D Prev 2026-02-01 (95 % → 300) est en retard, mais comptée.
    expect(a.pipelineRetard).toBe(300);
    expect(a.pipelineRetardCount).toBe(1);
    // Sous-ensemble du pipeline projeté (n'est PAS soustrait — transparence, design glissant).
    expect(a.pipelineRetard).toBeLessThanOrEqual(a.pipelinePondere);
  });
});

describe("alerts", () => {
  const sup = { bySupplier: [{ name: "HDF", state: "saturation" }, { name: "EXN", state: "tension" }] };
  const INV = [
    { fp: "FP/2026/1", amountHt: 600, linked: true, prePo: true }, // facturée avant l'année du PO
    { fp: "FP/2026/3", amountHt: 300, linked: true }, // Σ=300 > cas 200 → surfacturation
    { fp: "FP/9999/9", amountHt: 50, linked: false }, // orpheline
  ];
  const BCL = [
    { status: "emis" }, { status: "solde" },
    { status: "emis", etaContrat: "2026-03-01", bcNumber: "BC1" }, // ETA dépassée (asOf 2026-06-01) + non livré → retard
    { status: "livre", etaContrat: "2026-01-01", bcNumber: "BC2" }, // livré → pas en retard
    { status: "a_emettre", etaContrat: "2026-12-01", bcNumber: "BC3" }, // ETA future → pas en retard
  ];
  const items = alerts(ORDERS, INV, sup, BCL, 2026, "2026-06-01");
  const byType = Object.fromEntries(items.map((i) => [i.type, i]));
  it("marge négative + backlog dormant détectés", () => {
    expect(byType.marge_negative.count).toBe(1);
    expect(byType.backlog_dormant.count).toBe(1); // FP/2022/9 (≤2024) raf>0
  });
  it("saturation + tension fournisseurs", () => {
    expect(byType.ligne_saturee.count).toBe(1);
    expect(byType.ligne_tension.count).toBe(1);
  });
  it("concentration client (ACME > 30% du CAS)", () => {
    expect(byType.concentration_client).toBeTruthy();
  });
  it("BC non soldés", () => {
    expect(byType.bc_en_attente.count).toBe(4); // emis, emis(BC1), a_emettre(BC3), livre(BC2) — tous ≠ solde
  });
  it("BC en retard (ETA dépassée, non livré)", () => {
    expect(byType.bc_en_retard.count).toBe(1); // BC1 seulement (BC2 livré, BC3 ETA future)
    expect(byType.bc_en_retard.refs).toContain("BC1");
  });
  it("alertes BC = exécution : lignes de fiche affaire (source « fiche ») exclues (cohérence avec la vue Exécution BC)", () => {
    const withFiche = [...BCL, { status: "emis", etaContrat: "2026-03-01", bcNumber: "BCF", source: "fiche" }];
    const a = Object.fromEntries(alerts(ORDERS, INV, sup, withFiche, 2026, "2026-06-01").map((i) => [i.type, i]));
    expect(a.bc_en_retard.count).toBe(1);   // BCF (fiche) NON compté malgré ETA dépassée
    expect(a.bc_en_attente.count).toBe(4);  // BCF (non soldé) NON compté non plus
  });
  it("alertes financières : orphelines, surfacturation, RAF incohérent, pré-PO", () => {
    expect(byType.factures_non_rattachees.count).toBe(1); // FP/9999/9 (linked !== true)
    expect(byType.surfacturation.count).toBe(1); // FP/2026/3 (300 > 200)
    expect(byType.raf_incoherent.count).toBeGreaterThanOrEqual(1); // FP/2022/9 (attendu 800 vs raf 300)
    expect(byType.facture_pre_po.count).toBe(1); // FP/2026/1 prePo
  });
  it("seuil dormantYears configurable (config/alerts)", () => {
    const d0 = alerts(ORDERS, INV, sup, BCL, 2026, "2026-06-01");
    expect(d0.find((x) => x.type === "backlog_dormant").message).toContain("2024"); // défaut fy-2
    const d1 = alerts(ORDERS, INV, sup, BCL, 2026, "2026-06-01", [], { dormantYears: 1 });
    expect(d1.find((x) => x.type === "backlog_dormant").message).toContain("2025"); // fy-1
  });
  it("opportunités dormantes : actives à D Prev dépassée (ancienneté)", () => {
    const opps = [
      { client: "A", fp: "FP/2026/10", stage: 3, closingDate: "2026-01-15" }, // passée < asOf → dormante
      { client: "B", stage: 6, closingDate: "2026-01-01" }, // gagnée → ignorée
      { client: "C", stage: 2, closingDate: "2026-12-01" }, // future → ignorée
    ];
    const it2 = alerts([], [], { bySupplier: [] }, [], 2026, "2026-06-01", opps);
    const d = it2.find((x) => x.type === "opp_dormante");
    expect(d.count).toBe(1);
    expect(d.refs).toContain("FP/2026/10");
    expect(d.message).toMatch(/\d+ j/); // l'ancienneté (jours) figure dans le message
  });
});
