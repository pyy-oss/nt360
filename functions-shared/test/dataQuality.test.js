import { describe, it, expect } from "vitest";
const { dataQuality } = require("../domain/dataQuality");

describe("dataQuality — hygiène d'ingestion", () => {
  const orders = [
    { fp: "FP/2026/1", client: "ACME", am: "DATCHA", cas: 1000, yearPo: 2026 },
    { fp: "FP/2026/2", client: "", am: "", cas: 500, yearPo: 0 }, // sans client/am/année
    { fp: "FP/2026/3", client: "BETA", am: "X", cas: 200, yearPo: 2026 }, // surfacturée (300 > 200)
  ];
  const invoices = [
    { numero: "A1", fp: "FP/2026/1", amountHt: 600, date: "2026-01-10", dueDate: "2026-02-10", linked: true },
    { numero: "A2", fp: "FP/2026/3", amountHt: 300, date: "2026-02-10", linked: true }, // sans échéance
    { numero: "OR", fp: "FP/9999/9", amountHt: 100, linked: false }, // orpheline + sans date
  ];
  const opps = [
    { client: "GAMMA", stage: 3, amount: 1000, closingDate: "2026-05-01" },
    { client: "DELTA", stage: 4, amount: 0, closingDate: null }, // active sans D Prev + sans montant
    { client: "OMEGA", stage: 6, amount: 500 }, // gagnée SANS FP → non transformable
  ];
  const bcLines = [{ fp: "FP/2026/1", supplier: "HDF", amountXof: 100 }, { fp: "", supplier: "", bcNumber: "BC1" }];
  const sheets = [{ fp: "FP/2026/1", saleTotal: 900 }, { fp: "FP/2026/9", saleTotal: 0 }];
  const q = dataQuality(orders, invoices, opps, bcLines, sheets);
  const byType = Object.fromEntries(q.issues.map((i) => [i.type, i]));

  it("factures orphelines + surfacturation en sévérité haute", () => {
    expect(byType.factures_orphelines.count).toBe(1); // OR
    expect(byType.surfacturation.count).toBe(1); // FP/2026/3
    expect(byType.factures_orphelines.severity).toBe("high");
  });
  it("commandes : sans année / sans client / sans AM", () => {
    expect(byType.commandes_sans_annee.count).toBe(1); // FP/2026/2
    expect(byType.commandes_sans_client.count).toBe(1);
    expect(byType.commandes_sans_am.count).toBe(1);
  });
  it("opps actives sans D Prev / sans montant (gagnées exclues)", () => {
    expect(byType.opps_sans_dprev.count).toBe(1); // DELTA (OMEGA gagnée exclue)
    expect(byType.opps_sans_montant.count).toBe(1);
  });
  it("opp GAGNÉE sans N° FP signalée (sévérité haute)", () => {
    expect(byType.opps_gagnees_sans_fp.count).toBe(1); // OMEGA (stage 6, pas de fp)
    expect(byType.opps_gagnees_sans_fp.severity).toBe("high");
  });
  it("factures sans échéance + BC/fiches incomplets", () => {
    expect(byType.factures_sans_echeance.count).toBe(2); // A2 + OR
    expect(byType.bc_sans_fp.count).toBe(1);
    expect(byType.fiches_sans_vente.count).toBe(1);
    // BC1 a un N° BC mais aucun montant XOF → BC émis à montant nul (fausse le solde fournisseur → HAUT).
    expect(byType.bc_montant_zero.count).toBe(1);
    expect(byType.bc_montant_zero.severity).toBe("high");
  });
  it("BC au N° FP INCONNU du carnet signalé (symétrie factures orphelines) [audit continuité]", () => {
    const ord = [{ fp: "FP/2026/1", cas: 100, yearPo: 2026, client: "ACME", am: "AM" }];
    const bc = [
      { fp: "FP/2026/1", supplier: "HDF", amountXof: 100, bcNumber: "BC1" }, // FP au carnet → OK
      { fp: "FP/2026/9", supplier: "DELL", amountXof: 200, bcNumber: "BC2" }, // FP renseigné mais INCONNU → signalé
      { fp: "", supplier: "X", bcNumber: "BC3" },                            // sans FP → bc_sans_fp, PAS bc_fp_inconnu
    ];
    const bt = Object.fromEntries(dataQuality(ord, [], [], bc, []).issues.map((i) => [i.type, i]));
    expect(bt.bc_fp_inconnu.count).toBe(1);          // seul BC2 (BC1 rattaché, BC3 sans FP)
    expect(bt.bc_fp_inconnu.severity).toBe("medium");
    expect(bt.bc_sans_fp.count).toBe(1);             // BC3 uniquement (aucun chevauchement des deux prédicats)
  });
  it("doublon BC « à un séparateur/casse près » détecté (N° BC canonique, audit Lot 4)", () => {
    const bc = [
      { fp: "FP/2026/1", supplier: "DELL", amountXof: 100, expenseType: "HW", bcNumber: "BC-001" }, // Excel
      { fp: "FP/2026/1", supplier: "DELL", amountXof: 100, expenseType: "HW", bcNumber: "BC 001" }, // ClickUp (espace)
      { fp: "FP/2026/1", supplier: "DELL", amountXof: 100, expenseType: "HW", bcNumber: "BC/2026/2" }, // autre BC → pas un doublon
    ];
    const bt = Object.fromEntries(dataQuality([{ fp: "FP/2026/1", cas: 100, yearPo: 2026, client: "C", am: "A" }], [], [], bc, []).issues.map((i) => [i.type, i]));
    expect(bt.bc_doublons.count).toBe(1); // « BC-001 » et « BC 001 » = même clé canonique → 1 groupe de doublon
  });
  it("commandes P&L au N° FP ILLISIBLE (rawOrders) → anomalie haute (CA autrement perdu)", () => {
    // Lignes P&L brutes : FP illisibles à CAS>0 doivent être signalées ; l'illisible sans CAS ou le FP
    // canonique valide ne le sont pas.
    const raw = [
      { fp: "FP/2024", client: "ACME", cas: 50000000 },   // séquence absente → illisible + CAS → signalé
      { fp: "FP/2024/0000", client: "X", cas: 10 },        // séquence factice → illisible → signalé
      { fp: "FP/2026/5", client: "OK", cas: 999 },         // canonique valide → NON signalé
      { fp: "n'importe quoi", client: "Y", cas: 0 },       // illisible mais CAS 0 → NON signalé (ligne vide)
    ];
    const qq = dataQuality([], [], [], [], [], undefined, [], [], raw);
    const bt = Object.fromEntries(qq.issues.map((i) => [i.type, i]));
    expect(bt.commandes_fp_illisible.count).toBe(2);
    expect(bt.commandes_fp_illisible.severity).toBe("high");
  });
  it("opp GAGNÉE avec FP mais SANS ligne P&L → à réconcilier (sévérité haute)", () => {
    // FP/2026/1 est une commande (P&L) ; FP/2026/8 ne l'est pas → réconciliation à faire.
    const q2 = dataQuality(
      [{ fp: "FP/2026/1", client: "ACME", cas: 1000, yearPo: 2026 }],
      [],
      [
        { fp: "FP/2026/1", client: "ACME", stage: 6, amount: 1000 }, // réconciliée → OK
        { fp: "FP/2026/8", client: "MTN", stage: 6, amount: 500 },   // sans P&L → signalée
      ],
      [], [],
    );
    const t = Object.fromEntries(q2.issues.map((i) => [i.type, i]));
    expect(t.opps_gagnees_sans_pnl.count).toBe(1);
    expect(t.opps_gagnees_sans_pnl.refs).toContain("FP/2026/8");
    expect(t.opps_gagnees_sans_pnl.severity).toBe("high");
  });
  it("am_invalide : AM purement numérique détecté", () => {
    const q3 = dataQuality(
      [{ fp: "FP/2026/1", client: "X", am: "35", yearPo: 2026 }, { fp: "FP/2026/2", client: "Y", am: "DATCHA", yearPo: 2026 }],
      [], [], [], [],
    );
    const t = Object.fromEntries(q3.issues.map((i) => [i.type, i]));
    expect(t.am_invalide.count).toBe(1);
    expect(t.am_invalide.refs).toContain("FP/2026/1");
    expect(t.am_invalide.severity).toBe("medium");
  });
  it("doublons probables (ré-import en delta) : opps + BC signalés, un seul par groupe", () => {
    const opps2 = [
      { client: "ACME", amount: 1000, stage: 3, am: "DATCHA", fp: "FP/2026/1", closingDate: "2026-05-01" },
      { client: "ACME", amount: 1000, stage: 3, am: "DATCHA", fp: "FP/2026/1", closingDate: "2026-05-01" }, // doublon exact
      { client: "BETA", amount: 500, stage: 2, am: "X", fp: "FP/2026/2", closingDate: "2026-06-01" }, // unique
    ];
    const bc2 = [
      { fp: "FP/2026/1", supplier: "HDF", amountXof: 100, expenseType: "MAT", bcNumber: "BC1" },
      { fp: "FP/2026/1", supplier: "HDF", amountXof: 100, expenseType: "MAT", bcNumber: "BC1" }, // doublon
      { fp: "FP/2026/3", supplier: "MTN", amountXof: 200, expenseType: "SVC", bcNumber: "BC2" }, // unique
    ];
    const q4 = dataQuality([], [], opps2, bc2, []);
    const t = Object.fromEntries(q4.issues.map((i) => [i.type, i]));
    expect(t.opps_doublons.count).toBe(1); // 1 groupe en doublon (ACME), signalé une fois
    expect(t.opps_doublons.severity).toBe("medium");
    expect(t.bc_doublons.count).toBe(1); // 1 groupe (BC1)
    expect(t.bc_doublons.severity).toBe("low");
  });
  it("pas de faux doublon quand la signature diffère ou est vide", () => {
    // Deux opps même client mais montants différents → pas doublon. Deux lignes toutes vides → clé vide, ignorées.
    const q5 = dataQuality(
      [],
      [],
      [{ client: "ACME", amount: 1000, stage: 3 }, { client: "ACME", amount: 2000, stage: 3 }],
      [{}, {}],
      [],
    );
    const t = Object.fromEntries(q5.issues.map((i) => [i.type, i]));
    expect(t.opps_doublons).toBeUndefined();
    expect(t.bc_doublons).toBeUndefined();
  });
  it("opportunités FANTÔMES (stale, retirées de LIVE) signalées en Qualité — non-destructif (I2)", () => {
    const ghosts = [{ fp: "FP/2026/9", client: "ZED", stage: 4 }, { fp: "FP/2026/10", client: "MTN", stage: 3 }];
    const q6 = dataQuality([], [], [], [], [], undefined, ghosts);
    const t = Object.fromEntries(q6.issues.map((i) => [i.type, i]));
    expect(t.opps_fantomes.count).toBe(2);
    expect(t.opps_fantomes.severity).toBe("low");
    expect(t.opps_fantomes.refs).toContain("FP/2026/9");
  });
  it("sans fantôme (param omis) → pas de signal opps_fantomes", () => {
    const t = Object.fromEntries(q.issues.map((i) => [i.type, i]));
    expect(t.opps_fantomes).toBeUndefined();
  });
  it("N° FP inconnu = FP CANONIQUE absent des commandes — pas de FAUX orphelins par formatage (rapport terrain)", () => {
    // Facture avec un FP formaté DIFFÉREMMENT de la commande (zéros de tête) et linked=false PÉRIMÉ :
    // elle EST rattachée (même FP canonique) → ne doit PAS être signalée « non rattachée ».
    const q8 = dataQuality(
      [{ fp: "FP/2021/4687", client: "ACME", cas: 10000, yearPo: 2021 }],
      [
        { numero: "JVEXO/2021/0001", fp: "FP/2021/04687", amountHt: 500, linked: false }, // zéro de tête → même FP
        { numero: "JVEXO/2021/0002", fp: "FP 2021 4687", amountHt: 500, linked: false },   // espaces → même FP
        { numero: "ORPHAN", fp: "FP/2099/1", amountHt: 100, linked: true },                // vraiment inconnu (linked périmé à true)
      ],
      [], [], [],
    );
    const t = Object.fromEntries(q8.issues.map((i) => [i.type, i]));
    expect(t.factures_orphelines.count).toBe(1);               // seulement ORPHAN (FP/2099/1)
    expect(t.factures_orphelines.refs).toContain("ORPHAN");
    expect(t.factures_orphelines.refs).not.toContain("JVEXO/2021/0001");
    // Surfacturation : Σ facturé (500+500=1000) par FP canonique — sous le CAS 10000 → pas de surfacturation.
    expect(t.surfacturation).toBeUndefined();
  });
  it("opportunités PÉRIMÉES par âge signalées en Qualité (medium) — règle source (Lot 7)", () => {
    const aged = [{ fp: "FP/2026/50", client: "ZED", stage: 3 }];
    const q7 = dataQuality([], [], [], [], [], undefined, [], aged);
    const t = Object.fromEntries(q7.issues.map((i) => [i.type, i]));
    expect(t.opps_agees.count).toBe(1);
    expect(t.opps_agees.severity).toBe("medium");
    expect(t.opps_agees.refs).toContain("FP/2026/50");
  });
  it("issues triées par sévérité (high avant medium avant low)", () => {
    const ranks = q.issues.map((i) => ({ high: 0, medium: 1, low: 2 }[i.severity]));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
  it("score de complétude borné [0,1] et counts renvoyés", () => {
    expect(q.score).toBeGreaterThanOrEqual(0);
    expect(q.score).toBeLessThanOrEqual(1);
    expect(q.counts.orders).toBe(3);
    expect(q.counts.invoices).toBe(3);
  });
});
