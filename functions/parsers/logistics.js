// Parseur « Logistics Follow Up » (suivi BC fournisseurs) → bcLines/{id}.
// Feuille « PO List » : une ligne = un bon de commande fournisseur rattaché à un N° FP.
// IDs déterministes (hash des clés métier) ⇒ ré-import idempotent (upsert, pas de doublon).
const XLSX = require("xlsx");
const { fpKey, num, cleanName, noAcc } = require("../lib/ids");
const { headerKeys, val, toISO, hashId } = require("../lib/sheets");
const { toXof } = require("../lib/fx");

// Choisit la feuille de suivi des PO (sinon la 1re).
function pickSheet(wb) {
  const named = wb.SheetNames.find((n) => /po\s*list|logistic|suivi/i.test(n));
  return wb.Sheets[named || wb.SheetNames[0]];
}

// Statuts logistiques hétérogènes (numérotés « 7-Livraison totale », ou libres « Livrée »,
// « Placée »…) → 5 étapes du cycle BC. Ordre de test important (du plus avancé au moins avancé).
function mapBcStatus(raw) {
  const s = noAcc(raw).trim();
  if (!s) return "a_emettre";
  if (/(solde|cloture|cloturee)/.test(s)) return "solde";
  if (/factur/.test(s)) return "facture";
  if (/(livr|disponible|diponible|recu|receptionn)/.test(s)) return "livre";
  // « Non commandé » / « Nouveau » / « Annulé » AVANT la règle générique « command… »
  // (sinon « non commande » serait capté par « command » → emis à tort).
  if (/(non\s*command|nouveau|attente|annul|^0)/.test(s)) return "a_emettre";
  if (/(command|placee|placement|expedition|production|provision|douane|dedouan|traitement|eta|bloqu|transit)/.test(s)) return "emis";
  return "a_emettre";
}

/**
 * @param {import('xlsx').WorkBook} wb
 * @returns {{rows: object[], report: {rowsIn:number, rowsOk:number, rowsSkipped:number}}}
 */
function parseLogistics(wb) {
  const raw = XLSX.utils.sheet_to_json(pickSheet(wb), { defval: null });
  const byId = new Map();
  const dupSeq = new Map(); // clé métier → nb d'occurrences déjà vues (préserve les lignes distinctes)
  let rowsIn = 0;
  for (const r of raw) {
    rowsIn++;
    const keys = headerKeys(r);
    const poNumber = String(val(r, keys, "po n", "po n°", "n° bc", "n bc", "bc") || "").replace(/\s+/g, " ").trim();
    const supplier = cleanName(val(r, keys, "fournisseur"));
    const amountXof = num(val(r, keys, "montant xof", "mt xof"));
    const amount = num(val(r, keys, "montant"));
    // Ligne exploitable : au moins un n° de BC OU un fournisseur OU un montant.
    if (!poNumber && !supplier && !amountXof && !amount) continue;

    // Devise (alias « currency »/« devise ») + contre-valeur XOF robuste (toXof) : le montant XOF saisi
    // prime, sinon conversion via taux (peg EUR en repli), sinon 0 marqué « à saisir » (jamais silencieux).
    const currency = String(val(r, keys, "currency", "devise") || "").trim() || "XOF";
    const conv = toXof(currency, amount, amountXof, undefined);

    const fp = fpKey(val(r, keys, "opp id", "n° fp", "n fp", "fp"));
    const statusRaw = String(val(r, keys, "statut", "status") || "").trim();
    const description = String(val(r, keys, "description") || "").trim();
    // ID = clé métier PHYSIQUE + INDEX D'OCCURRENCE parmi les lignes identiques (comme salesData).
    // Deux lignes distinctes d'un même BC (même fournisseur/description) restent séparées (seq 0,1…),
    // et un RÉ-IMPORT réattribue le même seq → même ID → idempotent (pas d'orphelin qui gonflerait
    // l'exposition). Le montant N'ENTRE PAS dans l'ID (une correction de montant reste idempotente).
    //
    // Le N° FP (opp id) est un ATTRIBUT MUTABLE (corrigeable) : dès qu'on a un n° de PO — identité
    // forte, un PO fournisseur appartient à UNE seule affaire — le FP N'ENTRE PAS dans l'id. Ainsi une
    // CORRECTION du FP réattribue le MÊME id → la ligne est mise à jour EN PLACE (le champ `fp` change),
    // au lieu de créer un orphelin sous l'ancien FP que le sweep (indexé par fp, cf. lib/apply.js) ne
    // balaierait jamais → double-compte permanent de l'exposition fournisseur (cf. audit intégral I1).
    // Sans n° de PO (identité faible), on conserve le FP dans l'id pour discriminer les lignes.
    const idParts = poNumber ? [poNumber, supplier, description] : [fp, poNumber, supplier, description];
    const mkey = idParts.join("|");
    const seq = dupSeq.get(mkey) || 0;
    dupSeq.set(mkey, seq + 1);
    const doc = {
      _id: "bc_" + hashId(...idParts, seq),
      fp,
      bcNumber: poNumber,
      supplier,
      customer: cleanName(val(r, keys, "customer", "client")),
      country: String(val(r, keys, "pays") || "").trim(),
      expenseType: String(val(r, keys, "nature", "type") || "").trim(),
      description,
      currency,
      amount,
      // Contre-valeur XOF : montant XOF saisi prioritaire, sinon conversion via taux (parité EUR fixe en
      // repli), sinon 0 EXPLICITEMENT marqué « à saisir » (fxSource) → visible en qualité de données. Cf.
      // audit P0-B : ne JAMAIS laisser un BC en devise étrangère silencieusement à 0 (dette/décaissement
      // effacés). L'alias « devise » est désormais respecté (variable `currency` calculée ci-dessus).
      amountXof: conv.amountXof,
      fxRate: conv.fxRate,
      fxSource: conv.fxSource,
      statusRaw,
      status: mapBcStatus(statusRaw),
      dateIn: toISO(val(r, keys, "date in")),
      etaContrat: toISO(val(r, keys, "eta contrat")),
      etaReel: toISO(val(r, keys, "eta reel")),
      updateDate: toISO(val(r, keys, "update date")),
      comment: String(val(r, keys, "commentaires", "comment") || "").trim(),
      source: "logistics",
    };
    byId.set(doc._id, doc); // dédup par clé métier (dernier gagne)
  }
  const out = [...byId.values()];
  return { rows: out, report: { rowsIn, rowsOk: out.length, rowsSkipped: rowsIn - out.length } };
}

module.exports = { parseLogistics, mapBcStatus };
