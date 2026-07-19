import { describe, it, expect } from "vitest";
const FA = require("../domain/ficheAffaire");
const { computeFinancials, stepErrors, advance, reject, applyEdit, presentFor, toProjectSheet, toBcLines, normalizeFiche, CIRCUIT } = FA;

// Acteurs par rôle nt360 (mapping du circuit : AC=assistante, DC=commercial_dir, DRO=pmo,
// DGA/CDGDF=direction, PM=lecture).
const AC = { id: "u1", name: "Assistante", role: "assistante" };
const DC = { id: "u2", name: "Dir Co", role: "commercial_dir" };
const DRO = { id: "u3", name: "DRO", role: "pmo" };
const DGA = { id: "u4", name: "DGA", role: "direction" };
const CDGDF = { id: "u5", name: "CDG", role: "direction" };
const PM = { id: "u6", name: "Chef Projet", role: "lecture" };

// Fiche minimale valide à l'étape 0 (une ligne complète).
const baseFiche = () => normalizeFiche({
  numero_fp: "FP/2026/11969", client: "BADF", affaire: "Firewall", commercial: "TAPSOBA",
  date_fiche: "2026-07-09", editeur_ac: "Assistante",
  taux_usd: 590, taux_eur: 655.957, seuil_marge_pct: 15,
  provisions_xof: 0, autres_frais_financiers_xof: 1500000, prix_vente_ht_xof: 37624064,
  lignes: [{ description: "Licence firewall", fournisseur: "WESTCON", type_charge: "Licences", devise: "USD", montant: 42764 }],
});

describe("calcul prix de revient / marge", () => {
  it("convertit chaque ligne dans sa devise puis somme provisions + autres frais", () => {
    const fin = computeFinancials(baseFiche());
    // 42764 USD × 590 = 25 230 760 XOF ; + 0 provisions + 1 500 000 autres frais.
    expect(fin.lignes_xof).toBe(42764 * 590);
    expect(fin.prix_de_revient_ht).toBe(42764 * 590 + 1500000);
    expect(fin.marge_brute).toBe(37624064 - (42764 * 590 + 1500000));
    expect(fin.pct_marge).toBeCloseTo((fin.marge_brute / 37624064) * 100, 6);
  });
  it("XOF = taux 1 ; EUR utilise taux_eur", () => {
    const f = normalizeFiche({ taux_usd: 590, taux_eur: 655, prix_vente_ht_xof: 1000000, lignes: [
      { description: "d", fournisseur: "f", devise: "XOF", montant: 100000 },
      { description: "d", fournisseur: "f", devise: "EUR", montant: 100 },
    ] });
    expect(computeFinancials(f).lignes_xof).toBe(100000 + 100 * 655);
  });
  it("alerte NON bloquante si % marge < seuil ; pas de division par zéro si vente = 0", () => {
    const low = normalizeFiche({ prix_vente_ht_xof: 1000000, seuil_marge_pct: 15, lignes: [{ description: "d", fournisseur: "f", devise: "XOF", montant: 950000 }] });
    expect(computeFinancials(low).below_threshold).toBe(true); // marge 5% < 15%
    const noSale = normalizeFiche({ prix_vente_ht_xof: 0, lignes: [] });
    expect(computeFinancials(noSale).pct_marge).toBe(0);
    expect(computeFinancials(noSale).below_threshold).toBe(false);
  });
});

describe("champs obligatoires par étape", () => {
  it("étape 0 : entête + au moins une ligne complète (montant > 0)", () => {
    expect(stepErrors(baseFiche())).toEqual([]);
    const bad = normalizeFiche({ numero_fp: "", lignes: [{ description: "", fournisseur: "", montant: 0 }] });
    const errs = stepErrors(bad);
    expect(errs.some((e) => e.includes("N° de FP"))).toBe(true);
    expect(errs.some((e) => e.includes("description"))).toBe(true);
    expect(errs.some((e) => e.includes("montant"))).toBe(true);
  });
  it("étape 2 : N° de DC obligatoire ; étape 3 : tous les N° de BC obligatoires", () => {
    const at2 = { ...baseFiche(), etape_courante: 2, numero_dc: "" };
    expect(stepErrors(at2).some((e) => e.includes("N° de DC"))).toBe(true);
    const at3 = { ...baseFiche(), etape_courante: 3 }; // lignes sans numero_bc
    expect(stepErrors(at3).some((e) => e.includes("N° de BC"))).toBe(true);
  });
});

