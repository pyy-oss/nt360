import { describe, it, expect } from "vitest";
const { alertBucket, certRenewalWatch, watchCounts, ALERT_THRESHOLDS_DAYS } = require("../domain/parAlert");

describe("parAlert — cycle de vie des certifications", () => {
  it("paliers demandés J-90/60/30/7/0", () => {
    expect(ALERT_THRESHOLDS_DAYS).toEqual([90, 60, 30, 7, 0]);
  });

  it("alertBucket : classe l'urgence par seuil le plus serré", () => {
    expect(alertBucket(-3)).toBe("expired");
    expect(alertBucket(0)).toBe("expired");
    expect(alertBucket(5)).toBe("j7");
    expect(alertBucket(7)).toBe("j7");
    expect(alertBucket(20)).toBe("j30");
    expect(alertBucket(45)).toBe("j60");
    expect(alertBucket(80)).toBe("j90");
    expect(alertBucket(120)).toBe(null); // au-delà de 90 j : pas d'alerte
  });

  it("certRenewalWatch : ne retient que les certifs ≤ 90 j (ou expirées), triées par urgence", () => {
    const certs = [
      { id: "1", consultantId: "a", partnerId: "fortinet", certName: "NSE4", expiryDate: "2026-08-01" }, // ~14 j depuis today
      { id: "2", consultantId: "b", partnerId: "cisco", certName: "CCNA", expiryDate: "2027-01-01" },    // lointain → exclu
      { id: "3", consultantId: "c", partnerId: "dell", certName: "DCC", expiryDate: "2026-07-01" },      // expirée
    ];
    const items = certRenewalWatch(certs, "2026-07-18");
    expect(items.map((i) => i.id)).toEqual(["3", "1"]); // expirée d'abord (daysLeft négatif), NSE4 ensuite
    expect(items[0].bucket).toBe("expired");
    expect(items[1].bucket).toBe("j30");
  });

  it("ignore une certif sans date d'expiration", () => {
    expect(certRenewalWatch([{ id: "x", expiryDate: null }], "2026-07-18")).toEqual([]);
  });

  it("certRenewalWatch : remonte le managerUid dénormalisé (PA4 — relance au manager)", () => {
    const items = certRenewalWatch([{ id: "1", consultantId: "a", expiryDate: "2026-08-01", managerUid: "mgr-1" }, { id: "2", consultantId: "b", expiryDate: "2026-08-02" }], "2026-07-18");
    expect(items.find((i) => i.id === "1").managerUid).toBe("mgr-1");
    expect(items.find((i) => i.id === "2").managerUid).toBe(null); // pas de manager → null (digest direction)
  });

  it("watchCounts : compte par palier", () => {
    const items = [{ bucket: "expired" }, { bucket: "j7" }, { bucket: "j7" }, { bucket: "j90" }];
    expect(watchCounts(items)).toEqual({ expired: 1, j7: 2, j30: 0, j60: 0, j90: 1 });
  });
});

// Renouvellement du PARTENARIAT lui-même (PAR-P4) : fenêtres J-90/60/30 sur renewalDate du référentiel.
describe("parAlert — partnerRenewalWatch (renouvellement du partenariat)", () => {
  const { partnerRenewalWatch } = require("../domain/parAlert");

  it("classe par fenêtre J-90/60/30 + échu, trié par urgence ; pas de palier J-7", () => {
    const items = partnerRenewalWatch([
      { id: "cisco", name: "Cisco", renewalDate: "2026-07-25" },      // 7 j → j30 (pas de palier j7)
      { id: "dell", name: "Dell", renewalDate: "2026-09-01" },        // 44 j → j60
      { id: "hpe", name: "HPE", renewalDate: "2026-10-10" },          // 83 j → j90
      { id: "f5", name: "F5", renewalDate: "2026-07-01" },            // échu
      { id: "far", name: "Loin", renewalDate: "2026-12-31" },         // > 90 j → hors liste
    ], "2026-07-18");
    expect(items.map((i) => i.id)).toEqual(["f5", "cisco", "dell", "hpe"]); // urgence croissante
    expect(items.map((i) => i.bucket)).toEqual(["expired", "j30", "j60", "j90"]);
  });

  it("ignore un partenaire sans renewalDate (échéance inconnue ≠ échue)", () => {
    expect(partnerRenewalWatch([{ id: "x", name: "X" }], "2026-07-18")).toEqual([]);
  });

  it("watchCounts fonctionne sur ses paliers (sous-ensemble des paliers certifs)", () => {
    const items = partnerRenewalWatch([{ id: "a", renewalDate: "2026-07-01" }, { id: "b", renewalDate: "2026-08-01" }], "2026-07-18");
    expect(watchCounts(items)).toEqual({ expired: 1, j7: 0, j30: 1, j60: 0, j90: 0 });
  });
});
