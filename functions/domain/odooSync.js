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

const OBJECTS = ["opportunity", "order", "invoice", "bc"];
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
  };
  // Dates : gater sur le RÉSULTAT d'isoDay (null si hors regex/plausibleYear) — sinon null écraserait au merge
  // une date curatée (closingDate = bucket période ; dateCreation = create_date Odoo, distinct du `createdAt`).
  { const d = isoDay(r.closingDate); if (d) doc.closingDate = d; }
  { const d = isoDay(r.dateCreation || r.createdDate); if (d) doc.dateCreation = d; }
  // MB prévisionnelle (marge brute en %) : Odoo sait la fournir — miroir de la colonne « MB » du LIVE Excel
  // (mbPrev). Écrite SEULEMENT si présente ET numérique (garde-chiffre, comme numPresent) → n'écrase pas un
  // mbPrev déjà saisi et n'y met pas 0 sur un « N/A ». Bornée [0,100] (échelle canonique du % de marge).
  { const mb = r.mbPrev != null ? r.mbPrev : (r.mb != null ? r.mb : (r.margin != null ? r.margin : r.marge));
    if (present(mb) && (typeof mb === "number" || /[0-9]/.test(String(mb)))) doc.mbPrev = Math.min(100, Math.max(0, num(mb))); }
  if (present(r.dc)) doc.dc = str(r.dc); // identifiant DC propre Odoo (ADR-052) — attribut EN PLUS du FP (clé)
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
  if (present(r.dc)) doc.dc = str(r.dc); // identifiant DC propre Odoo (ADR-052) — attribut EN PLUS du FP (clé)
  return { ok: true, object: "order", collection: "orders", id: safeId(fp), key: { fp, odooId: traceId(r) }, doc };
}

// --- Facture (source de la facturation, rapprochée par fpKey) ---
function mapInvoice(rec) {
  const r = rec || {};
  const numero = str(r.numero || r.number);
  if (!numero) return { ok: false, error: "facture : 'numero' requis" };
  const fp = fpKey(r.fp);
  const doc = {
    source: "odoo", odooId: traceId(r),
    numero, client: cleanName(r.client),
    amountHt: num(r.amountHt), bu: cleanBu(r.bu),
    paid: r.paid === true || /pay[ée]|régl|encaiss|sold/i.test(str(r.paid)),
  };
  // fp : gater sur le résultat de fpKey — un fp illisible ne doit PAS écraser au merge une correction posée
  // par setInvoiceFp (facture rapprochée à la main). Dates idem (null d'isoDay écraserait date/échéance curatées).
  if (fp) doc.fp = fp;
  { const d = isoDay(r.date); if (d) doc.date = d; }
  { const d = isoDay(r.dueDate); if (d) doc.dueDate = d; }
  { const d = isoDay(r.dateCreation || r.createdDate); if (d) doc.dateCreation = d; } // create_date Odoo, distinct du `createdAt`
  if (present(r.dc)) doc.dc = str(r.dc); // identifiant DC propre Odoo (ADR-052) — attribut EN PLUS du FP (clé)
  return { ok: true, object: "invoice", collection: "invoices", id: safeId(numero), key: { fp: doc.fp || null, odooId: doc.odooId }, doc };
}

