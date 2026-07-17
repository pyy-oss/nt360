// Test de COHÉRENCE inter-panneaux : le Centre d'alertes et le cockpit Qualité affichent les mêmes
// métriques (surfacturation, factures non rattachées). Divergence observée en prod (61 vs 65
// surfacturées, 364 vs 72 non rattachées) : gates de recalcul divergents + drapeau `linked` persisté
// obsolète. Ces prédicats DOIVENT compter à l'identique sur des entrées identiques — sinon deux
// panneaux affichent deux vérités. Ce test verrouille la parité au niveau domaine (indépendamment du
// recalcul) : si un prédicat dérive, il casse ici plutôt qu'en prod.
import { describe, it, expect } from "vitest";
const { alerts } = require("../domain/alerts");
const { dataQuality } = require("../domain/dataQuality");

// Jeu d'essai : commandes avec CAS, factures qui surfacturent certaines, factures orphelines (FP hors
// carnet), FP formaté différemment (zéros de tête) pour exercer la canonicalisation fpKey partagée.
const orders = [
  { fp: "FP/2021/0001", cas: 100, client: "A", am: "X", yearPo: 2021 }, // surfacturée (facturé 130 > 100)
  { fp: "FP/2021/2", cas: 200, client: "B", am: "Y", yearPo: 2021 },     // OK (facturé 150 < 200)
  { fp: "FP/2022/10", cas: 50, client: "C", am: "Z", yearPo: 2022 },     // surfacturée (facturé 80 > 50)
];
const invoices = [
  { numero: "F1", fp: "FP/2021/1", amountHt: 130, date: "2021-06-01" },  // zéros de tête ≠ order → même clé
  { numero: "F2", fp: "FP/2021/2", amountHt: 150, date: "2021-06-01" },
  { numero: "F3", fp: "FP/2022/10", amountHt: 80, date: "2022-06-01" },
  { numero: "F4", fp: "FP/9999/999", amountHt: 40, date: "2022-06-01" }, // orpheline (FP hors carnet)
  { numero: "F5", fp: "", amountHt: 10, date: "2022-06-01" },            // orpheline (FP absent)
];

const countOf = (arr, type) => { const x = arr.find((a) => a.type === type); return x ? x.count : 0; };

describe("cohérence Alertes ↔ Qualité (mêmes entrées → mêmes comptes)", () => {
  const al = alerts(orders, invoices, { rows: [] }, [], 2022, "2022-12-31", [], null);
  const dq = dataQuality(orders, invoices, [], [], [], null, [], [], orders).issues;

  it("surfacturation : compte identique des deux côtés", () => {
    const a = countOf(al, "surfacturation");
    const d = countOf(dq, "surfacturation");
    expect(a).toBe(2);   // FP/2021/1 (130>100) + FP/2022/10 (80>50)
    expect(a).toBe(d);   // parité stricte
  });

  it("factures non rattachées : compte identique des deux côtés", () => {
    const a = countOf(al, "factures_non_rattachees"); // libellé alerte
    const d = countOf(dq, "factures_orphelines");     // libellé qualité (même population)
    expect(a).toBe(2);   // FP/9999/999 + FP vide
    expect(a).toBe(d);   // parité stricte
  });
});

// Cohérence AMONT (opportunité ↔ commande) — Lot A : les nouveaux prédicats « écart de valorisation » et
// « opp active sur FP déjà au carnet » DOIVENT compter à l'identique dans le Centre d'alertes et la Qualité.
describe("cohérence AMONT Alertes ↔ Qualité (écart valorisation + opp sur FP carnet)", () => {
  // Commandes FUSIONNÉES (portent casPnl + source, comme la sortie de mergeCommandes).
  const ordersAmont = [
    { fp: "FP/2026/1", cas: 800, casPnl: 500, source: "opp_won", client: "A", am: "X", yearPo: 2026 }, // écart 800 vs 500 = 60 % > 30 %
    { fp: "FP/2026/2", cas: 520, casPnl: 500, source: "fiche", client: "B", am: "Y", yearPo: 2026 },   // écart 4 % < 30 % → non
    { fp: "FP/2026/3", cas: 500, casPnl: 500, source: "pnl", client: "C", am: "Z", yearPo: 2026 },     // pas d'écrasement → non
  ];
  const oppsAmont = [
    { fp: "FP/2026/1", stage: 3, amount: 100, closingDate: "2027-01-01" }, // ACTIVE sur un FP au carnet → signalée
    { fp: "FP/2026/9", stage: 3, amount: 100, closingDate: "2027-01-01" }, // active hors carnet → non
    { fp: "FP/2026/1", stage: 6, amount: 800, closingDate: "2026-01-01" }, // gagnée → hors périmètre « active »
  ];
  const al2 = alerts(ordersAmont, [], { rows: [] }, [], 2026, "2026-12-31", oppsAmont, null);
  const dq2 = dataQuality(ordersAmont, [], oppsAmont, [], [], null, [], [], ordersAmont).issues;

  it("écart de valorisation : un seul, compté à l'identique des deux côtés", () => {
    const a = countOf(al2, "ecart_valorisation");
    const d = countOf(dq2, "ecart_valorisation");
    expect(a).toBe(1);   // FP/2026/1 uniquement
    expect(a).toBe(d);
  });
  it("opp active sur FP déjà au carnet : une seule, comptée à l'identique", () => {
    const a = countOf(al2, "opp_active_carnet");
    const d = countOf(dq2, "opp_active_carnet");
    expect(a).toBe(1);   // l'opp stage 3 sur FP/2026/1 (au carnet)
    expect(a).toBe(d);
  });
});
