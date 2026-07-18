import { describe, it, expect } from "vitest";
const { coverageForPartner, partnershipQuotaStatus, coverageAll, parQuotaHistoryPoint } = require("../domain/parQuota");

describe("parQuota — couverture des quotas", () => {
  const partner = {
    id: "fortinet", name: "Fortinet",
    requirements: [
      { tierId: "advanced", certIdOrCompetencyId: "fortinet-nse4", minCount: 2 },
      { tierId: "advanced", certIdOrCompetencyId: "secure-networking", minCount: 1 }, // par compétence
    ],
  };
  const certs = [
    { consultantId: "a", certificationCatalogId: "fortinet-nse4", competencyId: "secure-networking", status: "active" },
    { consultantId: "b", certificationCatalogId: "fortinet-nse4", competencyId: "secure-networking", status: "active" },
    { consultantId: "c", certificationCatalogId: "fortinet-nse7", competencyId: "secure-networking", status: "expiring_soon" }, // pas active
  ];

  it("compte les détenteurs DISTINCTS actifs, par certif précise OU par compétence", () => {
    const cov = coverageForPartner(partner, certs);
    expect(cov[0]).toMatchObject({ target: "fortinet-nse4", minCount: 2, holders: 2, ok: true });
    // compétence secure-networking : a + b actifs (c est expiring_soon → exclu) → 2 ≥ 1
    expect(cov[1]).toMatchObject({ target: "secure-networking", minCount: 1, holders: 2, ok: true });
  });

  it("une certif non active ne compte pas dans la couverture", () => {
    const cov = coverageForPartner(partner, [{ consultantId: "a", certificationCatalogId: "fortinet-nse4", status: "expired" }]);
    expect(cov[0]).toMatchObject({ holders: 0, ok: false });
  });

  it("dédoublonne un même consultant détenant deux fois la cible", () => {
    const dup = [
      { consultantId: "a", certificationCatalogId: "fortinet-nse4", status: "active" },
      { consultantId: "a", certificationCatalogId: "fortinet-nse4", status: "active" },
    ];
    const cov = coverageForPartner({ requirements: [{ tierId: "advanced", certIdOrCompetencyId: "fortinet-nse4", minCount: 2 }] }, dup);
    expect(cov[0]).toMatchObject({ holders: 1, ok: false }); // 1 personne distincte, pas 2
  });

  it("partnershipQuotaStatus : on_track / at_risk / non_compliant / non_evalue", () => {
    expect(partnershipQuotaStatus([{ ok: true }, { ok: true }])).toBe("on_track");
    expect(partnershipQuotaStatus([{ ok: true }, { ok: false }])).toBe("at_risk");
    expect(partnershipQuotaStatus([{ ok: false }])).toBe("non_compliant");
    expect(partnershipQuotaStatus([])).toBe("non_evalue");
  });

  it("coverageAll : agrège statut + gaps par partenaire", () => {
    const all = coverageAll([partner], { fortinet: certs });
    expect(all[0]).toMatchObject({ partnerId: "fortinet", status: "on_track" });
    expect(all[0].gaps).toEqual([]);
  });

  it("parQuotaHistoryPoint : compte les statuts + renouvellements/expirées (Lot P3)", () => {
    const quotas = [
      { status: "on_track" }, { status: "on_track" }, { status: "at_risk" }, { status: "non_compliant" }, { status: "non_evalue" },
    ];
    const p = parQuotaHistoryPoint({ quotas, renouvellements: { counts: { expired: 2 }, total: 5 } });
    expect(p).toEqual({ conformes: 2, aRisque: 1, nonConformes: 1, nonEvalue: 1, total: 5, aRenouveler: 5, expirees: 2 });
    // tolère quotas sous forme { partners } et arguments absents
    expect(parQuotaHistoryPoint({ quotas: { partners: [{ status: "on_track" }] } }).conformes).toBe(1);
    expect(parQuotaHistoryPoint()).toEqual({ conformes: 0, aRisque: 0, nonConformes: 0, nonEvalue: 0, total: 0, aRenouveler: 0, expirees: 0 });
  });
});