// --- BC fournisseur (ligne de bon de commande) → collection bcLines (ADR-051). Le webhook reçoit un JSON
// nt360-shaped (le Server Action Odoo mappe purchase.order → ces champs, cf. docs/ODOO_WEBHOOK.md), comme pour
// les 3 autres objets. PUR : ni conversion FX (taux = I/O) ni id de stockage (bcKey+safeId) — le handler les
// pose et applique la priorité « comptable prime » (skip si un BC comptable/ClickUp de MÊME N° BC existe déjà),
// exactement comme l'import ClickUp. Doc ADDITIF (patron ADR-049) : n'écrire que les champs fournis. ---
function mapBc(rec) {
  const r = rec || {};
  const bcNumber = str(r.bcNumber || r.numero || r.number);
  if (!bcNumber) return { ok: false, error: "BC : 'bcNumber' (N° BC) requis" };
  const doc = { source: "odoo", bcNumber };
  if (present(traceId(r))) doc.odooId = traceId(r);
  // ADDITIF STRICT (audit intégrité FP) : gater sur le RÉSULTAT de fpKey, PAS sur l'input brut. fpKey rejette
  // un placeholder (FP/…/0000) ou une forme illisible en renvoyant null ; l'écrire écraserait au merge un FP
  // correct posé par un envoi antérieur (BC orphelin → coût SOA perdu). null rejeté = clé omise = valeur préservée.
  { const fp = fpKey(r.fp); if (fp) doc.fp = fp; }
  if (present(r.supplier)) doc.supplier = cleanName(r.supplier);
  if (present(r.customer)) doc.customer = cleanName(r.customer);
  if (present(r.country)) doc.country = str(r.country);
  if (present(r.expenseType)) doc.expenseType = str(r.expenseType);
  if (present(r.description || r.designation)) doc.description = str(r.description || r.designation);
  if (present(r.currency)) doc.currency = str(r.currency).toUpperCase();
  if (present(r.amount)) doc.amount = Math.max(0, num(r.amount));
  if (present(r.amountXof)) doc.amountXof = Math.max(0, num(r.amountXof)); // contre-valeur SAISIE prioritaire
  if (present(r.status)) doc.statusRaw = str(r.status); // le handler valide contre BC_STAGES (défaut « emis »)
  // Dates : gater sur le RÉSULTAT d'isoDay (null si hors regex OU hors plausibleYear, ex. sentinelle Odoo
  // 0001-01-01 ou engagement > année+3) — sinon null écraserait la date curatée au merge.
  { const d = isoDay(r.eta || r.etaReel); if (d) doc.etaReel = d; }
  { const d = isoDay(r.etaContrat); if (d) doc.etaContrat = d; } // ETA CONTRACTUELLE (engagement) — distincte de l'ETA réelle
  { const d = isoDay(r.dateIn); if (d) doc.dateIn = d; }
  { const d = isoDay(r.updateDate); if (d) doc.updateDate = d; } // date de dernière mise à jour côté Odoo
  if (present(r.comment)) doc.comment = str(r.comment); // note libre (miroir du champ `comment` des bcLines ClickUp)
  if (present(r.dc)) doc.dc = str(r.dc); // identifiant DC propre (Odoo) — capté additivement, FP reste la clé (Lot DC)
  return { ok: true, object: "bc", collection: "bcLines", key: { bcNumber, fp: doc.fp || null, odooId: doc.odooId || null }, doc };
}

// --- Rapprochement DC → N° FP (overlay config/dcAliases, ADR-054). Quand Odoo envoie un BC dont le N° FP
// est absent/placeholder (fpKey l'a rejeté → doc.fp indéfini) mais qui porte un DC connu, on récupère le FP
// de l'affaire via un overlay CURÉ (même esprit que fpAliases : non destructif, survit aux ré-imports). PUR :
// l'overlay (I/O) est chargé par le handler et passé ici. Le FP explicite d'Odoo PRIME toujours (cas normal :
// Odoo envoie FP+DC). Retourne le N° FP canonique à utiliser, ou null si rien ne résout. ---
function resolveBcFp(doc, dcAliasMap) {
  const d = doc || {};
  if (d.fp) return d.fp; // FP fourni par Odoo → prime (déjà canonique via fpKey dans mapBc)
  const dc = str(d.dc);
  if (dc && dcAliasMap && dcAliasMap[dc]) return fpKey(dcAliasMap[dc]) || null;
  return null;
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
    case "bc": return mapBc(rec);
    default: return { ok: false, error: `objet inconnu « ${object} » (attendu : ${OBJECTS.join(", ")})` };
  }
}

module.exports = { OBJECTS, mapOdooRecord, mapOpportunity, mapOrder, mapInvoice, mapBc, resolveBcFp };
