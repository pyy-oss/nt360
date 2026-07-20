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
    // Désignation = objet de l'affaire (miroir du champ `designation` des opps Excel — sans quoi le
    // libellé d'affaire disparaissait des opps synchronisées Odoo). `str` comme le parseur salesData.
    designation: str(r.designation || r.name || r.affaire),
    amount, stage, stageLabel: STAGE_LABEL[stage] || String(stage),
    probability, weighted: oppWeighted(amount, probability),
    closingDate: isoDay(r.closingDate),
    // Date de création côté Odoo (create_date) — distincte du `createdAt` technique posé par le handler.
    dateCreation: isoDay(r.dateCreation || r.createdDate),
  };
  return { ok: true, object: "opportunity", collection: "opportunities", key: { fp, odooId: doc.odooId }, doc };
}

// --- Commande (carnet P&L) ---
// present(v) : Odoo a-t-il RÉELLEMENT fourni ce champ ? (distingue « absent » de « 0/vide »).
const present = (v) => v != null && v !== "";
function mapOrder(rec) {
  const r = rec || {};
  const fp = fpKey(r.fp);
  if (!fp) return { ok: false, error: "commande : 'fp' (N° FP) requis" };
  // Date de commande (date_order Odoo). Champ `dateCommande` déjà porté par le carnet (jusqu'ici alimenté
  // seulement par l'overlay ClickUp) — on réutilise le même nom (pas de 2ᵉ vérité).
  const dateCommande = isoDay(r.dateCommande || r.datePo || r.dateOrder);
  // yearPo reste le millésime autoritaire ; s'il n'est pas fourni mais que la date l'est, on le dérive
  // (l'émetteur Odoo peut n'envoyer que la date complète).
  const yearPo = plausibleYear(parseInt(r.yearPo, 10) || (dateCommande ? parseInt(dateCommande.slice(0, 4), 10) : 0));
  const dateCreation = isoDay(r.dateCreation || r.createdDate);
  // Doc ADDITIF : on n'écrit QUE les champs réellement fournis par Odoo (constat re-audit #5). L'upsert du
  // handler fait `set(..., {merge:true})` ; écrire `raf:null`/`cas:0`/`designation:""` ÉCRASAIT la valeur
  // curatée du P&L (Excel) à chaque update Odoo — surtout le RAF FIGÉ. En omettant la clé absente, merge:true
  // PRÉSERVE la valeur curatée et le repli dérivé de mergeCommandes continue de s'appliquer si le champ
  // manque partout. fp est toujours écrit (clé de rapprochement), source/odooId tracent l'origine.
  const doc = { source: "odoo", fp };
  if (present(traceId(r))) doc.odooId = traceId(r);
  if (present(r.client)) doc.client = cleanName(r.client);
  if (present(r.designation)) doc.designation = str(r.designation);
  if (present(r.bu)) doc.bu = cleanBu(r.bu);
  if (yearPo > 0) doc.yearPo = yearPo;
  if (dateCommande) doc.dateCommande = dateCommande;
  if (present(r.cas)) doc.cas = Math.max(0, num(r.cas));
  if (present(r.raf)) doc.raf = Math.max(0, num(r.raf)); // RAF Excel FIGÉ — posé seulement si Odoo le fournit.
  if (Array.isArray(r.suppliers)) {
    doc.suppliers = r.suppliers.map((s) => ({ name: cleanName(s && s.name), amount: Math.max(0, num(s && s.amount)) })).filter((s) => s.name && s.amount > 0);
  }
  if (dateCreation) doc.dateCreation = dateCreation; // create_date Odoo — distinct du `createdAt` technique.
  return { ok: true, object: "order", collection: "orders", id: safeId(fp), key: { fp, odooId: traceId(r) }, doc };
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
    // Date de création côté Odoo (create_date) — distincte du `createdAt` technique posé par le handler.
    dateCreation: isoDay(r.dateCreation || r.createdDate),
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
