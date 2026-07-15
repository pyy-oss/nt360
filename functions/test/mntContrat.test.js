import { describe, it, expect } from "vitest";
const { validateMntContrat, validateEngagement, STATUTS } = require("../domain/mntContrat");

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
    expect(validateMntContrat({ ...base, montantEngage: -5 }).value.montantEngage).toBe(0);
  });
  it("rejette un statut / une périodicité hors énumération", () => {
    expect(validateMntContrat({ ...base, statut: "en_cours" }).ok).toBe(false);
    expect(validateMntContrat({ ...base, echeanceType: "hebdo" }).ok).toBe(false);
    expect(STATUTS).toContain("actif");
  });
  it("rejette une date de fin antérieure à la date de début", () => {
    expect(validateMntContrat({ ...base, dateDebut: "2026-06-01", dateFin: "2026-01-01" }).ok).toBe(false);
  });
  it("accepte une date de fin absente (contrat sans échéance) mais rejette une date mal formée", () => {
    expect(validateMntContrat({ ...base, dateFin: "" }).ok).toBe(true);
    expect(validateMntContrat({ ...base, dateFin: "31/12/2026" }).ok).toBe(false); // format JJ/MM/AAAA refusé au stockage
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
