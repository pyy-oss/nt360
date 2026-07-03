// Exposition & lignes de crédit fournisseurs (BUILD_KIT §7, §18.6).
// Exposition = Σ orders.suppliers.amount ; encours = saisi (creditLines) sinon Σ bcLines.amountXof
// non soldés ; « open » (achat des commandes ouvertes RAF>0) = engagement NON encore couvert par
// un BC du même FP/fournisseur — sinon le même achat serait compté DEUX FOIS (BC + ligne commande).
// couverture = (autorisé−encours)−open ; reco = encours + open×1,10.
const { fpKey } = require("../lib/ids");

/**
 * @param {object[]} orders commandes (avec suppliers[])
 * @param {object[]} bcLines lignes BC (status, amountXof, fp, supplier)
 * @param {object[]} creditLines lignes de crédit saisies {id/_id, authorized, outstanding}
 */
function suppliers(orders, bcLines, creditLines) {
  const acc = {}; // name → { expo, open, encours }
  const get = (name) => (acc[name] = acc[name] || { name, expo: 0, open: 0, encours: 0, authorized: 0, hasCredit: false });

  // Encours calculé = Σ bcLines non soldés (par fournisseur) + montant BC par (FP, fournisseur)
  // pour NETTER l'engagement des commandes déjà « bon de commandé ».
  const bcByKey = {}; // `${fpKey}|${SUPPLIER}` → Σ amountXof non soldé
  for (const b of bcLines) {
    if (b.status === "solde") continue;
    const sup = String(b.supplier || "").toUpperCase();
    const a = get(sup);
    a.encours += b.amountXof || 0;
    const k = (fpKey(b.fp) || "") + "|" + sup;
    bcByKey[k] = (bcByKey[k] || 0) + (b.amountXof || 0);
  }

  for (const o of orders) {
    const openOrder = (o.raf || 0) > 0;
    const fp = fpKey(o.fp) || "";
    for (const s of o.suppliers || []) {
      const sup = String(s.name || "").toUpperCase();
      const a = get(sup);
      a.expo += s.amount || 0;
      if (openOrder) {
        // Part de l'achat DÉJÀ couverte par un BC du même FP/fournisseur → retirée (pas de double
        // compte). Le reste (non encore bon-de-commandé) alimente « open ». Le BC consommé est
        // décrémenté pour ne pas re-couvrir une autre ligne du même couple.
        const k = fp + "|" + sup;
        const covered = Math.min(s.amount || 0, bcByKey[k] || 0);
        bcByKey[k] = (bcByKey[k] || 0) - covered;
        a.open += (s.amount || 0) - covered;
      }
    }
  }

  // Encours/autorisé saisis prioritaires (creditLines).
  const creditById = {};
  for (const c of creditLines) {
    const id = String(c.id || c._id || c.name || "").toUpperCase();
    creditById[id] = c;
  }
  for (const name of Object.keys(acc)) {
    const c = creditById[name];
    if (c) {
      acc[name].hasCredit = true;
      acc[name].authorized = c.authorized || 0;
      if (c.outstanding != null) acc[name].encours = c.outstanding; // saisi prioritaire
    }
  }

  const bySupplier = Object.values(acc)
    .map((a) => {
      const coverage = (a.authorized - a.encours) - a.open; // <0 = Saturation
      const util = a.authorized > 0 ? (a.encours + a.open) / a.authorized : 0;
      // Sans ligne de crédit saisie (authorized=0), impossible de statuer sur la
      // saturation/tension → "non_suivi" (évite un faux positif systématique sur
      // les fournisseurs P&L sans creditLines, §18.6).
      const state = a.authorized > 0
        ? (coverage < 0 ? "saturation" : util >= 0.9 ? "tension" : "ok")
        : "non_suivi";
      return { ...a, coverage, util, state, reco: a.encours + a.open * 1.1 };
    })
    .sort((x, y) => y.expo - x.expo);

  return {
    totalExpo: bySupplier.reduce((s, x) => s + x.expo, 0),
    openTotal: bySupplier.reduce((s, x) => s + x.open, 0),
    encoursTotal: bySupplier.reduce((s, x) => s + x.encours, 0),
    // Listes COMPLÈTES (non tronquées) des états critiques : les alertes doivent voir TOUS les
    // fournisseurs saturés/en tension, y compris à faible exposition (hors du top 50 affiché).
    saturated: bySupplier.filter((x) => x.state === "saturation").map((x) => x.name),
    tension: bySupplier.filter((x) => x.state === "tension").map((x) => x.name),
    bySupplier: bySupplier.slice(0, 50),
  };
}

module.exports = { suppliers };
