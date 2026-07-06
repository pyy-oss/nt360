import { describe, it, expect } from "vitest";
const { clickupSignals, isActive } = require("../domain/clickupSignals");

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
