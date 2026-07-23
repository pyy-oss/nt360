// Test du domaine PUR des astreintes (mnt_). Validation + agrégation de la charge par fpKey. Aucun I/O.
import { describe, it, expect } from "vitest";
const { validateAstreinte, astreinteCostByFp, ASTREINTE_STATUTS } = require("../domain/mntAstreinte");

describe("validateAstreinte — normalisation & garde-fous", () => {
  const base = { fp: "FP/2026/12", montant: 300000, dateDebut: "2026-07-01", dateFin: "2026-07-07" };
  it("accepte une demande complète et normalise (montant entier, fp majuscule)", () => {
    const v = validateAstreinte({ ...base, fp: "fp/2026/12", montant: 300000.7, contratId: "c1", motif: "  week-end  " });
    expect(v.ok).toBe(true);
    expect(v.value.fp).toBe("FP/2026/12");
    expect(v.value.montant).toBe(300001);
    expect(v.value.contratId).toBe("c1");
    expect(v.value.motif).toBe("week-end");
  });
  it("rejette un N° FP invalide (placeholder / vide)", () => {
    expect(validateAstreinte({ ...base, fp: "" }).ok).toBe(false);
    expect(validateAstreinte({ ...base, fp: "FP/2026/0000" }).ok).toBe(false);
  });
  it("rejette un montant nul ou négatif", () => {
    expect(validateAstreinte({ ...base, montant: 0 }).ok).toBe(false);
    expect(validateAstreinte({ ...base, montant: -5 }).ok).toBe(false);
    expect(validateAstreinte({ ...base, montant: "abc" }).ok).toBe(false);
  });
  it("exige une période valide (dates ISO, fin ≥ début)", () => {
    expect(validateAstreinte({ ...base, dateDebut: "" }).ok).toBe(false);
    expect(validateAstreinte({ ...base, dateDebut: "2026-07-10", dateFin: "2026-07-07" }).ok).toBe(false);
    expect(validateAstreinte({ ...base, dateDebut: "01/07/2026" }).ok).toBe(false);
  });
  it("le contrat est optionnel (astreinte sur affaire sans contrat)", () => {
    const v = validateAstreinte(base);
    expect(v.ok).toBe(true);
    expect(v.value.contratId).toBe(null);
  });
});

describe("astreinteCostByFp — charge des astreintes VALIDÉES, par fpKey", () => {
  it("ne compte que les astreintes validee, agrège par clé canonique (zéros de tête)", () => {
    const m = astreinteCostByFp([
      { fp: "FP/2026/12", montant: 300000, statut: "validee" },
      { fp: "FP/2026/0012", montant: 100000, statut: "validee" }, // même affaire (fpKey) → cumulé
      { fp: "FP/2026/12", montant: 999999, statut: "en_attente" }, // pas encore validée → ignorée
      { fp: "FP/2026/12", montant: 999999, statut: "rejetee" },    // rejetée → ignorée
      { fp: "FP/2026/9", montant: 50000, statut: "validee" },
    ]);
    expect(m["FP/2026/12"]).toBe(400000);
    expect(m["FP/2026/9"]).toBe(50000);
  });
  it("ignore les FP invalides et rend un objet vide sur entrée vide", () => {
    expect(astreinteCostByFp([{ fp: "", montant: 1, statut: "validee" }])).toEqual({});
    expect(astreinteCostByFp([])).toEqual({});
    expect(astreinteCostByFp(null)).toEqual({});
  });
  it("expose les statuts attendus", () => {
    expect(ASTREINTE_STATUTS).toEqual(["en_attente", "validee", "rejetee"]);
  });
});
