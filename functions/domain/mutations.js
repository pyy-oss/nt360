// Logique PURE des mutations (validation + calculs) partagée par les callables create*/patch*.
// Testable SANS Admin SDK : les callables gardent l'I/O (Firestore, auth, audit, recompute) et
// délèguent ici les décisions déterministes. Aucune dépendance à Date/Math.random (pureté).

// Nombre fini dans une borne [min,max]. `int` tronque. Renvoie { ok, value } (value absent si !ok).
function finiteInRange(v, { min = -Infinity, max = Infinity, int = false } = {}) {
  let n = Number(v);
  if (!Number.isFinite(n)) return { ok: false };
  if (int) n = Math.trunc(n);
  if (n < min || n > max) return { ok: false };
  return { ok: true, value: n };
}

// Année de PO : entier borné [2015, currentYear + 3]. currentYear est FOURNI (pas de Date ici) pour
// rester pur — les callables passent new Date().getFullYear().
function validateYearPo(v, currentYear) {
  return finiteInRange(v, { min: 2015, max: currentYear + 3, int: true });
}

// Étape d'opportunité bornée 1..9 (1 par défaut sur saisie invalide).
const clampStage = (s) => Math.min(9, Math.max(1, Math.trunc(Number(s)) || 1));

// Pondéré LINÉAIRE d'une opportunité = montant × IdC. L'IdC est en POURCENTAGE (0-100) dans l'app ;
// `p01` le ramène en ratio 0-1 (miroir domain/projection) → le pondéré reste un montant, que l'IdC
// soit saisi en 90 (%) ou 0,9 (historique). Tolère le mixte, aucune migration.
const { p01 } = require("./projection");
const oppWeighted = (amount, probability) => (Number(amount) || 0) * p01(probability);

// Marge d'une fiche affaire à partir d'une saisie PARTIELLE (sale/cost) + valeurs courantes (prev).
// Un champ `undefined` conserve la valeur courante ; `margin` = vente − revient si les deux sont
// connus (sinon marge courante) ; `marginPct` = marge / vente si vente non nulle (sinon courant).
function computeFicheMargin({ saleTotal, costTotal, prev = {} }) {
  const sale = saleTotal != null ? saleTotal : (prev.saleTotal != null ? prev.saleTotal : null);
  const cost = costTotal != null ? costTotal : (prev.costTotal != null ? prev.costTotal : null);
  const margin = (sale != null && cost != null) ? sale - cost : (prev.margin != null ? prev.margin : null);
  const marginPct = (margin != null && sale) ? margin / sale : (prev.marginPct != null ? prev.marginPct : null);
  return { saleTotal: sale, costTotal: cost, margin, marginPct };
}

module.exports = { finiteInRange, validateYearPo, clampStage, oppWeighted, computeFicheMargin };
