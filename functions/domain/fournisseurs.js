// Exposition & lignes de crédit fournisseurs (BUILD_KIT §7, §18.6).
//
// RÈGLE MÉTIER (SOA — relevé de compte fournisseur) : SEULE une FACTURE fournisseur impacte le
// SOLDE du compte. Un bon de commande (BC) est un ENGAGEMENT, pas un débit du compte tant qu'il
// n'est pas facturé. On sépare donc explicitement :
//   • SOLDE du compte = solde d'OUVERTURE (SOA posé à date, saisi) + Σ BC au statut « facturé »
//     (facturés, non encore soldés/payés). C'est ce qui impacte réellement le compte.
//   • ENGAGEMENT = Σ BC NON facturés (a_emettre / émis / livré) + achat des commandes ouvertes non
//     encore couvert par un BC (prévisionnel). Consomme le disponible mais NE bouge PAS le solde.
//   • Disponible = autorisé − solde − engagement.  Exposition = Σ achats prévus par les commandes.
const { fpKey } = require("../lib/ids");

// Statuts BC : a_emettre → emis → livre → facture → solde. « facture » = facturé non payé (dans le
// solde) ; « solde » = payé (hors compte) ; les 3 premiers = engagé non facturé.
const INVOICED = "facture";
const PAID = "solde";
const COMMITTED = new Set(["a_emettre", "emis", "livre"]);

/**
 * @param {object[]} orders commandes (avec suppliers[])
 * @param {object[]} bcLines lignes BC (status, amountXof, fp, supplier)
 * @param {object[]} creditLines lignes de crédit saisies {id/_id, authorized, openingBalance, openingDate}
 */
function suppliers(orders, bcLines, creditLines) {
  const acc = {}; // name → agrégat par fournisseur
  const get = (name) => (acc[name] = acc[name] || {
    name, expo: 0, open: 0, engagementBc: 0, facture: 0,
    authorized: 0, opening: 0, hasCredit: false,
  });

  // BC : ventile facturé (→ solde) vs engagé (→ engagement) ; les soldés (payés) sont exclus.
  // bcByKey (FP|fournisseur) = Σ BC NON soldés → sert à NETTER l'achat des commandes déjà bon-de-commandé.
  const bcByKey = {};
  const bcNoFpBySup = {}; // Σ BC NON soldés SANS N° FP renseigné, par fournisseur → repli de netting.
  for (const b of bcLines) {
    if (b.status === PAID) continue; // payé → hors compte et hors engagement
    const sup = String(b.supplier || "").toUpperCase();
    const a = get(sup);
    const amt = b.amountXof || 0;
    if (b.status === INVOICED) a.facture += amt;       // facturé non payé → SOLDE
    else if (COMMITTED.has(b.status)) a.engagementBc += amt; // commandé non facturé → ENGAGEMENT
    const fpk = fpKey(b.fp) || "";
    bcByKey[fpk + "|" + sup] = (bcByKey[fpk + "|" + sup] || 0) + amt;
    if (!fpk) bcNoFpBySup[sup] = (bcNoFpBySup[sup] || 0) + amt; // BC sans FP → pool fournisseur
  }

  for (const o of orders) {
    const openOrder = (o.raf || 0) > 0;
    const fp = fpKey(o.fp) || "";
    for (const s of o.suppliers || []) {
      const sup = String(s.name || "").toUpperCase();
      const a = get(sup);
      a.expo += s.amount || 0;
      if (openOrder) {
        // Part de l'achat DÉJÀ couverte par un BC (tout statut non soldé) → retirée du prévisionnel
        // (pas de double compte avec l'engagement BC). Priorité au BC du MÊME FP+fournisseur ; le reliquat
        // est netté contre les BC du MÊME fournisseur SANS FP renseigné (repli — cf. audit P0-B : sinon
        // un BC sans FP compte en engagement ET l'achat de la commande compte en open = double compte).
        const k = fp + "|" + sup;
        const covered = Math.min(s.amount || 0, bcByKey[k] || 0);
        bcByKey[k] = (bcByKey[k] || 0) - covered;
        let remaining = (s.amount || 0) - covered;
        const fromNoFp = Math.min(remaining, bcNoFpBySup[sup] || 0);
        bcNoFpBySup[sup] = (bcNoFpBySup[sup] || 0) - fromNoFp;
        remaining -= fromNoFp;
        a.open += remaining;
      }
    }
  }

  // Ligne de crédit saisie : plafond autorisé + solde d'OUVERTURE SOA (posé à date). Rétro-compat :
  // à défaut d'openingBalance, on reprend l'ancien champ `outstanding` comme solde d'ouverture.
  const creditById = {};
  for (const c of creditLines) {
    const id = String(c.id || c._id || c.name || "").toUpperCase();
    if (!id) continue;
    creditById[id] = c;
    get(id); // un fournisseur avec ligne de crédit s'affiche même sans BC/commande (solde d'ouverture)
  }
  for (const name of Object.keys(acc)) {
    const c = creditById[name];
    if (c) {
      acc[name].hasCredit = true;
      acc[name].authorized = c.authorized || 0;
      acc[name].opening = c.openingBalance != null ? c.openingBalance : (c.outstanding || 0);
      acc[name].openingDate = c.openingDate || null;
    }
  }

  const bySupplier = Object.values(acc)
    .map((a) => {
      const solde = a.opening + a.facture;        // SOA : ouverture + facturé non payé
      const engagement = a.engagementBc + a.open; // BC non facturés + prévisionnel des commandes
      const disponible = a.authorized - solde - engagement; // <0 = saturation
      const util = a.authorized > 0 ? (solde + engagement) / a.authorized : 0;
      // Sans ligne de crédit saisie (authorized=0), on ne statue pas (évite un faux positif
      // systématique sur les fournisseurs P&L sans creditLines, §18.6).
      const state = a.authorized > 0
        ? (disponible < 0 ? "saturation" : util >= 0.9 ? "tension" : "ok")
        : "non_suivi";
      return {
        name: a.name, expo: a.expo, open: a.open, engagement, solde,
        opening: a.opening, facture: a.facture, authorized: a.authorized, openingDate: a.openingDate || null,
        disponible, coverage: disponible, util, state, hasCredit: a.hasCredit,
        // Ligne recommandée : couvrir le solde + l'engagement avec 10 % de marge.
        reco: solde + engagement * 1.1,
        // Rétro-compat : `encours` désigne désormais le SOLDE du compte (facturé), non plus tous les BC.
        encours: solde,
      };
    })
    .sort((x, y) => y.expo - x.expo);

  return {
    totalExpo: bySupplier.reduce((s, x) => s + x.expo, 0),
    openTotal: bySupplier.reduce((s, x) => s + x.open, 0),
    engagementTotal: bySupplier.reduce((s, x) => s + x.engagement, 0),
    soldeTotal: bySupplier.reduce((s, x) => s + x.solde, 0),
    encoursTotal: bySupplier.reduce((s, x) => s + x.solde, 0), // rétro-compat = soldeTotal
    // Listes COMPLÈTES (non tronquées) des états critiques : les alertes doivent voir TOUS les
    // fournisseurs saturés/en tension, y compris à faible exposition (hors du top 50 affiché).
    saturated: bySupplier.filter((x) => x.state === "saturation").map((x) => x.name),
    tension: bySupplier.filter((x) => x.state === "tension").map((x) => x.name),
    bySupplier: bySupplier.slice(0, 50),
  };
}

module.exports = { suppliers };
