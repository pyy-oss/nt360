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
  it("DSO borné à 999 j quand la cadence de facturation est infime devant l'encours", () => {
    // Gros encours ANCIEN (hors fenêtre 365 j → n'alimente pas la cadence) + une facture récente
    // infime → ratio encours/cadence aberrant, plafonné à 999.
    const r3 = receivables([
      { client: "X", amountHt: 1_000_000, date: "2024-01-01", dueDate: "2024-02-01", paid: false }, // encours, hors 365j
      { client: "X", amountHt: 100, date: "2026-06-01", paid: true }, // seule facture récente → cadence infime
    ], "2026-07-01");
    expect(r3.dso).toBe(999);
  });
  it("échéance inconnue OU illisible → notDue (jamais comptée en retard)", () => {
    const r2 = receivables([
      { client: "NODATE", amountHt: 700, paid: false },                       // aucune date
      { client: "BADDATE", amountHt: 300, dueDate: "à définir", paid: false }, // échéance illisible (NaN)
    ], "2026-07-01");
    expect(r2.totalAR).toBe(1000);
    expect(r2.buckets.notDue).toBe(1000); // les deux → non exigibles
    expect(r2.overdue).toBe(0);           // aucune en retard
    expect(r2.buckets.b90p).toBe(0);      // pas de classement arbitraire en > 90 j
  });

  it("AVOIR (facture négative) NETTÉ par client dans l'AR — cohérent avec le CAF (audit cash HIGH)", () => {
    // Avant : le filtre `> 0` ignorait l'avoir → un client crédité semblait devoir le brut.
    const r = receivables([
      { client: "ACME", amountHt: 1000, dueDate: "2026-08-01", paid: false }, // créance
      { client: "ACME", amountHt: -300, date: "2026-06-01", paid: false },    // avoir à imputer
      { client: "MTN", amountHt: 500, dueDate: "2026-08-01", paid: false },
    ], "2026-07-01");
    expect(r.grossAR).toBe(1500);        // brut âgé inchangé (seaux)
    expect(r.avoirs).toBe(300);          // avoir imputé
    expect(r.totalAR).toBe(1200);        // NET = brut − avoir
    expect(r.topAR.find((c) => c.key === "ACME").value).toBe(700); // net par client
    expect(r.buckets.notDue).toBe(1500); // l'ancienneté reste sur les factures ouvertes réelles
  });

  it("AVOIR d'un client n'efface JAMAIS la dette d'un AUTRE (bornage par client)", () => {
    const r = receivables([
      { client: "ACME", amountHt: -900, date: "2026-06-01", paid: false }, // avoir > dette ACME
      { client: "ACME", amountHt: 200, dueDate: "2026-08-01", paid: false },
      { client: "MTN", amountHt: 500, dueDate: "2026-08-01", paid: false },
    ], "2026-07-01");
    expect(r.avoirs).toBe(200);   // borné à la dette ACME (200), pas 900
    expect(r.totalAR).toBe(500);  // MTN intacte ; ACME nette à 0
  });
});
