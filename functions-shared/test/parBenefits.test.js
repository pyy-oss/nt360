import { describe, it, expect } from "vitest";
const {
  validateDealReg, validateMdf, validateRebate,
  deriveDealRegStatus, deriveMdfStatus,
  benefitsSummary, rebatesSummary,
} = require("../domain/parBenefits");

const TODAY = "2026-07-21";

describe("parBenefits — validation", () => {
  it("deal reg : partenaire + client requis, FP canonicalisé par fpKey, remise bornée", () => {
    expect(validateDealReg({ client: "ACME" }).ok).toBe(false);
    expect(validateDealReg({ partnerId: "dell" }).ok).toBe(false);
    const v = validateDealReg({ partnerId: "Dell", client: "ACME", fp: "fp/2026/007", amountXof: 1000.6, remisePct: 12, dateExpiration: "2026-09-30" });
    expect(v.ok).toBe(true);
    expect(v.value.partnerId).toBe("dell");
    expect(v.value.fp).toBe("FP/2026/7"); // invariant fpKey (zéros de tête normalisés)
    expect(v.value.amountXof).toBe(1001); // entier XOF (FCFA sans subdivision)
    expect(validateDealReg({ partnerId: "dell", client: "ACME", fp: "PAS-UN-FP" }).ok).toBe(false);
    expect(validateDealReg({ partnerId: "dell", client: "ACME", remisePct: 120 }).ok).toBe(false);
    expect(validateDealReg({ partnerId: "dell", client: "ACME", statut: "gagne" }).ok).toBe(false);
    // Discipline plausibleYear : une date aberrante est refusée, jamais devinée.
    expect(validateDealReg({ partnerId: "dell", client: "ACME", dateExpiration: "1900-01-01" }).ok).toBe(false);
  });
  it("MDF : montant accordé > 0 requis, consommé ≥ 0 par défaut 0", () => {
    expect(validateMdf({ partnerId: "hpe", label: "Q1" }).ok).toBe(false); // sans montant
    const v = validateMdf({ partnerId: "hpe", label: "Campagne Q1", amountXof: 5_000_000 });
    expect(v.ok).toBe(true);
    expect(v.value.usedXof).toBe(0);
    expect(v.value.statut).toBe("accorde");
  });
  it("rebate : attendu SAISI prime, sinon dérivé assiette × taux, sinon 0", () => {
    const saisi = validateRebate({ partnerId: "cisco", periode: "2026-T1", assietteXof: 1_000_000, tauxPct: 5, attenduXof: 42_000 });
    expect(saisi.ok).toBe(true);
    expect(saisi.value.attenduXof).toBe(42_000); // la saisie prime le dérivé
    const derive = validateRebate({ partnerId: "cisco", periode: "2026-T1", assietteXof: 1_000_000, tauxPct: 5 });
    expect(derive.value.attenduXof).toBe(50_000);
    expect(validateRebate({ partnerId: "cisco", periode: "2026-T1" }).value.attenduXof).toBe(0);
    expect(validateRebate({ partnerId: "cisco" }).ok).toBe(false); // période requise
  });
});

describe("parBenefits — statuts dérivés (sweep du recompute)", () => {
  it("deal reg soumis/approuvé à fenêtre passée → expiré ; états terminaux inchangés", () => {
    expect(deriveDealRegStatus({ statut: "approuve", dateExpiration: "2026-07-01" }, TODAY)).toBe("expire");
    expect(deriveDealRegStatus({ statut: "soumis", dateExpiration: "2026-07-01" }, TODAY)).toBe("expire");
    expect(deriveDealRegStatus({ statut: "approuve", dateExpiration: "2026-12-31" }, TODAY)).toBe("approuve");
    expect(deriveDealRegStatus({ statut: "rejete", dateExpiration: "2026-07-01" }, TODAY)).toBe("rejete");
    expect(deriveDealRegStatus({ statut: "approuve" }, TODAY)).toBe("approuve"); // sans échéance = jamais expiré
  });
  it("MDF accordé échu → expiré ; consommé/remboursé inchangés", () => {
    expect(deriveMdfStatus({ statut: "accorde", dateExpiration: "2026-07-01" }, TODAY)).toBe("expire");
    expect(deriveMdfStatus({ statut: "consomme", dateExpiration: "2026-07-01" }, TODAY)).toBe("consomme");
  });
});

