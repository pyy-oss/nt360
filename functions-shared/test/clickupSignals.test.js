import { describe, it, expect } from "vitest";
const { clickupSignals, isActive, isDeliveryOverdue, clickupDelays, daysDiff } = require("../domain/clickupSignals");

describe("isDeliveryOverdue — prédicat partagé (cohérent enrich ↔ cockpit Qualité)", () => {
  const today = "2026-06-01";
  it("actif (0-/1-/3-) + date contractuelle passée → en retard", () => {
    expect(isDeliveryOverdue("3-en cours - deploiement", "2026-05-01", today)).toBe(true);
    expect(isDeliveryOverdue("0-affecte", "2026-05-31", today)).toBe(true);
  });
  it("facturé / clôturé / livré → JAMAIS en retard (même si date passée)", () => {
    expect(isDeliveryOverdue("5-facturé - attente df", "2026-01-01", today)).toBe(false);
    expect(isDeliveryOverdue("9-clôturé", "2026-01-01", today)).toBe(false);
    expect(isDeliveryOverdue("4-terminé", "2026-01-01", today)).toBe(false);
  });
  it("date future ou absente → pas en retard", () => {
    expect(isDeliveryOverdue("3-en cours", "2026-12-01", today)).toBe(false);
    expect(isDeliveryOverdue("3-en cours", null, today)).toBe(false);
  });
});

const safeId = (fp) => String(fp || "").replace(/[^a-z0-9]/gi, "_");
const ms = (iso) => new Date(iso + "T00:00:00Z").getTime();

describe("isActive — statut projet encore actif (pas livré)", () => {
  it("0/1/3 = actif ; 4/5/8/9/termine = non", () => {
    expect(isActive("0-affecte")).toBe(true);
    expect(isActive("1-prise en charge")).toBe(true);
    expect(isActive("3-en cours - deploiement")).toBe(true);
    expect(isActive("4-terminé - pv/bl signé")).toBe(false);
    expect(isActive("5-facturé - attente df")).toBe(false);
    expect(isActive("9-cloture")).toBe(false);
    expect(isActive("termine")).toBe(false);
  });
});

describe("clickupSignals — retard de livraison + incohérences", () => {
  const asOf = "2026-07-06";
  it("retard de livraison : date contractuelle dépassée + statut actif", () => {
    const orders = [{ fp: "FP/1", client: "A", raf: 10 }, { fp: "FP/2", client: "B", raf: 0 }];
    const sync = {
      [safeId("FP/1")]: { status: "3-en cours - deploiement", dateContractuelle: ms("2026-06-01") }, // dépassé + actif → retard
      [safeId("FP/2")]: { status: "3-en cours - production", dateContractuelle: ms("2026-08-01") }, // futur → pas de retard
    };
    const r = clickupSignals(orders, sync, safeId, asOf);
    expect(r.overdueCount).toBe(1);
    expect(r.overdueRefs).toEqual(["FP/1"]);
  });
  it("pas de retard si statut déjà livré/facturé même date dépassée", () => {
    const orders = [{ fp: "FP/3", client: "C" }];
    const sync = { [safeId("FP/3")]: { status: "5-facturé - attente df", dateContractuelle: ms("2026-01-01") } };
    expect(clickupSignals(orders, sync, safeId, asOf).overdueCount).toBe(0);
  });
  it("incohérence : ClickUp facturé mais CAF app = 0", () => {
    const orders = [{ fp: "FP/4", facture: 0 }];
    const sync = { [safeId("FP/4")]: { status: "5-facturé - prestations en cours" } };
    const r = clickupSignals(orders, sync, safeId, asOf);
    expect(r.issues.find((i) => i.type === "clickup_facture_sans_caf").count).toBe(1);
  });
  it("incohérence : clôturé mais RAF non nul", () => {
    const orders = [{ fp: "FP/5", raf: 5000 }];
    const sync = { [safeId("FP/5")]: { status: "9-cloture" } };
    const r = clickupSignals(orders, sync, safeId, asOf);
    expect(r.issues.find((i) => i.type === "clickup_cloture_avec_raf").count).toBe(1);
  });
  it("commande sans synchro ClickUp → ignorée", () => {
    const r = clickupSignals([{ fp: "FP/6", raf: 9 }], {}, safeId, asOf);
    expect(r.overdueCount).toBe(0);
    expect(r.issues).toEqual([]);
  });
});

describe("daysDiff", () => {
  it("écart en jours (b − a)", () => {
    expect(daysDiff("2026-06-01", "2026-07-06")).toBe(35);
    expect(daysDiff("2026-07-06", "2026-07-06")).toBe(0);
  });
});

describe("clickupDelays — délais par PM/statut + RAF échéancé", () => {
  const asOf = "2026-07-06";
  const orders = [
    { fp: "FP/1", raf: 100 }, // PM A, 3-en cours, contractuelle dépassée → retard 35 j ; fin prév. 2026-08
    { fp: "FP/2", raf: 200 }, // PM A, 3-en cours, contractuelle future → pas de retard ; fin prév. 2026-08
    { fp: "FP/3", raf: 50 },  // PM B, 5-facturé (non actif) → pas dans RAF échéancé
  ];
  const sync = {
    [safeId("FP/1")]: { status: "3-en cours - deploiement", dateContractuelle: ms("2026-06-01"), dateFinPrev: ms("2026-08-15") },
    [safeId("FP/2")]: { status: "3-en cours - production", dateContractuelle: ms("2026-09-01"), dateFinPrev: ms("2026-08-20") },
    [safeId("FP/3")]: { status: "5-facturé - attente df", dateContractuelle: ms("2026-01-01"), dateFinPrev: ms("2026-02-01") },
  };
  const pm = { [safeId("FP/1")]: "Alice", [safeId("FP/2")]: "Alice", [safeId("FP/3")]: "Bob" };

  it("par PM : actifs + en retard + retard moyen", () => {
    const d = clickupDelays(orders, sync, pm, safeId, asOf);
    const alice = d.byPm.find((x) => x.pm === "Alice");
    expect(alice.active).toBe(2);
    expect(alice.overdue).toBe(1);
    expect(alice.avgDaysLate).toBe(35);
    expect(d.overdueTotal).toBe(1);
  });
  it("RAF échéancé par mois : seuls les projets ACTIFS, groupés par date prév. fin", () => {
    const d = clickupDelays(orders, sync, pm, safeId, asOf);
    const aug = d.rafByMonth.find((x) => x.month === "2026-08");
    expect(aug.raf).toBe(300); // FP/1 (100) + FP/2 (200) ; FP/3 non actif exclu
    expect(aug.count).toBe(2);
  });
  it("par statut : distribution + en retard", () => {
    const d = clickupDelays(orders, sync, pm, safeId, asOf);
    const dep = d.byStatus.find((x) => x.status === "3-en cours - deploiement");
    expect(dep.count).toBe(1); expect(dep.overdue).toBe(1);
  });
});
