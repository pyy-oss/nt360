// Alerte de COHÉRENCE AMONT (coût) — audit BC/DC × rentabilité : les BC RÉELS émis sur une affaire
// (Σ bcCostByFp, tous statuts) qui dépassent le coût PLANIFIÉ du carnet (costTotal, fiche/P&L) sont
// une dérive d'achat DÉJÀ COMMANDÉE, invisible de la marge carnet tant que la fiche n'est pas à jour.
import { describe, it, expect } from "vitest";
const { alerts } = require("../domain/alerts");

const sup = { rows: [] };

describe("achat_bc_sup_planifie — BC émis > coût planifié du carnet", () => {
  const orders = [
    { fp: "FP/2026/1", cas: 10_000, costTotal: 5_000 },  // Σ BC 6 000 > 5 000 → alerte
    { fp: "FP/2026/2", cas: 10_000, costTotal: 5_000 },  // Σ BC 4 000 ≤ 5 000 → non
    { fp: "FP/2026/3", cas: 10_000 },                    // costTotal ABSENT → pas de référence → non
  ];
  const bcLines = [
    { fp: "FP/2026/0001", amountXof: 2_000, status: "emis" },   // graphie ≠ : fpKey fusionne
    { fp: "FP/2026/1", amountXof: 4_000, status: "solde" },     // BC PAYÉ = toujours un coût
    { fp: "FP/2026/2", amountXof: 4_000, status: "facture" },
    { fp: "FP/2026/3", amountXof: 99_000, status: "emis" },     // planifié inconnu → jamais d'alerte
  ];
  it("alerte high/margin quand Σ BC réels (fpKey, tous statuts) > costTotal connu", () => {
    const al = alerts(orders, [], sup, bcLines, 2026, "2026-07-21", [], null);
    const a = al.find((x) => x.type === "achat_bc_sup_planifie");
    expect(a).toBeTruthy();
    expect(a.severity).toBe("high");
    expect(a.margin).toBe(true); // costTotal confidentiel → summaries/alertsMargin (droit rentabilite)
    expect(a.count).toBe(1);
    expect(a.refs).toEqual(["FP/2026/1"]);
  });
  it("les achats PLANIFIÉS de fiche (source « fiche ») ne comptent pas — sinon le planifié se comparerait à lui-même", () => {
    const planned = [{ fp: "FP/2026/1", amountXof: 50_000, status: "a_emettre", source: "fiche" }];
    const al = alerts(orders.slice(0, 1), [], sup, planned, 2026, "2026-07-21", [], null);
    expect(al.find((x) => x.type === "achat_bc_sup_planifie")).toBeFalsy();
  });
});

// ADR-068 — BC « annulé » : ni en attente, ni en retard, ni dans l'engagé de l'alerte amont.
describe("statut annule — hors bc_en_attente / bc_en_retard / achat_bc_sup_planifie (ADR-068)", () => {
  it("un BC annulé ne compte ni en attente ni en retard (ETA dépassée ignorée)", () => {
    const bcLines = [
      { bcNumber: "BC1", amountXof: 1_000, status: "annule", etaContrat: "2026-01-01" },
      { bcNumber: "BC2", amountXof: 1_000, status: "emis", etaContrat: "2026-01-01" }, // témoin
    ];
    const al = alerts([], [], sup, bcLines, 2026, "2026-07-21", [], null);
    expect(al.find((x) => x.type === "bc_en_attente").count).toBe(1);
    expect(al.find((x) => x.type === "bc_en_retard").count).toBe(1);
  });
  it("un BC annulé ne déclenche pas achat_bc_sup_planifie (plus un achat de l'affaire)", () => {
    const orders2 = [{ fp: "FP/2026/1", cas: 10_000, costTotal: 5_000 }];
    const bcLines = [{ fp: "FP/2026/1", amountXof: 9_000, status: "annule" }];
    const al = alerts(orders2, [], sup, bcLines, 2026, "2026-07-21", [], null);
    expect(al.find((x) => x.type === "achat_bc_sup_planifie")).toBeFalsy();
  });
});
