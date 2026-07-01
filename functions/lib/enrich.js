// Enrichissement cross-source (fiabilisation, lot A de l'audit) :
// reconstruit la BU des factures/opportunités en AUTRE par jointure FP → orders.bu,
// puis par BU majoritaire du client. orders = référentiel de vérité.

/** BU majoritaire par client à partir des orders (BU ≠ AUTRE). */
function clientBuMap(orders) {
  const counts = {}; // client → {bu: n}
  for (const o of orders) {
    if (!o.client || o.bu === "AUTRE" || !o.bu) continue;
    (counts[o.client] = counts[o.client] || {})[o.bu] = (counts[o.client]?.[o.bu] || 0) + 1;
  }
  const map = {};
  for (const client of Object.keys(counts)) {
    map[client] = Object.entries(counts[client]).sort((a, b) => b[1] - a[1])[0][0];
  }
  return map;
}

/**
 * @param {{orders:object[], invoices:object[], opportunities:object[]}} store
 * @returns {{buFixedInvoices:number, buFixedOpps:number}}
 */
function enrichBu(store) {
  const orders = store.orders || [];
  const fpBu = {};
  for (const o of orders) if (o.fp && o.bu && o.bu !== "AUTRE") fpBu[o.fp] = o.bu;
  const cliBu = clientBuMap(orders);

  let buFixedInvoices = 0, buFixedOpps = 0;
  const fix = (doc) => {
    if (doc.bu && doc.bu !== "AUTRE") return false;
    const bu = fpBu[doc.fp] || cliBu[doc.client];
    if (bu) { doc.bu = bu; return true; }
    return false;
  };
  for (const i of store.invoices || []) if (fix(i)) buFixedInvoices++;
  for (const o of store.opportunities || []) if (fix(o)) buFixedOpps++;
  return { buFixedInvoices, buFixedOpps };
}

module.exports = { enrichBu, clientBuMap };
