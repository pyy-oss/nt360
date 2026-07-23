import { describe, it, expect } from "vitest";
// FILET E2E (au niveau DOMAINE, pur, sans émulateur) du parcours CA constructeur du module Partenariats :
// activation du drapeau → import MIXTE (BC dérivés + déclaratif) → mapping fournisseur MULTI-CONSTRUCTEUR
// (répartition pondérée) → suggestion IA du rattachement (proposée, re-validée) → CA cohérent BOUT-EN-BOUT.
// Prouve l'invariant fort « une même métrique calculée à deux endroits donne le même nombre » (le CA par
// partenaire dérivé de la chaîne BC/déclaratif se retrouve IDENTIQUE dans le snapshot IA). Lot PA+ 5.
const { isParEnabled } = require("../domain/parFeature");
const { normalizeSupplier, allocationsFor, revenueByPartner, blendRevenue } = require("../domain/parRevenue");
const { actionPlanSnapshot, qbrSnapshot, mapSuggestSnapshot, normalizeMapSuggest } = require("../domain/parAi");
const { ASSIGNMENT_STATUSES } = require("../domain/parAssignment");

// Reconstruit la forme summaries/par_ca comme aggregate.js : blendRevenue(BC, déclaratif) + ventilation.
function buildCaSummary(bcLines, map, declaredByPartner, nameById) {
  const { partners: bcPartners, unmapped } = revenueByPartner(bcLines, map);
  const byPartner = blendRevenue(bcPartners, declaredByPartner).map((g) => ({ ...g, name: nameById[g.partnerId] || g.partnerId }));
  const totalXof = byPartner.reduce((s, g) => s + g.revenueXof, 0);
  const bcXof = byPartner.reduce((s, g) => s + (g.source === "bc" ? g.revenueXof : 0), 0);
  return { asOf: "2026-07-19", byPartner, unmapped, totalXof, bcXof, declaredXof: totalXof - bcXof };
}

