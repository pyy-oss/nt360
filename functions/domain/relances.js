// Plan de RELANCE & anticipation : trois familles d'actions datées, attribuées à un responsable.
//   1) Créances échues       — factures ouvertes dont l'échéance est dépassée (relance client).
//   2) BC en retard          — BC dont l'ETA (réelle sinon contractuelle) est dépassée, non livré.
//   3) Jalons échus non facturés — projets dont la Σ des jalons échus dépasse le facturé à date.
// Module PUR (testable). La responsabilité est dérivée de la commande (AM de l'affaire) avec repli
// métier (Non attribué / Achats / PMO). Aucune donnée de marge (revenu / exécution uniquement).
const { fpKey } = require("../lib/ids");
const DAY = 86400000;
const daysLate = (asOf, ref) => Math.floor((Date.parse(asOf) - Date.parse(String(ref).slice(0, 10))) / DAY);
const bucketOf = (late) => (late <= 30 ? "0-30" : late <= 60 ? "31-60" : late <= 90 ? "61-90" : "90+");
const DELIVERED = new Set(["livre", "facture", "solde"]); // BC réputé exécuté → hors relance

// Regroupe des actions par responsable (compte + montant), trié par montant décroissant.
function byResponsable(items, amountOf) {
  const m = {};
  for (const it of items) {
    const k = it.am || "—";
    (m[k] = m[k] || { key: k, count: 0, total: 0 });
    m[k].count++; m[k].total += amountOf(it) || 0;
  }
  return Object.values(m).sort((a, b) => b.total - a.total);
}

/**
 * @param {object[]} invoices factures {id, numero, fp, client, amountHt, date, dueDate, paid}
 * @param {object[]} orders   commandes fusionnées {fp, am, client} — source des responsables/clients
 * @param {object[]} bcLines  lignes BC {bcNumber, supplier, fp, customer, amountXof, status, etaContrat, etaReel}
 * @param {object}   milestonesByFp jalons À PLAT par fp : { [fp]: [{date, amount}] }
 * @param {string}   asOf date du jour (YYYY-MM-DD)
 */
function relances(invoices, orders, bcLines, milestonesByFp, asOf) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  // Responsable (AM) & client par FP CANONIQUE (fpKey), d'après la commande (source de vérité de l'affaire).
  // Les jalons (milestonesByFp) sont stockés sous FP canonique ; sans canoniser le facturé, factByFp
  // (indexé sur le FP BRUT de la facture) ne matchait pas la clé jalon → « jalon échu non facturé » FAUX
  // même projet entièrement facturé. amByFp/clientByFp canonisés → attribution client/AM robuste au format.
  const amByFp = {}, clientByFp = {}, factByFp = {};
  for (const o of orders || []) { const k = fpKey(o.fp); if (!k) continue; if (o.am) amByFp[k] = o.am; if (o.client) clientByFp[k] = o.client; }
  for (const i of invoices || []) { const k = fpKey(i.fp); if (k) factByFp[k] = (factByFp[k] || 0) + (i.amountHt || 0); }

  // 1) Créances échues (échéance sinon date de facture dépassée, non payée, montant > 0).
  const creItems = [];
  for (const i of invoices || []) {
    if (i.paid || (i.amountHt || 0) <= 0) continue;
    const ref = i.dueDate || i.date; if (!ref) continue;
    const late = daysLate(today, ref); if (!(late > 0)) continue;
    const ik = fpKey(i.fp);
    creItems.push({
      numero: i.numero || i.id || "", fp: i.fp || null,
      client: i.client || (ik && clientByFp[ik]) || "—",
      am: (ik && amByFp[ik]) || "Non attribué",
      amount: i.amountHt || 0, dueDate: String(ref).slice(0, 10), daysLate: late, bucket: bucketOf(late),
    });
  }
  creItems.sort((a, b) => b.daysLate - a.daysLate);

  // 2) BC en retard (ETA réelle sinon contractuelle dépassée, non livré/soldé). Responsable = AM de
  //    l'affaire si connu, sinon « Achats » (le fournisseur reste la contrepartie à relancer).
  const bcItems = [];
  for (const b of bcLines || []) {
    // Lignes de FICHE affaire exclues comme dans l'Exécution BC / l'alerte bc_en_retard (elles n'ont ni
    // ETA ni statut d'exécution) — alignement EXPLICITE de la population, sinon divergence dès qu'une
    // ligne de fiche acquiert une ETA (aujourd'hui écartée de fait par `!eta continue`, mais fragile).
    if (b.source === "fiche") continue;
    if (DELIVERED.has(b.status)) continue;
    const eta = b.etaReel || b.etaContrat; if (!eta) continue;
    const late = daysLate(today, eta); if (!(late > 0)) continue;
    const bk = fpKey(b.fp);
    bcItems.push({
      bcNumber: b.bcNumber || "", supplier: b.supplier || "—", fp: b.fp || null,
      customer: b.customer || (bk && clientByFp[bk]) || "—",
      // Montant en PIVOT XOF uniquement (jamais le brut en devise) : `lib/fx.js` interdit de retomber sur
      // `b.amount` (USD/EUR non convertis) — sinon le KPI « exposé » et `byResp.total` mélangent des devises.
      // Parité avec `cashflow.decaissements` (`amt = b.amountXof || 0`). Une ligne non convertie compte 0.
      amount: b.amountXof || 0, eta: String(eta).slice(0, 10), daysLate: late,
      status: b.status || "", am: (bk && amByFp[bk]) || "Achats",
    });
  }
  bcItems.sort((a, b) => b.daysLate - a.daysLate);

  // 3) Jalons échus non facturés : par FP, Σ des jalons dont la date est dépassée COMPARÉE au facturé
  //    du FP. gap = attendu échu − facturé ; on ne retient que gap > 0 (retard de facturation réel).
  const jalItems = [];
  for (const fp of Object.keys(milestonesByFp || {})) {
    const dueMs = (milestonesByFp[fp] || []).filter((m) => m.date && daysLate(today, m.date) > 0);
    if (!dueMs.length) continue;
    const expected = dueMs.reduce((s, m) => s + (m.amount || 0), 0);
    const k = fpKey(fp) || fp; // clé jalon déjà canonique en principe ; on re-canonise par sûreté
    const invoiced = factByFp[k] || 0;
    const gap = expected - invoiced;
    if (gap <= 0) continue;
    const lastDue = dueMs.reduce((mx, m) => (m.date > mx ? m.date : mx), dueMs[0].date);
    jalItems.push({
      fp, client: clientByFp[k] || "—", am: amByFp[k] || "PMO",
      dueDate: String(lastDue).slice(0, 10), expected, invoiced, gap, daysLate: daysLate(today, lastDue),
    });
  }
  jalItems.sort((a, b) => b.gap - a.gap);

  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  // Trois sous-agrégats SÉPARÉS (écrits dans trois summaries cloisonnés par module côté aggregate).
  return {
    asOf: today,
    creances: { asOf: today, count: creItems.length, total: sum(creItems, (x) => x.amount), items: creItems.slice(0, 200), byResp: byResponsable(creItems, (x) => x.amount) },
    bc: { asOf: today, count: bcItems.length, total: sum(bcItems, (x) => x.amount), items: bcItems.slice(0, 200), byResp: byResponsable(bcItems, (x) => x.amount) },
    jalons: { asOf: today, count: jalItems.length, total: sum(jalItems, (x) => x.gap), items: jalItems.slice(0, 200), byResp: byResponsable(jalItems, (x) => x.gap) },
  };
}

module.exports = { relances };
