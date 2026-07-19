import { describe, it, expect } from "vitest";
import { trainingPlan } from "./parTraining";

// Plan de formation : constat (écarts de quota) → action (candidats à assigner).
describe("trainingPlan", () => {
  const partners = [{ id: "fortinet", certificationCatalog: [
    { id: "nse7", name: "NSE 7", competencyId: "secu-reseau" },
    { id: "nse4", name: "NSE 4", competencyId: "secu-reseau" },
  ] }];
  // Exigence : nse7 ≥ 2 titulaires ; 1 seul actif → il en manque 1.
  const quotas = [{ partnerId: "fortinet", name: "Fortinet", status: "non_compliant",
    coverage: [{ target: "nse7", minCount: 2, holders: 1, ok: false }] }];
  const certs = [
    { consultantId: "c1", consultantName: "Alice", partnerId: "fortinet", certificationCatalogId: "nse7", status: "active" }, // couvre déjà
    { consultantId: "c2", consultantName: "Bob", partnerId: "fortinet", certificationCatalogId: "nse4", status: "active" },   // engagé, ne couvre pas nse7
  ];
  const assigns = [{ consultantId: "c3", consultantName: "Carla", partnerId: "fortinet", certificationCatalogId: "nse4" }];

  it("propose de combler l'écart avec les ingénieurs engagés ne couvrant pas la cible", () => {
    const plan = trainingPlan(quotas, partners, certs, assigns);
    expect(plan).toHaveLength(1);
    const g = plan[0].gaps[0];
    expect(g.need).toBe(1);
    expect(g.assignCertId).toBe("nse7");
    const ids = g.candidates.map((c) => c.consultantId).sort();
    expect(ids).toEqual(["c2", "c3"]);        // Bob + Carla (engagés, ne couvrent pas nse7)
    expect(ids).not.toContain("c1");           // Alice couvre déjà → exclue
    expect(g.candidates.find((c) => c.consultantId === "c2")?.name).toBe("Bob");
  });

  it("cible une COMPÉTENCE → résout la 1re certif de catalogue de cette compétence", () => {
    const q = [{ partnerId: "fortinet", name: "Fortinet", status: "at_risk",
      coverage: [{ target: "secu-reseau", minCount: 3, holders: 2, ok: false }] }];
    const plan = trainingPlan(q, partners, certs, assigns);
    expect(plan[0].gaps[0].assignCertId).toBe("nse7"); // 1re certif de la compétence
    expect(plan[0].gaps[0].need).toBe(1);
  });

  it("ignore les partenaires conformes et les exigences couvertes", () => {
    const q = [
      { partnerId: "fortinet", name: "Fortinet", status: "on_track", coverage: [{ target: "nse7", minCount: 1, holders: 2, ok: true }] },
      { partnerId: "x", name: "X", status: "non_compliant", coverage: [{ target: "nse7", minCount: 1, holders: 1, ok: true }] },
    ];
    expect(trainingPlan(q, partners, certs, assigns)).toHaveLength(0);
  });
});
