// DO Lot 4b — reconnaissance à deux taux (financier facturé/montant, opérationnel ClickUp) + FAE/PCA,
// avec le GARDE-FOU anti double-compte : une affaire sous contrat de maintenance (même fpKey) est exclue.
import { describe, it, expect } from "vitest";
const { recognitionByFp, operationalRate } = require("../domain/recognition");

describe("operationalRate — avancement opérationnel honnête (jamais de % inventé)", () => {
  it("progress checklist réel prioritaire (0..100 → 0..1), 0 % est une donnée", () => {
    expect(operationalRate(60, "3-en cours")).toBeCloseTo(0.6, 6);
    expect(operationalRate(0, "3-en cours")).toBe(0);      // 0 % mesuré ≠ indéterminé
    expect(operationalRate(150, null)).toBe(1);            // borné à 1
  });
  it("sans checklist : dérivation du statut ordinal ERP", () => {
    expect(operationalRate(null, "4-Terminé")).toBe(1);    // livré
    expect(operationalRate(null, "9-Clôturé")).toBe(1);    // insensible aux diacritiques
    expect(operationalRate(null, "0-Affecté")).toBe(0);    // pas démarré
  });
  it("« en cours » sans checklist → null (indéterminé, aucun palier fabriqué)", () => {
    expect(operationalRate(null, "3-en cours")).toBeNull();
    expect(operationalRate(null, "1-prise en charge")).toBeNull();
    expect(operationalRate(null, null)).toBeNull();        // aucun statut synchronisé
  });
});

describe("recognitionByFp — FAE / PCA par affaire", () => {
  const rows = [
    // Livré à 80 % (checklist), facturé 50 % → op>fin → FAE = (0.8-0.5)*1 000 000 = 300 000.
    { fp: "FP/2026/1", client: "ACME", cas: 1_000_000, facture: 500_000, clickupProgress: 80, clickupStatus: "3-en cours" },
    // Facturé 100 %, livré 40 % → fin>op → PCA = (1-0.4)*2 000 000 = 1 200 000.
    { fp: "FP/2026/2", client: "BETA", cas: 2_000_000, facture: 2_000_000, clickupProgress: 40, clickupStatus: "3-en cours" },
    // En cours sans checklist → op indéterminé → ni FAE ni PCA (mais compté en nbOpUnknown).
    { fp: "FP/2026/3", client: "GAMMA", cas: 500_000, facture: 100_000, clickupProgress: null, clickupStatus: "3-en cours" },
  ];

  it("calcule FAE et PCA seulement quand les deux taux sont connus", () => {
    const { rows: out, global } = recognitionByFp(rows, new Set());
    const a = out.find((r) => r.fp === "FP/2026/1");
    const b = out.find((r) => r.fp === "FP/2026/2");
    const c = out.find((r) => r.fp === "FP/2026/3");
    expect(a.fae).toBe(300_000); expect(a.pca).toBe(0);
    expect(b.pca).toBe(1_200_000); expect(b.fae).toBe(0);
    expect(c.opKnown).toBe(false); expect(c.ecart).toBeNull(); expect(c.fae).toBe(0); expect(c.pca).toBe(0);
    expect(global.fae).toBe(300_000);
    expect(global.pca).toBe(1_200_000);
    expect(global.nbOpKnown).toBe(2);
    expect(global.nbOpUnknown).toBe(1);
  });

  it("GARDE-FOU : une affaire sous contrat de maintenance (même fpKey) est EXCLUE (anti double-compte)", () => {
    // FP/2026/2 est aussi un contrat de maintenance → sa facturation est pilotée par l'échéancier mnt.
    // On rapproche par fpKey : une graphie zero-paddée doit exclure la même affaire.
    const mntFp = new Set(["FP/2026/2"]);
    const { rows: out, global } = recognitionByFp(rows, mntFp);
    expect(out.find((r) => r.fp === "FP/2026/2")).toBeUndefined(); // exclue
    expect(global.pca).toBe(0);                                    // la PCA de la maintenance ne fuit pas ici
    expect(global.nbAffaires).toBe(2);                             // seules les 2 affaires projet restent
  });

  it("rapproche les lignes d'une même affaire par fpKey (zéros de tête)", () => {
    const merged = recognitionByFp([
      { fp: "FP/2026/7", cas: 600_000, facture: 300_000, clickupProgress: 100, clickupStatus: "4-Terminé" },
      { fp: "fp/2026/007", cas: 400_000, facture: 100_000, clickupProgress: 100, clickupStatus: "4-Terminé" },
    ], new Set());
    expect(merged.rows).toHaveLength(1);
    const r = merged.rows[0];
    expect(r.montant).toBe(1_000_000);
    expect(r.factured).toBe(400_000);
    // Livré 100 %, facturé 40 % → FAE = 600 000.
    expect(r.fae).toBe(600_000);
  });

  it("sans montant (carnet à 0) → taux financier indéterminé, pas de FAE/PCA", () => {
    const { rows: out } = recognitionByFp([{ fp: "FP/2026/9", cas: 0, facture: 0, clickupProgress: 50, clickupStatus: "3-en cours" }], new Set());
    expect(out[0].tauxFin).toBeNull();
    expect(out[0].ecart).toBeNull();
    expect(out[0].fae).toBe(0);
  });
});