describe("Partenariats — filet E2E parcours CA (activation → import mixte → mapping → IA → cohérence)", () => {
  const nameById = { cisco: "Cisco", fortinet: "Fortinet", huawei: "Huawei" };
  // Un distributeur (HDF) porte DEUX marques 60/40 ; un fournisseur mono-marque (CISCO DIRECT) ; un
  // fournisseur non encore rattaché (MYSTERY DISTRIB). Montants XOF entiers (le FCFA n'a pas de subdivision).
  const bcLines = [
    { supplier: "HDF SAS", amountXof: 1_000_000 },       // → cisco 600k + fortinet 400k
    { supplier: "CISCO DIRECT", amountXof: 500_000 },     // → cisco 500k
    { supplier: "MYSTERY DISTRIB", amountXof: 300_000 },  // non mappé (à rattacher)
  ];
  const map = { "HDF SAS": { cisco: 60, fortinet: 40 }, "CISCO DIRECT": "cisco" };
  // Fortinet a un CA déclaratif MAIS des BC existent → BC prime (anti-double-compte). Huawei : déclaratif seul.
  const declared = { fortinet: 999_999, huawei: 200_000 };

  it("activation (ADR-P01) : drapeau éteint ⇒ pas de chaîne ; allumé ⇒ chaîne active", () => {
    expect(isParEnabled(undefined)).toBe(false);
    expect(isParEnabled({ enabled: false })).toBe(false);
    expect(isParEnabled({ enabled: true })).toBe(true);
  });

  it("mapping MULTI-CONSTRUCTEUR : le montant d'un BC distributeur est RÉPARTI, jamais additionné", () => {
    expect(allocationsFor(map["HDF SAS"])).toEqual([{ partnerId: "cisco", weight: 0.6 }, { partnerId: "fortinet", weight: 0.4 }]);
    const { partners } = revenueByPartner(bcLines, map);
    const byId = Object.fromEntries(partners.map((p) => [p.partnerId, p.revenueXof]));
    expect(byId.cisco).toBe(1_100_000);   // 600k (HDF) + 500k (CISCO DIRECT)
    expect(byId.fortinet).toBe(400_000);  // 400k (HDF)
    // Aucune perte ni double-compte : les parts mappées somment au montant mappé (1,5 M sur 1,5 M mappé).
    expect(byId.cisco + byId.fortinet).toBe(1_500_000);
  });

  it("import MIXTE : BC prime le déclaratif (fortinet) ; déclaratif comble seul (huawei)", () => {
    const ca = buildCaSummary(bcLines, map, declared, nameById);
    const byId = Object.fromEntries(ca.byPartner.map((g) => [g.partnerId, g]));
    expect(byId.fortinet).toMatchObject({ revenueXof: 400_000, source: "bc", bcXof: 400_000 }); // déclaré 999 999 IGNORÉ
    expect(byId.huawei).toMatchObject({ revenueXof: 200_000, source: "declare", bcXof: 0, declaredXof: 200_000 });
    expect(byId.cisco).toMatchObject({ revenueXof: 1_100_000, source: "bc" });
    // Ventilation globale cohérente : total = BC + déclaré.
    expect(ca.totalXof).toBe(ca.bcXof + ca.declaredXof);
    expect(ca.bcXof).toBe(1_500_000);      // cisco 1,1 M + fortinet 400k
    expect(ca.declaredXof).toBe(200_000);  // huawei
    // Fournisseur non rattaché remonté (jamais silencieusement ignoré).
    expect(ca.unmapped.map((u) => u.supplier)).toContain("MYSTERY DISTRIB");
  });

  it("COHÉRENCE bout-en-bout : le CA du snapshot IA est IDENTIQUE au CA de la chaîne (invariant)", () => {
    const ca = buildCaSummary(bcLines, map, declared, nameById);
    const quotas = { partners: [
      { partnerId: "cisco", name: "Cisco", status: "on_track", gaps: [], coverage: [] },
      { partnerId: "fortinet", name: "Fortinet", status: "at_risk", gaps: [{ target: "securite", holders: 1, minCount: 2 }], coverage: [{ target: "securite", holders: 1, minCount: 2, ok: false }] },
    ] };
    // Plan d'action : la ventilation par partenaire doit refléter EXACTEMENT la chaîne (même nombre).
    const plan = actionPlanSnapshot({ dateIso: "2026-07-19", ca, quotas, relances: {} });
    const planById = Object.fromEntries(plan.partners.map((p) => [p.nom, p]));
    expect(planById.Fortinet).toMatchObject({ ca_ytd_fcfa: 400_000, ca_dont_bc_fcfa: 400_000, ca_dont_declare_fcfa: 0 });
    expect(planById.Cisco.ca_ytd_fcfa).toBe(1_100_000);
    expect(planById.Fortinet.quotas_manquants[0]).toMatch(/manque 1/);
    // QBR fortinet : même CA, ventilation identique, exercice fiscal décalé (août→juillet).
    const qbr = qbrSnapshot({ partnerId: "fortinet", partner: { name: "Fortinet", fiscalStartMonth: 8 }, periode: "T3 2026", ca, quotas, certifs: [], relances: {} });
    expect(qbr).toMatchObject({ ca_realise_ytd_fcfa: 400_000, ca_dont_bc_fcfa: 400_000, ca_dont_declare_fcfa: 0 });
    expect(qbr.exercice_fiscal).toBe("août → juillet");
  });

  it("suggestion IA : le rattachement proposé (re-validé) rebranche le fournisseur ⇒ CA cisco croît, unmapped se vide", () => {
    const ca = buildCaSummary(bcLines, map, declared, nameById);
    // Snapshot SANS montant CA (rapprochement de noms ; ADR-P07) donné à l'IA.
    const snap = mapSuggestSnapshot({ unmapped: ca.unmapped, partners: ca.byPartner.map((g) => ({ id: g.partnerId, name: g.name })) });
    expect(JSON.stringify(snap)).not.toMatch(/300000/); // aucun montant transmis
    // L'IA propose MYSTERY DISTRIB → cisco (100 %) + une marque INCONNUE (écartée par la re-validation).
    const suggestions = normalizeMapSuggest([
      { fournisseur: "MYSTERY DISTRIB", repartition: [{ id: "cisco", poids: 1 }] },
      { fournisseur: "MYSTERY DISTRIB", repartition: [{ id: "hors-referentiel", poids: 1 }] }, // doublon + id inconnu
    ], ["cisco", "fortinet", "huawei"]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].allocations).toEqual([{ partnerId: "cisco", weight: 1 }]);
    // On applique la suggestion validée au mapping (comme setParPartnerMap le ferait), puis on re-dérive.
    const nextMap = { ...map };
    for (const s of suggestions) nextMap[normalizeSupplier(s.supplier)] = s.allocations.length === 1 ? s.allocations[0].partnerId : Object.fromEntries(s.allocations.map((a) => [a.partnerId, a.weight]));
    const ca2 = buildCaSummary(bcLines, nextMap, declared, nameById);
    const cisco2 = ca2.byPartner.find((g) => g.partnerId === "cisco");
    expect(cisco2.revenueXof).toBe(1_400_000);       // +300k (MYSTERY désormais rattaché)
    expect(ca2.unmapped).toHaveLength(0);             // plus aucun fournisseur orphelin
  });

  it("actions de masse : les statuts d'assignation pilotés en lot sont ceux du domaine (garde-fou)", () => {
    // Le changement de statut en masse (front) s'appuie sur setParAssignmentStatus → ASSIGNMENT_STATUSES.
    // On fige ici le contrat : un statut hors liste doit rester invalide (sinon la bulk écrirait n'importe quoi).
    for (const s of ["a_planifier", "planifie", "en_formation", "en_retard", "obtenu"]) expect(ASSIGNMENT_STATUSES).toContain(s);
    expect(ASSIGNMENT_STATUSES).not.toContain("termine");
  });
});
