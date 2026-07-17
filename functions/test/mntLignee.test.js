import { describe, it, expect } from "vitest";
const { ligneeNumber, clientLetters, designationOverlap, detectLignees, normalizeLigneeConfirmations } = require("../domain/mntLignee");

describe("mntLignee — numéro + normalisation (ADR-030)", () => {
  it("clientLetters : sans accents, MAJ, 4 lettres max, repli XXX", () => {
    expect(clientLetters("Abidjan Télécom")).toBe("ABID");
    expect(clientLetters("3I")).toBe("3I");
    expect(clientLetters("  ")).toBe("XXX");
  });
  it("ligneeNumber : AAAAMM + lettres ; suffixe -N si seq ≥ 2", () => {
    expect(ligneeNumber("ABI", "2022-01-01")).toBe("202201ABI");
    expect(ligneeNumber("ABI", "2022-01-15", 1)).toBe("202201ABI");
    expect(ligneeNumber("ABI", "2022-01-15", 2)).toBe("202201ABI-2");
  });
  it("designationOverlap : recouvrement de tokens (2 vides = neutre 1)", () => {
    expect(designationOverlap("", "")).toBe(1);
    expect(designationOverlap("Support applicatif SIRH", "")).toBe(0);
    expect(designationOverlap("Support applicatif SIRH", "Support applicatif SIRH")).toBe(1);
    expect(designationOverlap("Support applicatif SIRH", "Vente de matériel réseau")).toBe(0);
  });
});

describe("mntLignee — détection de lignées", () => {
  const base = (o) => ({ id: o.fp, client: "ABI", affaire: "Support applicatif SIRH", montantEngage: 3400000, ...o });
  it("chaîne un client dont les périodes s'enchaînent (adjacence + montant + désignation)", () => {
    const contrats = [
      base({ fp: "FP/2021/3800", dateDebut: "2022-01-01", dateFin: "2023-01-01" }),
      base({ fp: "FP/2022/6566", dateDebut: "2023-01-01", dateFin: "2024-01-01" }),
      base({ fp: "FP/2023/8149", dateDebut: "2024-01-01", dateFin: "2025-01-01" }),
    ];
    const { lignees } = detectLignees(contrats);
    expect(lignees).toHaveLength(1);
    expect(lignees[0]).toMatchObject({ numero: "202201ABI", count: 3, client: "ABI" });
    expect(lignees[0].contrats.map((c) => c.fp)).toEqual(["FP/2021/3800", "FP/2022/6566", "FP/2023/8149"]);
    expect(lignees[0].montantMoyen).toBe(3400000);
  });
  it("ne chaîne pas si le montant s'écarte trop (au-delà de la tolérance)", () => {
    const contrats = [
      base({ fp: "FP/2022/1", dateDebut: "2022-01-01", dateFin: "2023-01-01", montantEngage: 1000000 }),
      base({ fp: "FP/2023/2", dateDebut: "2023-01-01", dateFin: "2024-01-01", montantEngage: 9000000 }),
    ];
    expect(detectLignees(contrats).lignees).toHaveLength(0);
  });
  it("ne chaîne pas si les périodes ne sont pas adjacentes (trou > fenêtre)", () => {
    const contrats = [
      base({ fp: "FP/2020/1", dateDebut: "2020-01-01", dateFin: "2021-01-01" }),
      base({ fp: "FP/2024/2", dateDebut: "2024-06-01", dateFin: "2025-06-01" }),
    ];
    expect(detectLignees(contrats).lignees).toHaveLength(0);
  });
  it("suffixe -N : deux lignées du même client démarrant le même mois", () => {
    const contrats = [
      // lignée A (SIRH)
      { id: "a1", fp: "FP/2022/10", client: "ABI", affaire: "Support SIRH", montantEngage: 3000000, dateDebut: "2022-01-01", dateFin: "2023-01-01" },
      { id: "a2", fp: "FP/2023/11", client: "ABI", affaire: "Support SIRH", montantEngage: 3000000, dateDebut: "2023-01-01", dateFin: "2024-01-01" },
      // lignée B (hébergement), même client, même mois de départ, désignation + montant différents
      { id: "b1", fp: "FP/2022/20", client: "ABI", affaire: "Hebergement datacenter", montantEngage: 8000000, dateDebut: "2022-01-01", dateFin: "2023-01-01" },
      { id: "b2", fp: "FP/2023/21", client: "ABI", affaire: "Hebergement datacenter", montantEngage: 8000000, dateDebut: "2023-01-01", dateFin: "2024-01-01" },
    ];
    const nums = detectLignees(contrats).lignees.map((l) => l.numero).sort();
    expect(nums).toEqual(["202201ABI", "202201ABI-2"]);
  });
});

describe("mntLignee — re-validation IA", () => {
  const lignees = [{ numero: "202201ABI" }, { numero: "202201XYZ" }];
  it("garde les numéros connus confirmés true, borne la confiance", () => {
    const r = normalizeLigneeConfirmations([
      { numero: "202201ABI", isRenouvellement: true, confidence: 1.3, reason: "Même prestation reconduite" },
      { numero: "202201XYZ", isRenouvellement: false, confidence: 0.9 }, // rejeté (false)
      { numero: "202299ZZZ", isRenouvellement: true, confidence: 0.9 },  // rejeté (inconnu)
    ], lignees);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ numero: "202201ABI", confidence: 1 });
  });
});
