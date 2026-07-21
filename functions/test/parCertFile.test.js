import { describe, it, expect } from "vitest";
const { planCertFileImport, detectHeader, cellToIso, isHeldStatus } = require("../domain/parCertFile");

// Import des certifications par FICHIER utilisateur (PAR-L2) — plan PUR, aucune création de référentiel.
describe("parCertFile — plan d'import depuis un classeur", () => {
  const partners = [
    { id: "fortinet", name: "Fortinet", certificationCatalog: [
      { id: "nse7", code: "NSE7-SECOPS", name: "NSE 7 - Security Operations Architect", competencyId: "secops", level: "expert", validityMonths: 24 },
    ] },
    { id: "cisco", name: "Cisco Systems", certificationCatalog: [
      { id: "ccnp", code: "CCNP", name: "CCNP Enterprise", competencyId: "ent", level: "professional", validityMonths: 36 },
    ] },
  ];
  const consultants = [{ id: "c1", name: "Faissale YEO" }];

  it("détecte les en-têtes FR (accents/casse tolérés) et planifie détenue + assignation", () => {
    const aoa = [
      ["Ingénieur", "Constructeur", "Certification", "Statut", "Date d'obtention", "Échéance"],
      ["Faissale YEO", "Fortinet", "NSE7-SECOPS", "Obtenu", "2025-06-01", ""],
      ["Awa Sana", "Cisco Systems", "CCNP Enterprise", "À démarrer", "", "15/12/2026"],
    ];
    const plan = planCertFileImport(aoa, { consultants, partners });
    expect(plan.certs).toEqual([{ norm: "faissale yeo", name: "Faissale YEO", partnerId: "fortinet", catalogId: "nse7", obtainedDate: "2025-06-01" }]);
    expect(plan.assigns).toEqual([{ norm: "awa sana", name: "Awa Sana", partnerId: "cisco", catalogId: "ccnp", targetDate: "2026-12-15" }]);
    expect(plan.needConsultants).toEqual([{ name: "Awa Sana", norm: "awa sana" }]); // absente de l'annuaire
    expect(plan.skipped).toEqual([]);
  });

  it("résout le partenaire par nom normalisé et la certif par libellé ; détenue sans date → rétro-calcul de l'échéance", () => {
    const aoa = [
      ["Consultant", "Partenaire", "Certif", "Statut", "Échéance"],
      ["Faissale YEO", "CISCO  SYSTEMS", "ccnp enterprise", "✅ Complété", "2027-01-31"],
    ];
    const plan = planCertFileImport(aoa, { consultants, partners });
    expect(plan.certs[0]).toMatchObject({ partnerId: "cisco", catalogId: "ccnp", obtainedDate: "2024-01-31" }); // échéance − 36 mois
  });

  it("écarte (jamais deviné) : constructeur inconnu, certif hors catalogue, ingénieur non nommé, ligne sans date ni statut", () => {
    const aoa = [
      ["Ingénieur", "Constructeur", "Certification", "Statut", "Échéance"],
      ["Faissale YEO", "HPE", "CCNP", "Obtenu", "2026-12-01"],           // constructeur hors référentiel
      ["Faissale YEO", "Cisco", "CCIE", "Obtenu", "2026-12-01"],         // certif absente du catalogue
      ["adjibrine", "Cisco", "CCNP", "Obtenu", "2026-12-01"],            // identifiant de compte (pas prénom+nom)
      ["Awa Sana", "Cisco", "CCNP", "", ""],                             // ni statut ni date
    ];
    const plan = planCertFileImport(aoa, { consultants, partners });
    expect(plan.certs).toEqual([]);
    expect(plan.assigns).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      "constructeur inconnu du référentiel",
      "certification absente du catalogue du partenaire",
      "ingénieur non nommé (prénom + nom requis)",
      "statut indéterminable (ni statut reconnu, ni date)",
    ]);
  });

  it("sans en-têtes reconnaissables : erreur explicite (pas de plan vide silencieux)", () => {
    const plan = planCertFileImport([["a", "b"], ["c", "d"]], { consultants, partners });
    expect(plan.error).toContain("en-têtes introuvables");
  });

  it("cellToIso : Date exceljs, ISO, JJ/MM/AAAA ; isHeldStatus large", () => {
    expect(cellToIso(new Date("2026-03-15T00:00:00Z"))).toBe("2026-03-15");
    expect(cellToIso("2026-03-15")).toBe("2026-03-15");
    expect(cellToIso("15/03/2026")).toBe("2026-03-15");
    expect(cellToIso("mars 2026")).toBe(null);
    expect(isHeldStatus("✅ Complété")).toBe(true);
    expect(isHeldStatus("URGENT")).toBe(false);
    expect(isHeldStatus("")).toBe(null);
  });

  it("detectHeader : trouve l'en-tête au-delà de la 1re ligne (titre de feuille au-dessus)", () => {
    const h = detectHeader([["Suivi certifications 2026"], [], ["Nom", "Éditeur", "Certification"]]);
    expect(h).toMatchObject({ rowIndex: 2, cols: { engineer: 0, partner: 1, cert: 2 } });
  });
});
