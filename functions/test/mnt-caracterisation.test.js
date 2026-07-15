// FILET DE NON-RÉGRESSION du module Contrats de maintenance (Phase 4 du kit).
//
// Ces tests NE testent PAS le module (il n'existe pas encore) : ils FIGENT le comportement ACTUEL
// de l'ERP aux points de contact du plan d'intégration (docs/contrats/04-PLAN-INTEGRATION.md §3),
// AVANT que le module n'y touche. Une régression future les fera rougir.
//
// Un test de caractérisation dit ce que le code FAIT aujourd'hui, pas ce qu'il devrait faire.
// Quand un lot ÉTEND volontairement l'un de ces comportements (ex. Lot 4 ajoute un type
// d'approbation), le test correspondant est mis à jour DÉLIBÉRÉMENT dans le même lot — c'est le
// signal que la frontière a bougé, et il est tracé.
//
// Périmètre : seuls les points de contact PURS (testables sans I/O) sont ici. Les points C2/C3
// (règles Firestore, recompute) sont couverts par functions/test-rules/rules.test.js,
// recomputeLock.integration.test.js et consistencyAlertsDq.test.js ; les gardes CI (C4/C5/C9)
// se testent elles-mêmes. Voir docs/contrats/06-JOURNAL.md pour la carte de couverture complète.

import { describe, it, expect } from "vitest";
const { resolveLevel, canRead, canWrite, validateMatrix } = require("../domain/authz");
const { APPROVAL_KINDS, APPROVAL_ENTITIES, validateApprovalRequest } = require("../domain/approval");
const { fpKey, plausibleYear } = require("../lib/ids");

// Matrice représentative (mêmes rôles/valeurs que l'ERP en production, cf. authz.test.js).
const M = {
  commercial: { overview: "read", pipeline: "write", rentabilite: "none" },
  achats: { bc: "write", overview: "read" },
};

describe("C1 — RBAC : le futur module 'maintenance' se comporte comme un module absent (baseline)", () => {
  it("un module inconnu de la matrice ('maintenance') → 'none' pour un rôle non-direction", () => {
    // Le module ajoutera la clé 'maintenance' à config/permissions. AVANT cet ajout, tout rôle
    // non-direction doit être 'none' dessus : c'est l'état « éteint » que le drapeau garantit.
    expect(resolveLevel(M, "commercial", "maintenance")).toBe("none");
    expect(resolveLevel(M, "achats", "maintenance")).toBe("none");
    expect(canRead(M, "commercial", "maintenance")).toBe(false);
    expect(canWrite(M, "commercial", "maintenance")).toBe(false);
  });
  it("direction = write partout, y compris sur 'maintenance' (superviseur)", () => {
    expect(resolveLevel(M, "direction", "maintenance")).toBe("write");
    expect(canWrite(M, "direction", "maintenance")).toBe(true);
  });
  it("ajouter 'maintenance' à un rôle NE CHANGE PAS ses autres modules (additivité)", () => {
    const withMnt = { ...M, commercial: { ...M.commercial, maintenance: "read" } };
    // Les accès existants du rôle restent identiques…
    expect(resolveLevel(withMnt, "commercial", "pipeline")).toBe("write");
    expect(resolveLevel(withMnt, "commercial", "overview")).toBe("read");
    expect(resolveLevel(withMnt, "commercial", "rentabilite")).toBe("none");
    // …et les autres rôles ne voient rien changer.
    expect(resolveLevel(withMnt, "achats", "bc")).toBe("write");
    expect(resolveLevel(withMnt, "achats", "maintenance")).toBe("none");
  });
  it("une matrice portant la clé 'maintenance' reste VALIDE (clé de module = chaîne libre)", () => {
    // validateMatrix n'impose pas une liste fermée de modules : ajouter 'maintenance' ne casse
    // pas la garde anti-DoS RBAC. Le niveau, lui, reste borné à none/read/write.
    expect(validateMatrix({ commercial: { maintenance: "read" } }).ok).toBe(true);
    expect(validateMatrix({ commercial: { maintenance: "admin" } }).ok).toBe(false); // niveau invalide
  });
});

describe("C6 — Approbations : baseline AVANT l'ajout du type 'renouvellement de contrat' (ADR-004)", () => {
  it("les natures/entités d'approbation actuelles n'incluent PAS le contrat de maintenance", () => {
    // Le Lot 4 ajoutera (additivement) une nature et une entité. On fige l'état d'avant : aujourd'hui
    // ni la nature ni l'entité contrat n'existent. Ce test sera mis à jour DANS le Lot 4.
    expect(APPROVAL_KINDS).not.toContain("renouvellement_contrat");
    expect(APPROVAL_ENTITIES).not.toContain("mnt_contrat");
  });
  it("une demande de renouvellement de contrat est REJETÉE aujourd'hui (nature/entité inconnues)", () => {
    const r = validateApprovalRequest({ kind: "renouvellement_contrat", entityType: "mnt_contrat", entityId: "FP/2026/1" });
    expect(r.ok).toBe(false);
  });
  it("les demandes d'approbation EXISTANTES restent valides (non régression du moteur)", () => {
    const r = validateApprovalRequest({ kind: "remise_opp", entityType: "opportunity", entityId: "opp1", amount: 1000 });
    expect(r.ok).toBe(true);
    expect(r.value.kind).toBe("remise_opp");
  });
});

describe("C11 — Rattachement contrat↔affaire : TOUJOURS via fpKey, jamais le FP brut", () => {
  it("deux graphies du MÊME N° FP se rapprochent (zéros de tête, espaces normalisés)", () => {
    // Le contrat est clé sur le N° FP de l'affaire (ADR-001). Le rapprochement DOIT passer par fpKey,
    // sinon double-compte / faux orphelins (CLAUDE.md). On fige l'équivalence canonique.
    expect(fpKey("FP/2026/007")).toBe(fpKey("FP/2026/7"));
    expect(fpKey(" fp/2026/7 ")).toBe("FP/2026/7");
  });
  it("un placeholder à séquence nulle est REJETÉ (un contrat ne s'ancre pas sur FP/AAAA/0000)", () => {
    expect(fpKey("FP/2026/0000")).toBeNull();
  });
  it("le millésime d'un contrat passe par plausibleYear (millésime aberrant → 0, hors regroupement)", () => {
    expect(plausibleYear(2026)).toBe(2026);
    expect(plausibleYear(1900)).toBe(0);
    expect(plausibleYear(20226)).toBe(0);
  });
});
