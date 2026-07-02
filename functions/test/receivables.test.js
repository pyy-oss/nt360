import { describe, it, expect } from "vitest";
const { receivables } = require("../domain/receivables");

describe("receivables — aging + DSO", () => {
  const INV = [
    { client: "ACME", amountHt: 1000, date: "2026-05-01", dueDate: "2026-05-31", paid: false }, // échéance passée (asOf 2026-07-01) 31j → 31-60
    { client: "ACME", amountHt: 500, date: "2026-06-20", dueDate: "2026-07-20", paid: false },  // pas encore échue
    { client: "BETA", amountHt: 2000, date: "2026-01-01", dueDate: "2026-02-01", paid: false }, // >90j
    { client: "GAMMA", amountHt: 9999, date: "2026-06-01", dueDate: "2026-06-15", paid: true }, // encaissée → exclue
  ];
  const r = receivables(INV, "2026-07-01");

  it("exclut les factures encaissées", () => {
    expect(r.openCount).toBe(3);
    expect(r.totalAR).toBe(3500); // 1000 + 500 + 2000
  });
  it("balance âgée par ancienneté d'échéance", () => {
    expect(r.buckets.notDue).toBe(500);   // échéance 2026-07-20 (future)
    expect(r.buckets.b31_60).toBe(1000);  // 31 jours de retard
    expect(r.buckets.b90p).toBe(2000);    // > 90 jours
    expect(r.overdue).toBe(3000);
    expect(r.overdueCount).toBe(2);
  });
  it("top créances par client", () => {
    expect(r.topAR[0]).toEqual({ key: "BETA", value: 2000 });
  });
  it("DSO indicatif calculé (> 0)", () => {
    expect(r.dso).toBeGreaterThan(0);
  });
});
