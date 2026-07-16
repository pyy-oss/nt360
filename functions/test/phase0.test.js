// Phases amont (tag transverse dérivé) : Budget / Gelé / Dev sur opps actives. Cf. domain/pipeline.js.
// Règles : BUDGET = désignation commence par « budget » (prioritaire) ; sinon si étape < 3 (pas déposée) :
// GELE si âge > seuil, sinon DEV ; étape ≥ 3 non budgétaire → aucune phase. Dérivé des champs existants.
import { describe, it, expect } from "vitest";
const { classifyPhase0, pipeline } = require("../domain/pipeline");

const GELE_DAYS = 6 * 30.44; // seuil 6 mois par défaut

describe("classifyPhase0 — classification mutuellement exclusive", () => {
  it("BUDGET prime sur tout (désignation « budget… »), quelle que soit l'étape/l'âge", () => {
    expect(classifyPhase0({ stage: 4, designation: "Budget prévisionnel 2026", ageDays: 999 }, GELE_DAYS)).toBe("budget");
    expect(classifyPhase0({ stage: 1, designation: "budgetisation SI", ageDays: 5 }, GELE_DAYS)).toBe("budget");
    expect(classifyPhase0({ stage: 2, designation: "  BUDGET colonne ", ageDays: 5 }, GELE_DAYS)).toBe("budget"); // casse/espaces
  });
  it("GELE : non budgétaire, non déposée (étape < 3) et âgée au-delà du seuil", () => {
    expect(classifyPhase0({ stage: 1, designation: "Refonte réseau", ageDays: GELE_DAYS + 1 }, GELE_DAYS)).toBe("gele");
    expect(classifyPhase0({ stage: 2, designation: "Migration", ageDays: 400 }, GELE_DAYS)).toBe("gele");
  });
  it("DEV : non budgétaire, non déposée, fraîche (âge ≤ seuil ou inconnu)", () => {
    expect(classifyPhase0({ stage: 1, designation: "Nouveau POC", ageDays: 10 }, GELE_DAYS)).toBe("dev");
    expect(classifyPhase0({ stage: 2, designation: "Cadrage", ageDays: null }, GELE_DAYS)).toBe("dev"); // âge inconnu → dev
  });
  it("aucune phase amont si déposée (étape ≥ 3) et non budgétaire", () => {
    expect(classifyPhase0({ stage: 3, designation: "Offre transmise", ageDays: 999 }, GELE_DAYS)).toBeNull();
    expect(classifyPhase0({ stage: 5, designation: "Contrat", ageDays: 10 }, GELE_DAYS)).toBeNull();
  });
  it("aucune phase si l'opp n'est pas active (gagnée/perdue/suspendue)", () => {
    expect(classifyPhase0({ stage: 6, designation: "budget X", ageDays: 5 }, GELE_DAYS)).toBeNull();
    expect(classifyPhase0({ stage: 7, designation: "Truc", ageDays: 999 }, GELE_DAYS)).toBeNull();
  });
});

describe("pipeline.phase0 — ventilation + seuil paramétrable", () => {
  const opps = [
    { oppId: "b", stage: 4, designation: "Budget 2027", amount: 1000, probability: 60 },
    { oppId: "g", stage: 1, designation: "Refonte", amount: 2000, probability: 10, ageDays: 400 },
    { oppId: "d", stage: 2, designation: "POC", amount: 3000, probability: 25, ageDays: 10 },
    { oppId: "n", stage: 5, designation: "Contrat", amount: 4000, probability: 80, ageDays: 500 }, // déposée → aucune phase
  ];
  it("compte volume + brut par phase (défaut 6 mois)", () => {
    const s = pipeline(opps, "2026-06-01", undefined, []);
    expect(s.phase0.budget).toEqual({ count: 1, brut: 1000 });
    expect(s.phase0.gele).toEqual({ count: 1, brut: 2000 });
    expect(s.phase0.dev).toEqual({ count: 1, brut: 3000 });
    expect(s.geleMonths).toBe(6);
  });
  it("le seuil GELE est paramétrable : à 24 mois, l'opp de 400 j (~13 mois) redevient DEV", () => {
    const s = pipeline(opps, "2026-06-01", undefined, [], 24);
    expect(s.phase0.gele.count).toBe(0);
    expect(s.phase0.dev.count).toBe(2); // g + d
    expect(s.geleMonths).toBe(24);
  });
});
