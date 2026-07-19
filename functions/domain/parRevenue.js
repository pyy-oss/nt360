// Domain PUR — CA partenaire dérivé des BC fournisseurs (par_). Aucun I/O → testable.
// ADR-P02 : le chiffre d'affaires par constructeur N'EST PAS ressaisi — il est DÉRIVÉ des bons de commande
// fournisseurs EXISTANTS (collection bcLines, autorité domain/fournisseurs.js), en résolvant le nom du
// fournisseur vers un partenaire via l'overlay config/parPartnerMap (même patron que clientAliases/
// fpAliases). Aucune collection purchaseOrders parallèle → une seule vérité des achats fournisseurs.
// Montants en XOF ENTIER (le FCFA n'a pas de subdivision — règle de l'ERP).

const { plausibleYear } = require("../lib/ids"); // discipline millésime : [2015..année+3], sinon 0 (jamais brut)

// Clé de rapprochement fournisseur → partenaire : nom en MAJUSCULES sans espaces de bord (comme
// domain/fournisseurs.js qui agrège par `supplier.toUpperCase()`). Déterministe.
function normalizeSupplier(s) {
  return String(s == null ? "" : s).trim().toUpperCase();
}

// Millésime (année CIVILE) d'une commande fournisseur, dérivé de sa RÉFÉRENCE « BC/AAAA/NNNN » (ADR-P16).
// Présent sur chaque BC quelle que soit la source (unitaire, Odoo, ClickUp). Repli sur le millésime de
// l'affaire (« FP/AAAA/N ») si le n° BC n'en porte pas. 0 = non daté (BC sans millésime résoluble). Passé
// par plausibleYear pour écarter une année aberrante (1900, 20226) — même discipline que le reste de l'ERP.
function bcYear(bc) {
  const mBc = String((bc && bc.bcNumber) || "").match(/(\d{4})/);
  const y = mBc ? plausibleYear(mBc[1]) : 0;
  if (y) return y;
  const mFp = String((bc && bc.fp) || "").match(/(\d{4})/);
  return (mFp ? plausibleYear(mFp[1]) : 0) || 0;
}

// Normalise la valeur de mapping d'un fournisseur en ALLOCATIONS [{partnerId, weight}] dont les poids SOMMENT
// À 1 (ADR-P14). Un fournisseur (distributeur) porte souvent PLUSIEURS constructeurs — une ligne BC ne dit pas
// lequel, on RÉPARTIT donc le montant selon des poids déclarés. Rétro-compat : une valeur STRING = un seul
// constructeur à 100 % ; un OBJET { partnerId: poids } = répartition (poids ≤ 0 / non finis écartés, normalisés).
function allocationsFor(value) {
  if (value == null) return [];
  if (typeof value === "string") { const id = value.trim(); return id ? [{ partnerId: id, weight: 1 }] : []; }
  if (typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value)
      .map(([pid, w]) => ({ partnerId: String(pid || "").trim(), weight: Number(w) }))
      .filter((e) => e.partnerId && Number.isFinite(e.weight) && e.weight > 0);
    const sum = entries.reduce((s, e) => s + e.weight, 0);
    if (!(sum > 0)) return [];
    return entries.map((e) => ({ partnerId: e.partnerId, weight: e.weight / sum }));
  }
  return [];
}

// Résout un fournisseur vers UN partnerId (rétro-compat : premier constructeur de la répartition). null sinon.
function resolvePartner(supplier, map) {
  const a = allocationsFor((map || {})[normalizeSupplier(supplier)]);
  return a.length ? a[0].partnerId : null;
}

/**
 * Agrège le CA par partenaire depuis les lignes BC. Somme amountXof des BC dont le fournisseur résout
 * vers un partenaire ; les fournisseurs NON mappés sont remontés à part (jamais silencieusement ignorés —
 * un BC non rattaché signale une table parPartnerMap à compléter). Montants arrondis XOF entier.
 * @param {object} [opts] opts.year : millésime d'exercice (année civile). Renseigné ⇒ ne retient que les BC de
 *   CETTE année (millésime du n° « BC/AAAA/N », ADR-P16) — un BC d'un AUTRE millésime valide est ÉCARTÉ et sa
 *   somme remontée dans offExerciseXof (jamais silencieux). Un BC NON daté (millésime 0) est CONSERVÉ (on ne le
 *   présume pas hors exercice — l'écarter sous-compterait le CA). Sans opts.year ⇒ cumul all-time (rétro-compat).
 * @returns { partners, unmapped, offExerciseXof, offExerciseCount }
 */
