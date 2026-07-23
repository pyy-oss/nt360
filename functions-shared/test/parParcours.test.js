import { describe, it, expect } from "vitest";
// PARCOURS de bout en bout du module Partenariats, AU NIVEAU DOMAINE (pur, sans émulateur) : référentiel
// → certification (expiration + statut à date) → couverture des quotas → alertes de renouvellement →
// bulletins d'Actualité → point d'historisation. Prouve la COHÉRENCE de la chaîne dérivée (un même signal
// se retrouve identique d'un bout à l'autre — invariant « même métrique = même nombre »). Lot P6.
const { validatePartner, computeExpiry } = require("../domain/parPartner");
const { validateCertification, computeCertStatus } = require("../domain/parCertification");
const { coverageAll } = require("../domain/parQuota");
const { certRenewalWatch, watchCounts } = require("../domain/parAlert");
const { parNews } = require("../domain/parNews");
const { parQuotaHistoryPoint } = require("../domain/parQuota");

const TODAY = "2026-07-18";

// Construit une certif « à date » comme le fait le recompute : expiry dérivé du catalogue, statut re-dérivé.
function makeCert({ consultantId, catalogId, competencyId, obtainedDate, validityMonths }) {
  const expiryDate = computeExpiry(obtainedDate, validityMonths);
  return { consultantId, partnerId: "fortinet", certificationCatalogId: catalogId, competencyId,
    obtainedDate, expiryDate, status: computeCertStatus(expiryDate, TODAY) };
}

describe("Partenariats — parcours domaine de bout en bout (Lot P6)", () => {
  // Référentiel : niveau « gold » exigeant 1 ingénieur porteur de la compétence « securite ».
  const partnerInput = {
    id: "Fortinet", name: "Fortinet", programName: "Engage",
    tiers: [{ id: "gold", name: "Gold", rank: 2 }],
    competencies: [{ id: "securite", name: "Sécurité réseau" }],
    certificationCatalog: [{ id: "nse7", competencyId: "securite", code: "NSE7", name: "NSE 7", level: "expert", validityMonths: 24 }],
    requirements: [{ tierId: "gold", certIdOrCompetencyId: "securite", minCount: 1 }],
  };

  it("référentiel valide + intègre (validatePartner accepte l'entrée bien formée)", () => {
    const v = validatePartner(partnerInput);
    expect(v.ok).toBe(true);
    expect(v.value.id).toBe("fortinet");
    expect(v.value.requirements[0]).toMatchObject({ tierId: "gold", certIdOrCompetencyId: "securite", minCount: 1 });
  });

  it("CONFORME : une certif active couvre le quota → on_track, aucun bulletin de non-conformité", () => {
    const partner = validatePartner(partnerInput).value;
    const cert = makeCert({ consultantId: "c1", catalogId: "nse7", competencyId: "securite", obtainedDate: "2025-06-01", validityMonths: 24 });
    expect(cert.status).toBe("active"); // expiry 2027-06 → loin

    const quotas = coverageAll([partner], { fortinet: [cert] });
    expect(quotas[0].status).toBe("on_track");

    const watch = certRenewalWatch([cert], TODAY);
    expect(watch).toHaveLength(0); // rien à renouveler

    const news = parNews({ quotas: { partners: quotas }, renouvellements: { counts: watchCounts(watch), total: watch.length }, relances: { counts: { late: 0 } } });
    expect(news.bulletins).toHaveLength(0);

    const point = parQuotaHistoryPoint({ quotas, renouvellements: { counts: watchCounts(watch), total: watch.length } });
    expect(point).toMatchObject({ conformes: 1, aRisque: 0, nonConformes: 0, total: 1, aRenouveler: 0, expirees: 0 });
  });

  it("NON CONFORME : la certif expire bientôt → sort de la couverture, bulletins cohérents de bout en bout", () => {
    const partner = validatePartner(partnerInput).value;
    // Obtenue il y a ~24 mois → expiry ~2026-06 → daysBetween ≤ 0 (expirée) ⇒ ne compte plus.
    const cert = makeCert({ consultantId: "c1", catalogId: "nse7", competencyId: "securite", obtainedDate: "2024-06-01", validityMonths: 24 });
    expect(cert.status).toBe("expired"); // expiry 2026-06-01 < TODAY

    const quotas = coverageAll([partner], { fortinet: [cert] });
    expect(quotas[0].status).toBe("non_compliant"); // 0 porteur actif < minCount 1

    const watch = certRenewalWatch([cert], TODAY);
    const wc = watchCounts(watch);
    expect(watch.length).toBe(1);
    expect(wc.expired).toBe(1);

    // La chaîne est cohérente : la MÊME expiration alimente le bulletin de non-conformité ET celui de
    // renouvellement expiré — un signal, deux vues, mêmes chiffres.
    const news = parNews({ quotas: { partners: quotas }, renouvellements: { counts: wc, total: watch.length }, relances: { counts: { late: 0 } } });
    const ids = news.bulletins.map((b) => b.id);
    expect(ids).toContain("par_partenaires_non_conformes");
    expect(ids).toContain("par_certifs_expirees");

    const point = parQuotaHistoryPoint({ quotas, renouvellements: { counts: wc, total: watch.length } });
    expect(point).toMatchObject({ conformes: 0, nonConformes: 1, total: 1, expirees: 1 });
  });

  it("validateCertification refuse une année d'obtention implausible (garde d'entrée de la chaîne)", () => {
    const bad = validateCertification({ consultantId: "c1", partnerId: "fortinet", certificationCatalogId: "nse7", obtainedDate: "1900-01-01" });
    expect(bad.ok).toBe(false);
  });
});
