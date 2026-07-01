// Exposition & lignes de crédit fournisseurs (BUILD_KIT §7, §18.6).
// Exposition = Σ orders.suppliers.amount ; achat commandes ouvertes = Σ sur RAF>0 ;
// encours = saisi (creditLines) sinon Σ bcLines.amountXof non soldés ;
// couverture = (autorisé−encours)−achat_ouvert ; reco = encours + achat_ouvert×1,10.

/**
 * @param {object[]} orders commandes (avec suppliers[])
 * @param {object[]} bcLines lignes BC (status, amountXof)
 * @param {object[]} creditLines lignes de crédit saisies {id/_id, authorized, outstanding}
 */
function suppliers(orders, bcLines, creditLines) {
  const acc = {}; // name → { expo, open, encours }
  const get = (name) => (acc[name] = acc[name] || { name, expo: 0, open: 0, encours: 0, authorized: 0, hasCredit: false });

  for (const o of orders) {
    const openOrder = (o.raf || 0) > 0;
    for (const s of o.suppliers || []) {
      const a = get(String(s.name || "").toUpperCase());
      a.expo += s.amount || 0;
      if (openOrder) a.open += s.amount || 0;
    }
  }

  // Encours calculé = Σ bcLines non soldés (par fournisseur).
  for (const b of bcLines) {
    if (b.status === "solde") continue;
    const a = get(String(b.supplier || "").toUpperCase());
    a.encours += b.amountXof || 0;
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
      return {
        ...a,
        coverage,
        util,
        state: coverage < 0 ? "saturation" : util >= 0.9 ? "tension" : "ok",
        reco: a.encours + a.open * 1.1,
      };
    })
    .sort((x, y) => y.expo - x.expo);

  return {
    totalExpo: bySupplier.reduce((s, x) => s + x.expo, 0),
    openTotal: bySupplier.reduce((s, x) => s + x.open, 0),
    encoursTotal: bySupplier.reduce((s, x) => s + x.encours, 0),
    bySupplier: bySupplier.slice(0, 50),
  };
}

module.exports = { suppliers };
