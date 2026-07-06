// Conversion devise → XOF pour les BC fournisseurs. Les taux (XOF par unité de devise) sont
// paramétrés dans config/fxRates { rates: { <DEVISE>: taux } } (écran Habilitations, direction).
// Priorité : contre-valeur XOF SAISIE (override manuel) > conversion via taux paramétré > 0
// « à saisir ». On ne retombe JAMAIS sur le montant brut en devise (traiter 1000 USD comme 1000 XOF
// fausserait l'exposition fournisseur) — sans taux, la ligne reste explicitement à compléter.
function toXof(currency, amount, providedXof, rates) {
  const cur = String(currency || "XOF").toUpperCase().trim() || "XOF";
  const amt = Number(amount) || 0;
  const manual = Number(providedXof);
  if (Number.isFinite(manual) && manual > 0) return { amountXof: Math.round(manual), fxRate: null, fxSource: "manuel" };
  if (cur === "XOF") return { amountXof: Math.round(amt), fxRate: null, fxSource: "xof" };
  const rate = Number(rates && rates[cur]);
  if (Number.isFinite(rate) && rate > 0 && amt > 0) return { amountXof: Math.round(amt * rate), fxRate: rate, fxSource: "taux" };
  return { amountXof: 0, fxRate: null, fxSource: "a_saisir" };
}

module.exports = { toXof };
