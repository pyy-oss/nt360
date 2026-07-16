// Domain PUR — Synchronisation ENTRANTE Odoo → nt360 (webhook). Aucun I/O. Mappe le CONTRAT nt360 (JSON
// façonné côté Odoo, cf. docs/ODOO_WEBHOOK.md) vers les documents des collections opportunities / orders /
// invoices, en RÉUTILISANT les mêmes normalisations que les parseurs Excel (fpKey, cleanName, cleanBu,
// cleanPerson, plausibleYear, num) → Odoo et Excel CONVERGENT sur les mêmes docs (pas de 2ᵉ vérité).
//
// Rapprochement (idempotence) : N° FP canonique (fpKey) + `odooId` tracé sur chaque doc (cf. docs/ODOO_WEBHOOK.md).
//   - orders   : id = safeId(fp)      (déterministe — comme le parseur P&L → maj de la commande Excel)
//   - invoices : id = safeId(numero)  (déterministe — comme le parseur Odoo account.move)
//   - opportunities : id NON déterministe côté Excel (haché) → le HANDLER résout la cible en cherchant par
//     `fp` (sinon par `odooId`), et crée un doc `odoo_…` si aucune correspondance. Le domaine renvoie donc
//     le doc + les clés naturelles ; c'est le handler (I/O) qui pose l'id et les serverTimestamp.
const { fpKey, num, cleanName, cleanBu, cleanPerson, plausibleYear } = require("../lib/ids");
const { safeId } = require("../lib/sheets");
const { clampStage, oppWeighted } = require("./mutations");
const { DEFAULT_PROBA, STAGE_LABEL } = require("../parsers/salesData");

const OBJECTS = ["opportunity", "order", "invoice"];
const str = (v) => String(v == null ? "" : v).trim();
const isoDay = (v) => { const s = str(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && plausibleYear(s.slice(0, 4)) ? s : null; };
const traceId = (rec) => { const t = str(rec.odooId || rec.odoo_id || rec.id); return t || null; };

// --- Opportunité ---
function mapOpportunity(rec) {
  const r = rec || {};
  const client = cleanName(r.client);
  const fp = fpKey(r.fp);
  // Clé de rapprochement OBLIGATOIRE (idempotence) : sans fp NI odooId, un renvoi créerait un doublon.
  if (!fp && !traceId(r)) return { ok: false, error: "opportunité : 'fp' ou 'odooId' requis (clé de rapprochement)" };
  const stage = clampStage(r.stage);
  const amount = Math.max(0, num(r.amount));
  const pr = num(r.probability);
  const probability = pr > 0 && pr <= 100 ? pr : (DEFAULT_PROBA[stage] ?? 0); // IdC en % (0-100)
  const doc = {
    source: "odoo", odooId: traceId(r),
    client, am: cleanPerson(r.am), bu: cleanBu(r.bu) || "AUTRE", fp: fp || null,
    amount, stage, stageLabel: STAGE_LABEL[stage] || String(stage),
    probability, weighted: oppWeighted(amount, probability),
    closingDate: isoDay(r.closingDate),
  };
  return { ok: true, object: "opportunity", collection: "opportunities", key: { fp, odooId: doc.odooId }, doc };
}

// --- Commande (carnet P&L) ---
function mapOrder(rec) {
  const r = rec || {};
  const fp = fpKey(r.fp);
  if (!fp) return { ok: false, error: "commande : 'fp' (N° FP) requis" };
  const cas = Math.max(0, num(r.cas));
  const suppliers = Array.isArray(r.suppliers)
    ? r.suppliers.map((s) => ({ name: cleanName(s && s.name), amount: Math.max(0, num(s && s.amount)) })).filter((s) => s.name && s.amount > 0)
    : [];
  const doc = {
    source: "odoo", odooId: traceId(r),
    fp, client: cleanName(r.client), designation: str(r.designation),
    bu: cleanBu(r.bu), yearPo: plausibleYear(parseInt(r.yearPo, 10) || 0),
    cas,
    // RAF Excel FIGÉ seulement si fourni (null = laisser le repli dérivé de mergeCommandes agir).
    raf: r.raf == null || r.raf === "" ? null : Math.max(0, num(r.raf)),
    suppliers,
  };
  return { ok: true, object: "order", collection: "orders", id: safeId(fp), key: { fp, odooId: doc.odooId }, doc };
}

// --- Facture (source de la facturation, rapprochée par fpKey) ---
function mapInvoice(rec) {
  const r = rec || {};
  const numero = str(r.numero || r.number);
  if (!numero) return { ok: false, error: "facture : 'numero' requis" };
  const doc = {
    source: "odoo", odooId: traceId(r),
    numero, fp: fpKey(r.fp), client: cleanName(r.client),
    amountHt: num(r.amountHt), bu: cleanBu(r.bu),
    date: isoDay(r.date), dueDate: isoDay(r.dueDate),
    paid: r.paid === true || /pay[ée]|régl|encaiss|sold/i.test(str(r.paid)),
  };
  return { ok: true, object: "invoice", collection: "invoices", id: safeId(numero), key: { fp: doc.fp, odooId: doc.odooId }, doc };
}

/**
 * Mappe UN enregistrement du contrat Odoo vers un doc nt360. PUR.
 * @returns {{ok:true, object, collection, id?, key:{fp,odooId}, doc} | {ok:false, error}}
 */
function mapOdooRecord(object, rec) {
  switch (str(object)) {
    case "opportunity": return mapOpportunity(rec);
    case "order": return mapOrder(rec);
    case "invoice": return mapInvoice(rec);
    default: return { ok: false, error: `objet inconnu « ${object} » (attendu : ${OBJECTS.join(", ")})` };
  }
}

module.exports = { OBJECTS, mapOdooRecord, mapOpportunity, mapOrder, mapInvoice };
