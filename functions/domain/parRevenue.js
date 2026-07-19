// Domain PUR — CA partenaire dérivé des BC fournisseurs (par_). Aucun I/O → testable.
// ADR-P02 : le chiffre d'affaires par constructeur N'EST PAS ressaisi — il est DÉRIVÉ des bons de commande
// fournisseurs EXISTANTS (collection bcLines, autorité domain/fournisseurs.js), en résolvant le nom du
// fournisseur vers un partenaire via l'overlay config/parPartnerMap (même patron que clientAliases/
// fpAliases). Aucune collection purchaseOrders parallèle → une seule vérité des achats fournisseurs.
// Montants en XOF ENTIER (le FCFA n'a pas de subdivision — règle de l'ERP).

// Clé de rapprochement fournisseur → partenaire : nom en MAJUSCULES sans espaces de bord (comme
// domain/fournisseurs.js qui agrège par `supplier.toUpperCase()`). Déterministe.
function normalizeSupplier(s) {
  return String(s == null ? "" : s).trim().toUpperCase();
}

// Résout un fournisseur (nom libre du BC) vers un partnerId via la table d'overlay. null si non mappé.
function resolvePartner(supplier, map) {
  const key = normalizeSupplier(supplier);
  return (map && map[key]) || null;
}

/**
 * Agrège le CA par partenaire depuis les lignes BC. Somme amountXof des BC dont le fournisseur résout
 * vers un partenaire ; les fournisseurs NON mappés sont remontés à part (jamais silencieusement ignorés —
 * un BC non rattaché signale une table parPartnerMap à compléter). Montants arrondis XOF entier.
 * @returns { partners: [{partnerId, revenueXof, bcCount}], unmapped: [{supplier, revenueXof, bcCount}] }
 */
function revenueByPartner(bcLines, map) {
  const byPartner = {}, unmapped = {};
  for (const b of bcLines || []) {
    const amt = Number(b && b.amountXof) || 0;
    if (!(amt > 0)) continue; // BC à montant nul/négatif : hors CA (déjà signalé par la qualité fournisseurs)
    const pid = resolvePartner(b && b.supplier, map);
    if (pid) {
      const g = byPartner[pid] || { partnerId: pid, revenueXof: 0, bcCount: 0 };
      g.revenueXof += amt; g.bcCount += 1; byPartner[pid] = g;
    } else {
      const key = normalizeSupplier(b && b.supplier) || "(inconnu)";
      const u = unmapped[key] || { supplier: key, revenueXof: 0, bcCount: 0 };
      u.revenueXof += amt; u.bcCount += 1; unmapped[key] = u;
    }
  }
  const round = (o) => ({ ...o, revenueXof: Math.round(o.revenueXof) });
  const partners = Object.values(byPartner).map(round).sort((a, b) => b.revenueXof - a.revenueXof);
  const unmappedArr = Object.values(unmapped).map(round).sort((a, b) => b.revenueXof - a.revenueXof);
  return { partners, unmapped: unmappedArr };
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

module.exports = { normalizeSupplier, resolvePartner, revenueByPartner, revenueProgress, blendRevenue };
