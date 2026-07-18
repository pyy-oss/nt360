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

  it("watchCounts : compte par palier", () => {
    const items = [{ bucket: "expired" }, { bucket: "j7" }, { bucket: "j7" }, { bucket: "j90" }];
    expect(watchCounts(items)).toEqual({ expired: 1, j7: 2, j30: 0, j60: 0, j90: 1 });
  });
});
