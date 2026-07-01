// Centre d'alertes (BUILD_KIT §2 bonifications) : backlog dormant, marge négative,
// ligne fournisseur saturée, concentration client, BC en attente. Fonction pure.
const { sum } = require("./chaine");
const { groupSum } = require("./backlog");

const CONCENTRATION_THRESHOLD = 0.3; // >30 % du CAS sur un seul client

/**
 * @param {object[]} orders
 * @param {object} suppliersSummary résultat de domain/fournisseurs.suppliers()
 * @param {object[]} bcLines
 * @param {number} fy année fiscale courante
 */
function alerts(orders, suppliersSummary, bcLines, fy) {
  const out = [];

  const neg = orders.filter((o) => (o.mb || 0) < 0);
  if (neg.length) out.push({ type: "marge_negative", severity: "high", count: neg.length, message: `${neg.length} commande(s) à marge négative`, refs: neg.slice(0, 10).map((o) => o.fp) });

  const dormant = orders.filter((o) => (o.raf || 0) > 0 && (o.yearPo || 0) > 0 && o.yearPo <= fy - 2);
  if (dormant.length) out.push({ type: "backlog_dormant", severity: "medium", count: dormant.length, message: `${dormant.length} commande(s) ouverte(s) d'un millésime ≤ ${fy - 2}`, refs: dormant.slice(0, 10).map((o) => o.fp) });

  const saturated = (suppliersSummary.bySupplier || []).filter((s) => s.state === "saturation");
  if (saturated.length) out.push({ type: "ligne_saturee", severity: "high", count: saturated.length, message: `${saturated.length} ligne(s) fournisseur en saturation`, refs: saturated.slice(0, 10).map((s) => s.name) });

  const tension = (suppliersSummary.bySupplier || []).filter((s) => s.state === "tension");
  if (tension.length) out.push({ type: "ligne_tension", severity: "medium", count: tension.length, message: `${tension.length} ligne(s) fournisseur en tension (util ≥ 90 %)`, refs: tension.slice(0, 10).map((s) => s.name) });

  const casByClient = groupSum(orders, (o) => o.client, (o) => o.cas);
  const totalCas = sum(orders, (o) => o.cas);
  const top = Object.entries(casByClient).sort((a, b) => b[1] - a[1])[0];
  if (top && totalCas > 0 && top[1] / totalCas >= CONCENTRATION_THRESHOLD)
    out.push({ type: "concentration_client", severity: "medium", count: 1, message: `Concentration : ${top[0]} = ${((top[1] / totalCas) * 100).toFixed(0)} % du CAS`, refs: [top[0]] });

  const pending = bcLines.filter((b) => b.status && b.status !== "solde").length;
  if (pending) out.push({ type: "bc_en_attente", severity: "low", count: pending, message: `${pending} ligne(s) BC non soldée(s)` });

  return out;
}

module.exports = { alerts, CONCENTRATION_THRESHOLD };