describe("parBenefits — synthèse (summaries/par_benefits)", () => {
  const dealregs = [
    { id: "a", partnerId: "dell", statut: "approuve", amountXof: 1000, dateExpiration: "2026-08-05" }, // ≤ 30 j → expiring
    { id: "b", partnerId: "dell", statut: "soumis" },
    { id: "c", partnerId: "dell", statut: "rejete", amountXof: 500 },
    { id: "d", partnerId: "hpe", statut: "expire" },
  ];
  const mdfs = [
    { id: "m1", partnerId: "dell", statut: "accorde", amountXof: 1000, usedXof: 400, dateExpiration: "2026-09-15" }, // j60 → expiring
    { id: "m2", partnerId: "dell", statut: "consomme", amountXof: 500, usedXof: 500 },
    { id: "m3", partnerId: "hpe", statut: "expire", amountXof: 800, usedXof: 100 }, // budget PERDU : hors accordé/restant
  ];
  const opps = [
    { stage: 2, parPartnerId: "dell" }, { stage: 4, parPartnerId: "dell" }, { stage: 6, parPartnerId: "dell" }, // gagnée exclue
    { stage: 3, parPartnerId: "cisco" }, // opps taguées SANS deal reg → partenaire non couvert visible
  ];
  it("deal regs : compteurs + montant approuvé + couverture du pipeline sourcé", () => {
    const s = benefitsSummary({ dealregs, mdfs: [], opps, todayIso: TODAY });
    const dell = s.dealregs.partners.find((p) => p.partnerId === "dell");
    expect(dell.total).toBe(3);
    expect(dell.approuves).toBe(1);
    expect(dell.soumis).toBe(1);
    expect(dell.approvedXof).toBe(1000); // seuls les approuvés portent la protection
    expect(dell.activeRegs).toBe(2);     // soumis + approuvé
    expect(dell.openOppCount).toBe(2);   // étapes 1-5 taguées (la gagnée est exclue)
    const cisco = s.dealregs.partners.find((p) => p.partnerId === "cisco");
    expect(cisco.total).toBe(0);         // opps taguées sans aucune reg → ligne visible (à enregistrer)
    expect(cisco.openOppCount).toBe(1);
    expect(s.dealregs.expiring[0].id).toBe("a");
  });
  it("MDF : accordé / consommé / restant, budget expiré PERDU, expirations J-90/60/30 du restant", () => {
    const s = benefitsSummary({ dealregs: [], mdfs, opps: [], todayIso: TODAY });
    const dell = s.mdf.partners.find((p) => p.partnerId === "dell");
    expect(dell.allocatedXof).toBe(1500); // accordé ouvert + consommé (l'expiré n'y est plus)
    expect(dell.usedXof).toBe(900);
    expect(dell.remainingXof).toBe(600);  // 1000 − 400 (le fonds consommé ne laisse rien)
    const hpe = s.mdf.partners.find((p) => p.partnerId === "hpe");
    expect(hpe.remainingXof).toBe(0);     // expiré = perdu
    expect(s.mdf.expiring).toHaveLength(1);
    expect(s.mdf.expiring[0]).toMatchObject({ id: "m1", bucket: "j60", remainingXof: 600 });
  });
});

describe("parBenefits — rebates (summaries/par_ca_rebates, confidentiel)", () => {
  it("attendu / reçu / écart par partenaire ; échus non reçus listés ; abandonnés hors attendu", () => {
    const rebates = [
      { id: "r1", partnerId: "cisco", periode: "2026-T1", statut: "recu", attenduXof: 100, recuXof: 100 },
      { id: "r2", partnerId: "cisco", periode: "2026-T2", statut: "reclame", attenduXof: 200, recuXof: 0, dateEcheance: "2026-06-30" }, // échu
      { id: "r3", partnerId: "cisco", periode: "2026-T3", statut: "abandonne", attenduXof: 999, recuXof: 0 }, // renoncé — hors totaux
      { id: "r4", partnerId: "dell", periode: "2026-S1", statut: "attendu", attenduXof: 50, recuXof: 0, dateEcheance: "2026-12-31" },
    ];
    const s = rebatesSummary({ rebates, todayIso: TODAY });
    const cisco = s.partners.find((p) => p.partnerId === "cisco");
    expect(cisco.attenduXof).toBe(300);
    expect(cisco.recuXof).toBe(100);
    expect(cisco.ecartXof).toBe(200);
    expect(s.attenduXof).toBe(350);
    expect(s.ecartXof).toBe(250);
    expect(s.overdue).toHaveLength(1);
    expect(s.overdue[0]).toMatchObject({ id: "r2", daysLate: 21 });
  });
});