describe("circuit de validation — 6 étapes bout à bout", () => {
  it("AC1→DC→DRO→AC2→DGA→CDGDF : chaque étape par le BON rôle, jusqu'à validee", () => {
    let f = baseFiche();
    let r = advance(f, AC, { nowMs: 1000 }); // soumission AC
    expect(r.ok).toBe(true);
    expect(r.fiche.etape_courante).toBe(1);
    expect(r.fiche.statut).toBe("validation_dc");
    expect(r.event).toMatchObject({ etape_code: "AC1", type_action: "soumission", role: "assistante" });

    r = advance(r.fiche, DC, { nowMs: 2000 }); // validation DC
    expect(r.fiche.etape_courante).toBe(2);
    expect(r.fiche.statut).toBe("validation_dro");

    r = advance(r.fiche, DRO, { nowMs: 3000, numero_dc: "DC-2026-42" }); // DRO définit le N° de DC
    expect(r.ok).toBe(true);
    expect(r.fiche.numero_dc).toBe("DC-2026-42");
    expect(r.fiche.etape_courante).toBe(3);
    expect(r.fiche.statut).toBe("retour_ac_bc");

    // Étape 3 : AC renseigne les N° de BC de chaque ligne avant de transmettre.
    const withBc = { ...r.fiche, lignes: r.fiche.lignes.map((l) => ({ ...l, numero_bc: "BC-1" })) };
    r = advance(withBc, AC, { nowMs: 4000 });
    expect(r.ok).toBe(true);
    expect(r.fiche.etape_courante).toBe(4);
    expect(r.fiche.statut).toBe("validation_dga");

    r = advance(r.fiche, DGA, { nowMs: 5000 });
    expect(r.fiche.etape_courante).toBe(5);
    expect(r.fiche.statut).toBe("validation_cdgdf");

    r = advance(r.fiche, CDGDF, { nowMs: 6000 }); // validation finale
    expect(r.ok).toBe(true);
    expect(r.fiche.terminee).toBe(true);
    expect(r.fiche.statut).toBe("validee");
    expect(r.event).toMatchObject({ etape_code: "CDGDF", type_action: "validation" });
  });

  it("mauvais rôle à une étape → refus (contrôle serveur, pas juste UI)", () => {
    const f = baseFiche(); // étape 0, réservée à l'AC
    expect(advance(f, DC, { nowMs: 1 }).ok).toBe(false);
    expect(advance(f, DC, { nowMs: 1 }).error).toMatch(/assistante/);
  });

  it("étape 3 sans N° de BC → refus avec liste d'erreurs", () => {
    const at3 = { ...baseFiche(), etape_courante: 3 };
    const r = advance(at3, AC, { nowMs: 1 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("N° de BC"))).toBe(true);
  });

  it("durée d'étape journalisée depuis le début de l'étape précédente", () => {
    const f = { ...baseFiche(), etape_started_ms: 1000 };
    const r = advance(f, AC, { nowMs: 61000 }); // 60 s plus tard
    expect(r.event.duree_etape_s).toBe(60);
    expect(r.fiche.etape_started_ms).toBe(61000); // remis à zéro pour l'étape suivante
  });
});

describe("rejet", () => {
  it("un rejet DC exige un motif, renvoie en édition AC et VIDE N° de DC + tous les N° de BC", () => {
    // Fiche à l'étape 4 (DGA) avec DC + BC déjà renseignés.
    const f = { ...baseFiche(), etape_courante: 4, statut: "validation_dga", numero_dc: "DC-9",
      lignes: baseFiche().lignes.map((l) => ({ ...l, numero_bc: "BC-9" })), etape_started_ms: 1000 };
    const noMotif = reject(f, DGA, { nowMs: 2000 });
    expect(noMotif.ok).toBe(false); // commentaire obligatoire
    const r = reject(f, DGA, { nowMs: 2000, commentaire: "Marge insuffisante" });
    expect(r.ok).toBe(true);
    expect(r.fiche.etape_courante).toBe(0);
    expect(r.fiche.statut).toBe("brouillon");
    expect(r.fiche.numero_dc).toBe(null);
    expect(r.fiche.lignes.every((l) => l.numero_bc === null)).toBe(true);
    expect(r.event).toMatchObject({ type_action: "rejet", role: "direction", commentaire: "Marge insuffisante" });
  });
  it("aucun rejet possible à l'étape 0 (édition) ni à l'étape 3 (saisie BC)", () => {
    expect(reject({ ...baseFiche(), etape_courante: 0 }, AC, { commentaire: "x" }).ok).toBe(false);
    expect(reject({ ...baseFiche(), etape_courante: 3 }, AC, { commentaire: "x" }).ok).toBe(false);
  });
  it("fiche validée (terminee) → verrouillée : ni avance ni rejet", () => {
    const done = { ...baseFiche(), terminee: true, statut: "validee", etape_courante: 5 };
    expect(advance(done, CDGDF, { nowMs: 1 }).ok).toBe(false);
    expect(reject(done, CDGDF, { nowMs: 1, commentaire: "x" }).ok).toBe(false);
  });
});