function revenueByPartner(bcLines, map, opts = {}) {
  const year = Number.isFinite(Number(opts.year)) && Number(opts.year) > 0 ? Number(opts.year) : 0;
  const byPartner = {}, unmapped = {};
  let offExerciseXof = 0, offExerciseCount = 0;
  for (const b of bcLines || []) {
    const amt = Number(b && b.amountXof) || 0;
    if (!(amt > 0)) continue; // BC à montant nul/négatif : hors CA (déjà signalé par la qualité fournisseurs)
    if (year) {
      const y = bcYear(b);
      if (y && y !== year) { offExerciseXof += amt; offExerciseCount += 1; continue; } // autre millésime → hors exercice
      // y === 0 (non daté) : conservé dans l'exercice courant (ne pas sous-compter un BC sans millésime).
    }
    const allocs = allocationsFor((map || {})[normalizeSupplier(b && b.supplier)]);
    if (allocs.length) {
      // Répartition pondérée (ADR-P14) : la somme des parts = amt → aucun double-compte inter-constructeurs.
      for (const a of allocs) {
        const g = byPartner[a.partnerId] || { partnerId: a.partnerId, revenueXof: 0, bcCount: 0 };
        g.revenueXof += amt * a.weight; g.bcCount += 1; byPartner[a.partnerId] = g;
      }
    } else {
      const key = normalizeSupplier(b && b.supplier) || "(inconnu)";
      const u = unmapped[key] || { supplier: key, revenueXof: 0, bcCount: 0 };
      u.revenueXof += amt; u.bcCount += 1; unmapped[key] = u;
    }
  }
  const round = (o) => ({ ...o, revenueXof: Math.round(o.revenueXof) });
  const partners = Object.values(byPartner).map(round).sort((a, b) => b.revenueXof - a.revenueXof);
  const unmappedArr = Object.values(unmapped).map(round).sort((a, b) => b.revenueXof - a.revenueXof);
  return { partners, unmapped: unmappedArr, offExerciseXof: Math.round(offExerciseXof), offExerciseCount };
}

// Progression du CA vers un objectif (%), bornée à 100. null si pas d'objectif. Entier.
function revenueProgress(revenueYtd, revenueTarget) {
  if (revenueTarget == null || !(Number(revenueTarget) > 0)) return null;
  return Math.min(100, Math.round((Number(revenueYtd) || 0) / Number(revenueTarget) * 100));
}

/**
 * CA effectif par partenaire = MÉLANGE du dérivé des BC et du déclaratif (ADR-P10). Règle ANTI-DOUBLE-COMPTE :
 * le CA dérivé des BC PRIME dès qu'il existe (fournisseur mappé, montant > 0) ; le déclaratif ne comble que
 * lorsqu'aucun BC n'est rattaché. Ainsi, à mesure que le mapping fournisseur→constructeur se complète, les BC
 * prennent le relais du déclaratif SANS jamais s'y ajouter.
 * @param bcPartners  sortie de revenueByPartner(...).partners : [{partnerId, revenueXof, bcCount}]
 * @param declaredByPartner  { [partnerId]: caDéclaréXof }
 * @returns [{ partnerId, revenueXof (effectif), bcXof, declaredXof, bcCount, source: "bc"|"declare" }] trié desc
 */
function blendRevenue(bcPartners, declaredByPartner) {
  const bcMap = {};
  for (const g of bcPartners || []) bcMap[g.partnerId] = g;
  const decl = declaredByPartner || {};
  const ids = new Set([...Object.keys(bcMap), ...Object.keys(decl)]);
  const out = [];
  for (const id of ids) {
    const bc = bcMap[id];
    const bcXof = bc ? Math.round(Number(bc.revenueXof) || 0) : 0;
    const declaredXof = Math.max(0, Math.round(Number(decl[id]) || 0));
    const effectiveXof = bcXof > 0 ? bcXof : declaredXof; // BC prime ; déclaratif en repli (jamais additif)
    if (!(effectiveXof > 0)) continue; // ni BC ni déclaré > 0 → pas de ligne CA
    out.push({ partnerId: id, revenueXof: effectiveXof, bcXof, declaredXof, bcCount: bc ? bc.bcCount : 0, source: bcXof > 0 ? "bc" : "declare" });
  }
  return out.sort((a, b) => b.revenueXof - a.revenueXof);
}

module.exports = { normalizeSupplier, bcYear, allocationsFor, resolvePartner, revenueByPartner, revenueProgress, blendRevenue };
