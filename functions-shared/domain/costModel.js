// Modèle de coût « marge nette » (ADR-P22) — LECTURE PURE de l'overlay config/costModel { structureRate }.
// `structureRate` = frais de STRUCTURE (SG&A : direction, support, locaux…) en % du CA, borné [0..1]. Il transforme
// la marge BRUTE (CA − coût main-d'œuvre, banc compris) en marge NETTE (− frais de structure). Document ABSENT ou
// taux ≤ 0 / non fini ⇒ taux 0 ⇒ marge nette = marge brute (STRICTEMENT le comportement d'avant : aucun impact tant
// que la direction n'a pas saisi un taux). Miroir front : web/src/lib/costModel.ts.
function structureRate(cfg) {
  const r = Number(cfg && cfg.structureRate);
  return Number.isFinite(r) && r > 0 ? Math.min(1, r) : 0;
}

module.exports = { structureRate };
