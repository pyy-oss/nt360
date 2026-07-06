// Conversion devise → XOF pour les BC fournisseurs. Les taux (XOF par unité de devise) sont
// paramétrés dans config/fxRates { rates: { <DEVISE>: taux } } (écran Habilitations, direction).
// Priorité : contre-valeur XOF SAISIE (override manuel) > conversion via taux paramétré > 0
// « à saisir ». On ne retombe JAMAIS sur le montant brut en devise (traiter 1000 USD comme 1000 XOF
// fausserait l'exposition fournisseur) — sans taux, la ligne reste explicitement à compléter.
// Ancrages FIXES intégrés : la parité franc CFA (UEMOA/CEMAC) est légalement fixe face à l'euro
// (1 EUR = 655,957 XOF/XAF). Elle sert de repli AUTOMATIQUE quand aucun taux n'est paramétré, pour
// que l'EUR se convertisse toujours correctement. Un taux paramétré (config/fxRates) reste prioritaire.
const FIXED_PEG = { EUR: 655.957, XAF: 1 };

function toXof(currency, amount, providedXof, rates) {
  const cur = String(currency || "XOF").toUpperCase().trim() || "XOF";
  const amt = Number(amount) || 0;
  const manual = Number(providedXof);
  if (Number.isFinite(manual) && manual > 0) return { amountXof: Math.round(manual), fxRate: null, fxSource: "manuel" };
  if (cur === "XOF") return { amountXof: Math.round(amt), fxRate: null, fxSource: "xof" };
  const rate = Number(rates && rates[cur]);
  if (Number.isFinite(rate) && rate > 0 && amt > 0) return { amountXof: Math.round(amt * rate), fxRate: rate, fxSource: "taux" };
  // Repli : parité fixe légale (EUR) — jamais surchargée par une valeur paramétrée absente.
  const peg = FIXED_PEG[cur];
  if (peg > 0 && amt > 0) return { amountXof: Math.round(amt * peg), fxRate: peg, fxSource: "peg" };
  return { amountXof: 0, fxRate: null, fxSource: "a_saisir" };
}

module.exports = { toXof, FIXED_PEG };
