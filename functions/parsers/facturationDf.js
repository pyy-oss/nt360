// Parseur Facturation DF / Odoo account.move → invoices/{numero} (BUILD_KIT §17.3, §18.3).
// Module pur (testable). Dé-doublonnage par Numéro ; Σ factures d'un FP = son CAF Total.
const XLSX = require("xlsx");
const { fpKey, num, cleanBu, cleanName } = require("../lib/ids");
const { headerKeys, val, toISO, safeId } = require("../lib/sheets");

// Choisit la 1re feuille pertinente (feuille "Facturation DF" sinon la 1re).
function pickSheet(wb) {
  const named = wb.SheetNames.find((n) => /factur|account|move|df/i.test(n));
  return wb.Sheets[named || wb.SheetNames[0]];
}

/**
 * @param {import('xlsx').WorkBook} wb
 * @returns {{rows: object[], report: {rowsIn:number, rowsOk:number, rowsSkipped:number}}}
 */
function parseFacturationDf(wb) {
  const rows = XLSX.utils.sheet_to_json(pickSheet(wb), { defval: null });
  const byNumero = new Map();
  let rowsIn = 0;
  for (const r of rows) {
    rowsIn++;
    const keys = headerKeys(r);
    const numero = String(
      val(r, keys, "numero", "numéro", "number") || ""
    ).trim();
    if (!numero) continue; // quarantaine : facture sans numéro
    const fp = fpKey(val(r, keys, "n° fp", "n fp", "reference", "référence"));
    const amountHt = num(
      val(r, keys, "montant ht", "total signe en devises", "total signé en devises", "montant")
    );
    const id = safeId(numero);
    const date = toISO(val(r, keys, "date de facturation", "date"));
    const dueDate = toISO(val(r, keys, "date d'échéance", "date d echeance", "echeance", "due date"));
    const paymentStatus = String(val(r, keys, "statut en cours de paiement", "statut de paiement", "statut", "payment") || "").trim();
    const paid = /pay[ée]|régl|encaiss|sold/i.test(paymentStatus); // encaissée ?
    const sig = `${amountHt}|${date}`; // signature de ligne (distingue ligne distincte vs doublon exact)
    const prev = byNumero.get(id);
    if (prev) {
      // Même Numéro : facture MULTI-LIGNES (export Odoo : 1 ligne par ligne) ⇒ on SOMME les
      // lignes DISTINCTES (l'ancien « dernier gagne » ne gardait que la dernière, faussait le
      // montant et cassait CAF = Σ factures). Une ligne EXACTEMENT identique (même HT + date)
      // est un artefact d'export → ignorée (pas de double compte).
      if (prev._sigs.has(sig)) continue;
      prev._sigs.add(sig);
      prev.amountHt = (prev.amountHt || 0) + amountHt;
      prev.lines = (prev.lines || 1) + 1;
      continue;
    }
    byNumero.set(id, {
      _id: id,
      numero,
      fp,
      client: cleanName(
        val(r, keys, "client", "nom d'affichage du partenaire", "partenaire")
      ),
      bu: cleanBu(val(r, keys, "bu", "domaine")),
      date,
      dueDate,
      amountHt,
      lines: 1,
      paymentStatus,
      paid,
      source: "facturationDf",
      _sigs: new Set([sig]),
    });
  }
  const out = [...byNumero.values()];
  out.forEach((o) => delete o._sigs); // champ de travail (Set non persistable)
  return { rows: out, report: { rowsIn, rowsOk: out.length, rowsSkipped: rowsIn - out.length } };
}

module.exports = { parseFacturationDf };