describe("édition — verrou des champs par étape / rôle", () => {
  it("étape 0 : l'AC édite l'entête et les lignes, jamais le N° de DC", () => {
    const f = { ...baseFiche(), numero_dc: null };
    const r = applyEdit(f, { affaire: "Nouveau libellé", numero_dc: "PIRATE", prix_vente_ht_xof: 999 }, "assistante");
    expect(r.ok).toBe(true);
    expect(r.fiche.affaire).toBe("Nouveau libellé");
    expect(r.fiche.prix_vente_ht_xof).toBe(999);
    expect(r.fiche.numero_dc).toBe(null); // tentative d'écrire le DC ignorée
  });
  it("étape 2 : le DRO ne peut éditer QUE le N° de DC", () => {
    const at2 = { ...baseFiche(), etape_courante: 2 };
    expect(applyEdit(at2, { numero_dc: "DC-7" }, "pmo").fiche.numero_dc).toBe("DC-7");
    expect(applyEdit(at2, { prix_vente_ht_xof: 1 }, "pmo").ok).toBe(false); // autre champ → refus
    expect(applyEdit(at2, { numero_dc: "DC-7" }, "assistante").ok).toBe(false); // mauvais rôle
  });
  it("étape 3 : l'AC ne renseigne QUE les N° de BC des lignes (par ordre)", () => {
    const at3 = { ...baseFiche(), etape_courante: 3 };
    const r = applyEdit(at3, { lignes: [{ ordre: 0, numero_bc: "BC-42" }] }, "assistante");
    expect(r.ok).toBe(true);
    expect(r.fiche.lignes[0].numero_bc).toBe("BC-42");
  });
  it("étapes de validation (1) → aucun champ éditable ; fiche validée → verrouillée", () => {
    expect(applyEdit({ ...baseFiche(), etape_courante: 1 }, { affaire: "x" }, "commercial_dir").ok).toBe(false);
    expect(applyEdit({ ...baseFiche(), terminee: true }, { affaire: "x" }, "assistante").ok).toBe(false);
  });
});

describe("masquage PM (côté serveur)", () => {
  it("le rôle lecture (PM) ne reçoit PAS les champs confidentiels (omis, pas null)", () => {
    const view = presentFor(baseFiche(), "lecture");
    expect(view.pmMasked).toBe(true);
    expect("provisions_xof" in view).toBe(false);
    expect("autres_frais_financiers_xof" in view).toBe(false);
    expect("seuil_marge_pct" in view).toBe(false);
    expect(view.financials).toBe(null); // pas de prix de revient / marge / %
    // ...mais l'identification reste visible (FP, client, prix de vente).
    expect(view.numero_fp).toBe("FP/2026/11969");
    expect(view.prix_vente_ht_xof).toBe(37624064);
  });
  it("les autres rôles reçoivent la fiche complète + agrégats calculés", () => {
    const view = presentFor(baseFiche(), "direction");
    expect(view.pmMasked).toBe(false);
    expect(view.provisions_xof).toBeDefined();
    expect(view.financials.prix_de_revient_ht).toBe(42764 * 590 + 1500000);
  });
});

