import { describe, it, expect } from "vitest";
const { proposeStatutRule, isDormant, normalizeStatutProposals, decideStatut, buildStatutPrompt, STATUT_AUTO_THRESHOLD, DORMANT_JOURS } = require("../domain/mntStatutAuto");

const asOf = "2026-07-17";
const c = (o) => ({ statut: "actif", dateDebut: "2026-01-01", dateFin: "2026-12-31", ...o });
const sigActif = { ticketsOuverts: 2, dernierTicketJours: 10, joursDepuisDebut: 200 };

describe("mntStatutAuto — règles déterministes (ADR-027)", () => {
  it("échéance dépassée → échu (proposé mais requiresReview : jamais recommandé en masse — incident 2026-07-17)", () => {
    const r = proposeStatutRule(c({ statut: "actif", dateFin: "2026-06-30" }), sigActif, asOf);
    expect(r).toMatchObject({ proposed: "echu", source: "regle", confidence: 1, requiresReview: true });
    expect(r.motif).toContain("2026-06-30");
    // brouillon jamais activé dont l'échéance est passée : idem, requiresReview
    expect(proposeStatutRule(c({ statut: "brouillon", dateDebut: "2025-01-01", dateFin: "2026-06-30" }), sigActif, asOf)).toMatchObject({ proposed: "echu", requiresReview: true });
    // décision finale : changed mais PAS apply (hors « recommandés »)
    expect(decideStatut(r)).toMatchObject({ changed: true, apply: false });
  });
  it("résilié = terminal : jamais rétrogradé (aucun changement)", () => {
    const r = proposeStatutRule(c({ statut: "resilie", dateFin: "2026-06-30" }), sigActif, asOf);
    expect(r.proposed).toBe("resilie");
  });
  it("brouillon dont la date de début est atteinte → actif proposé, SOUS le seuil auto (0.7)", () => {
    const r = proposeStatutRule(c({ statut: "brouillon" }), sigActif, asOf);
    expect(r).toMatchObject({ proposed: "actif", source: "regle" });
    expect(r.confidence).toBeLessThan(STATUT_AUTO_THRESHOLD);
  });
  it("brouillon à date de début future → reste brouillon", () => {
    expect(proposeStatutRule(c({ statut: "brouillon", dateDebut: "2027-01-01" }), sigActif, asOf).proposed).toBe("brouillon");
  });
  it("actif dormant → délégué à l'IA ; actif suivi → aucun changement", () => {
    expect(proposeStatutRule(c({ statut: "actif" }), { ticketsOuverts: 0, dernierTicketJours: 400, joursDepuisDebut: 400 }, asOf)).toEqual({ needsAi: true, hint: "dormant" });
    expect(proposeStatutRule(c({ statut: "actif" }), sigActif, asOf).proposed).toBe("actif");
  });
  it("suspendu avec tickets ouverts → délégué à l'IA (réactivation)", () => {
    expect(proposeStatutRule(c({ statut: "suspendu" }), { ticketsOuverts: 1 }, asOf)).toEqual({ needsAi: true, hint: "reprise_activite" });
    expect(proposeStatutRule(c({ statut: "suspendu" }), { ticketsOuverts: 0 }, asOf).proposed).toBe("suspendu");
  });
  it("échu à échéance prolongée (date de fin future) → délégué à l'IA", () => {
    expect(proposeStatutRule(c({ statut: "echu", dateFin: "2027-12-31" }), sigActif, asOf)).toEqual({ needsAi: true, hint: "echeance_prolongee" });
  });
  it("isDormant : ni ticket ouvert, ni activité récente, et engagé depuis assez longtemps", () => {
    expect(isDormant({ ticketsOuverts: 0, dernierTicketJours: null, joursDepuisDebut: 300 })).toBe(true);
    expect(isDormant({ ticketsOuverts: 1, joursDepuisDebut: 300 })).toBe(false);      // a des tickets
    expect(isDormant({ ticketsOuverts: 0, joursDepuisDebut: 30 })).toBe(false);        // trop récent
    expect(isDormant({ ticketsOuverts: 0, dernierTicketJours: 10, joursDepuisDebut: 300 })).toBe(false); // activité récente
    expect(DORMANT_JOURS).toBe(120);
  });
});

describe("mntStatutAuto — re-validation de la sortie IA + décision", () => {
  const cases = [{ id: "C1", fp: "FP/2026/7", current: "actif", hint: "dormant" }];
  it("garde une proposition valide, borne la confiance, tronque le motif", () => {
    const r = normalizeStatutProposals([{ fp: "FP/2026/7", proposed: "suspendu", confidence: 1.4, reason: "Aucune activité depuis 8 mois" }], cases);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "C1", proposed: "suspendu", confidence: 1, source: "ia" });
  });
  it("rejette proposed hors énumération, 'resilie', et les fp inconnus", () => {
    expect(normalizeStatutProposals([{ fp: "FP/2026/7", proposed: "annulé" }], cases)).toEqual([]);
    expect(normalizeStatutProposals([{ fp: "FP/2026/7", proposed: "resilie", confidence: 1 }], cases)).toEqual([]);
    expect(normalizeStatutProposals([{ fp: "FP/9999/9", proposed: "suspendu" }], cases)).toEqual([]);
  });
  it("decideStatut : apply seulement si transition réelle ET confiance ≥ seuil ET pas requiresReview", () => {
    expect(decideStatut({ current: "actif", proposed: "suspendu", confidence: 1 })).toMatchObject({ changed: true, apply: true });
    expect(decideStatut({ current: "actif", proposed: "suspendu", confidence: 0.6 })).toMatchObject({ changed: true, apply: false });
    expect(decideStatut({ current: "actif", proposed: "actif", confidence: 1 })).toMatchObject({ changed: false, apply: false });
    // requiresReview (échéance dépassée → échu) : proposé mais jamais recommandé, même à confiance 1
    expect(decideStatut({ current: "actif", proposed: "echu", confidence: 1, requiresReview: true })).toMatchObject({ changed: true, apply: false });
  });
  it("buildStatutPrompt : énumère les statuts et interdit resilie + injection", () => {
    const { system, user } = buildStatutPrompt(cases);
    expect(system).toContain("brouillon | actif | suspendu | echu | resilie");
    expect(system).toMatch(/DONNÉES/);
    expect(user).toContain("FP/2026/7");
  });
});
