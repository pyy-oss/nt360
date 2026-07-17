import { describe, it, expect } from "vitest";
const { validateMntContrat, validateEngagement, STATUTS, TYPES_MAINTENANCE } = require("../domain/mntContrat");

const base = {
  fp: "FP/2026/7", client: "ACME", statut: "actif", echeanceType: "mensuel",
  dateDebut: "2026-01-01", dateFin: "2026-12-31", montantEngage: 12000000, deviseEngage: "XOF",
};

describe("mntContrat — validation d'un contrat", () => {
  it("accepte un contrat bien formé et CANONICALISE le N° FP (fpKey)", () => {
    const v = validateMntContrat({ ...base, fp: "FP/2026/007" });
    expect(v.ok).toBe(true);
    expect(v.value.fp).toBe("FP/2026/7"); // zéros de tête normalisés (ADR-001, C11)
    expect(v.value.client).toBe("ACME");
  });
  it("rejette un N° FP invalide / placeholder", () => {
    expect(validateMntContrat({ ...base, fp: "" }).ok).toBe(false);
    expect(validateMntContrat({ ...base, fp: "FP/2026/0000" }).ok).toBe(false);
  });
  it("montant d'engagement arrondi à l'ENTIER XOF (pas de subdivision FCFA)", () => {
    expect(validateMntContrat({ ...base, montantEngage: 12000000.9 }).value.montantEngage).toBe(12000001);
    expect(validateMntContrat({ ...base, montantEngage: "" }).value.montantEngage).toBe(0); // absent → 0
  });
  it("REJETTE un montant négatif (format comptable) au lieu de le coercer à 0 (audit m1)", () => {
    expect(validateMntContrat({ ...base, montantEngage: -5 }).ok).toBe(false);
    expect(validateMntContrat({ ...base, montantEngage: "(1 200 000)" }).ok).toBe(false); // comptable → négatif
    expect(validateMntContrat({ ...base, montantEngage: "500000-" }).ok).toBe(false);
  });
  it("rejette un statut / une périodicité hors énumération", () => {
    expect(validateMntContrat({ ...base, statut: "en_cours" }).ok).toBe(false);
    expect(validateMntContrat({ ...base, echeanceType: "hebdo" }).ok).toBe(false);
    expect(STATUTS).toContain("actif");
  });
  it("rejette une date de fin ≤ à la date de début (couverture nulle interdite)", () => {
    expect(validateMntContrat({ ...base, dateDebut: "2026-06-01", dateFin: "2026-01-01" }).ok).toBe(false);
    expect(validateMntContrat({ ...base, dateDebut: "2026-06-01", dateFin: "2026-06-01" }).ok).toBe(false); // égalité rejetée
  });
  it("rejette une devise ≠ XOF, normalise la casse et le défaut (module à devise pivot, ADR-024)", () => {
    expect(validateMntContrat({ ...base, deviseEngage: "EUR" }).ok).toBe(false);
    expect(validateMntContrat({ ...base, deviseEngage: "xof" }).value.deviseEngage).toBe("XOF"); // casse normalisée
    expect(validateMntContrat({ ...base, deviseEngage: "" }).value.deviseEngage).toBe("XOF");    // défaut
  });
  it("accepte une date de fin absente (contrat sans échéance) mais rejette une date mal formée", () => {
    expect(validateMntContrat({ ...base, dateFin: "" }).ok).toBe(true);
    expect(validateMntContrat({ ...base, dateFin: "31/12/2026" }).ok).toBe(false); // format JJ/MM/AAAA refusé au stockage
  });
});

describe("mntContrat — objectifs de maintenance par type (ADR-025)", () => {
  it("les quatre types de maintenance sont définis", () => {
    expect(TYPES_MAINTENANCE).toEqual(["predictive", "corrective", "evolutive", "veille"]);
  });
  it("normalise les objectifs renseignés en entiers ≥ 0 et ignore les clés vides", () => {
    const v = validateMntContrat({ ...base, objectifsMaintenance: { predictive: "3", corrective: 5.7, evolutive: "", veille: 0 } });
    expect(v.ok).toBe(true);
    expect(v.value.objectifsMaintenance).toEqual({ predictive: 3, corrective: 6, veille: 0 }); // evolutive vide → absent
  });
  it("objectifs absents → null (pas d'objectif de maintenance)", () => {
    expect(validateMntContrat({ ...base }).value.objectifsMaintenance).toBeNull();
    expect(validateMntContrat({ ...base, objectifsMaintenance: {} }).value.objectifsMaintenance).toBeNull();
  });
  it("rejette un objectif négatif (pas de coercion silencieuse)", () => {
    expect(validateMntContrat({ ...base, objectifsMaintenance: { corrective: -2 } }).ok).toBe(false);
  });
});

describe("mntContrat — engagements SLA embarqués", () => {
  it("valide et normalise un engagement (seuil entier > 0, quota optionnel)", () => {
    const v = validateEngagement({ type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: 8.4, quota: "10" });
    expect(v.ok).toBe(true);
    expect(v.value).toEqual({ type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: 8, quota: 10 });
  });
  it("rejette un engagement à type / couverture / seuil invalide", () => {
    expect(validateEngagement({ type: "x", couverture: "ouvre_lun_ven", seuilHeures: 4 }).ok).toBe(false);
    expect(validateEngagement({ type: "resolution", couverture: "x", seuilHeures: 4 }).ok).toBe(false);
    expect(validateEngagement({ type: "resolution", couverture: "h24", seuilHeures: 0 }).ok).toBe(false);
  });
  it("propage l'erreur d'un engagement invalide au niveau du contrat", () => {
    const v = validateMntContrat({ ...base, engagements: [{ type: "resolution", couverture: "h24", seuilHeures: 4 }, { type: "bad" }] });
    expect(v.ok).toBe(false);
  });
  it("un contrat sans engagement est valide (tableau vide)", () => {
    expect(validateMntContrat({ ...base, engagements: [] }).value.engagements).toEqual([]);
  });
});