describe("alimentation du P&L (chemin alternatif à l'import)", () => {
  it("fiche validée → ligne projectSheets consommable par mergeCommandes (vente publique, coût/marge confidentiels)", () => {
    const done = { ...baseFiche(), terminee: true };
    const sheet = toProjectSheet(done);
    expect(sheet.fp).toBe("FP/2026/11969"); // clé canonique fpKey
    expect(sheet.saleTotal).toBe(37624064);
    expect(sheet.costTotal).toBe(42764 * 590 + 1500000);
    expect(sheet.margin).toBe(37624064 - (42764 * 590 + 1500000));
    expect(sheet.source).toBe("fiche_affaire");
  });
  it("fiche NON finalisée ou FP illisible → pas d'alimentation P&L (null)", () => {
    expect(toProjectSheet(baseFiche())).toBe(null); // pas terminee
    expect(toProjectSheet({ ...baseFiche(), terminee: true, numero_fp: "N/A" })).toBe(null);
  });
  it("lignes fournisseur → lignes BC canoniques (montant d'origine + XOF dérivé)", () => {
    const bc = toBcLines({ ...baseFiche(), lignes: baseFiche().lignes.map((l) => ({ ...l, numero_bc: "BC-7" })) });
    expect(bc).toHaveLength(1);
    expect(bc[0]).toMatchObject({ fp: "FP/2026/11969", bcNumber: "BC-7", supplier: "WESTCON", montant: 42764, amountXof: 42764 * 590 });
  });
});

describe("normalisation", () => {
  it("coerce les types, défauts (seuil 15, devise XOF, type Prestation) sans forcer la casse des libellés", () => {
    const f = normalizeFiche({ client: "Badf ", commercial: "  Tapsoba", lignes: [{ description: "d", fournisseur: "f", montant: "1 000" }] });
    expect(f.seuil_marge_pct).toBe(15);
    expect(f.client).toBe("Badf"); // trim, casse préservée
    expect(f.lignes[0].devise).toBe("XOF");
    expect(f.lignes[0].type_charge).toBe("Prestation");
    expect(f.lignes[0].montant).toBe(1000); // num() tolérant (espaces milliers)
    expect(f.etape_courante).toBe(0);
    expect(f.statut).toBe("brouillon");
  });
});

describe("intégrité du circuit (invariants)", () => {
  it("6 étapes, rejet possible seulement aux étapes de validation (1,2,4,5)", () => {
    expect(CIRCUIT).toHaveLength(6);
    expect(CIRCUIT.filter((s) => s.canReject).map((s) => s.etape)).toEqual([1, 2, 4, 5]);
    expect(CIRCUIT[5].final).toBe(true);
  });
});

// AUDIT thème ① — vérité FX de la fiche : repli parité fixe légale (EUR) quand le taux manque, flag
// missing_fx_rate + blocage de validation pour une devise non convertible (USD sans taux), arrondi XOF.
describe("fiche — vérité FX (repli peg + flag + blocage)", () => {
  const AC0 = { id: "u1", name: "AC", role: "assistante" };
  it("EUR sans taux_eur → repli peg légal 655,957 (coût NON nul, marge non gonflée)", () => {
    const f = normalizeFiche({ taux_eur: 0, prix_vente_ht_xof: 1000000, lignes: [
      { description: "d", fournisseur: "f", devise: "EUR", montant: 100 },
    ] });
    const fin = computeFinancials(f);
    expect(fin.lignes_xof).toBe(Math.round(100 * 655.957)); // 65596, pas 0
    expect(fin.missing_fx_rate).toBe(false);                // EUR est valorisable via le peg
  });
  it("USD sans taux_usd → missing_fx_rate + validation BLOQUÉE (pas de marge gonflée au P&L)", () => {
    const f = normalizeFiche({
      numero_fp: "FP/2026/7", client: "C", affaire: "A", commercial: "X", date_fiche: "2026-01-01", editeur_ac: "AC",
      taux_usd: 0, prix_vente_ht_xof: 1000000,
      lignes: [{ description: "d", fournisseur: "f", devise: "USD", montant: 1000 }],
    });
    const fin = computeFinancials(f);
    expect(fin.lignes_xof).toBe(0);          // USD non convertible → 0 (coût sous-évalué)
    expect(fin.missing_fx_rate).toBe(true);
    const errs = stepErrors(f);
    expect(errs.some((e) => /taux de change USD manquant/.test(e))).toBe(true);
    const r = advance(f, AC0, { nowMs: 1 });
    expect(r.ok).toBe(false);                 // la fiche ne peut pas être soumise ainsi
  });
  it("arrondi à l'entier XOF (le FCFA n'a pas de subdivision)", () => {
    const f = normalizeFiche({ taux_eur: 655.957, prix_vente_ht_xof: 1000000, lignes: [
      { description: "d", fournisseur: "f", devise: "EUR", montant: 3 }, // 3 × 655,957 = 1967,871 → 1968
    ] });
    expect(computeFinancials(f).lignes_xof).toBe(1968);
    expect(Number.isInteger(computeFinancials(f).prix_de_revient_ht)).toBe(true);
  });
});
