// Parseur « Logistics Follow Up » (suivi BC fournisseurs) → bcLines/{id}.
// Feuille « PO List » : une ligne = un bon de commande fournisseur rattaché à un N° FP.
// IDs déterministes (hash des clés métier) ⇒ ré-import idempotent (upsert, pas de doublon).
const XLSX = require("xlsx");
const { fpKey, num, cleanName, noAcc } = require("../lib/ids");
const { headerKeys, val, toISO, hashId } = require("../lib/sheets");

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

    const fp = fpKey(val(r, keys, "opp id", "n° fp", "n fp", "fp"));
    const statusRaw = String(val(r, keys, "statut", "status") || "").trim();
    const doc = {
      // Clé incluant le MONTANT : deux lignes d'un même BC (même fournisseur/description) mais de
      // montants différents ne se confondent plus (évite le « dernier gagne » qui tronquait l'expo).
      _id: "bc_" + hashId(fp, poNumber, supplier, val(r, keys, "description"), amountXof || amount || 0),
      fp,
      bcNumber: poNumber,
      supplier,
      customer: cleanName(val(r, keys, "customer", "client")),
      country: String(val(r, keys, "pays") || "").trim(),
      expenseType: String(val(r, keys, "nature", "type") || "").trim(),
      description: String(val(r, keys, "description") || "").trim(),
      currency: String(val(r, keys, "currency", "devise") || "").trim() || "XOF",
      amount,
      amountXof: amountXof || (String(val(r, keys, "currency") || "").toUpperCase().includes("XOF") ? amount : 0),
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
