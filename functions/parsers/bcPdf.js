// Extraction + parsing d'un Bon de Commande fournisseur PDF (modèle Odoo « Bon de Commande »).
// extractPdfText : texte via pdfjs-dist (honore les CMap ToUnicode → texte réel, pas les glyphes).
// parseBcText : fonction PURE (testable) qui mappe le texte vers les champs d'une bcLine.
const { fpKey, num, cleanName } = require("../lib/ids");
const { toISO } = require("../lib/sheets");

/** Extrait le texte concaténé de toutes les pages d'un PDF (Buffer). */
async function extractPdfText(buffer) {
  // pdfjs v3 : build « legacy » CommonJS, compatible Node 20 (pas de Promise.withResolvers).
  const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  let out = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out += tc.items.map((i) => i.str).join(" ") + "\n";
  }
  await doc.destroy();
  return out;
}

const CUR = { "€": "EUR", "$": "USD", "£": "GBP" };
const normCur = (s) => {
  const t = String(s || "").toUpperCase().trim();
  if (CUR[t]) return CUR[t];
  if (/FCFA|XOF|CFA/.test(t)) return "XOF";
  if (/EUR/.test(t)) return "EUR";
  if (/USD/.test(t)) return "USD";
  return t || "XOF";
};

// Devine la nature de dépense depuis la description (indicatif ; l'utilisateur confirme).
function guessType(txt) {
  const s = String(txt || "").toLowerCase();
  if (/licen|subscription|abonnement|1 year|renew|renouvel|protection|support premium/.test(s)) return "Licence";
  if (/software|logiciel|soft/.test(s)) return "Software";
  if (/support|maintenance|sla/.test(s)) return "Support";
  if (/service|presta|deploiement|déploiement|install/.test(s)) return "Service Pro";
  return "Hardware";
}

/**
 * Mappe le texte d'un BC PDF → champs de bcLine (best-effort, à confirmer côté UI).
 * @param {string} rawText
 */
function parseBcText(rawText) {
  const text = String(rawText || "").replace(/\s+/g, " ").trim();

  const mBc = text.match(/Bon\s+de\s+Commande\s+N[°o]\s*:?\s*([A-Za-z]{1,6}\s*\/\s*\d{4}\s*\/\s*\d+)/i);
  const bcNumber = mBc ? mBc[1].replace(/\s+/g, "") : "";

  const mDate = text.match(/Date\s+Bon\s+commande\s*:?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i);
  const dateIn = mDate ? toISO(mDate[1]) : null;

  const mRefF = text.match(/R[ée]f[ée]rence\s+Fournisseur\s+(.+?)\s+R[ée]f[ée]rence\s+Dossier/i);
  const refFournisseur = mRefF ? mRefF[1].replace(/\s+/g, " ").trim() : "";

  const mDossier = text.match(/R[ée]f[ée]rence\s+Dossier\s+([A-Za-z]{1,6}\s*\/\s*\d{4}\s*\/\s*\d+)/i);
  const refDossier = mDossier ? mDossier[1].replace(/\s+/g, "") : "";

  // N° FP éventuel (souvent absent d'un BC fournisseur) : cherché partout.
  const mFp = text.match(/FP\s*\/\s*\d{4}\s*\/\s*\d+/i);
  const fp = mFp ? fpKey(mFp[0]) : null;

  // Fournisseur (best-effort) : société en MAJUSCULES suivie de son adresse
  // (« … EXCLUSIVE NETWORKS NORTH WEST AFRICA  TOUR CFC … VAT: … »). On liste toutes
  // les sociétés « <MAJUSCULES> <mot d'adresse> » avant « Bon de Commande » et on garde
  // la DERNIÈRE qui n'est pas l'acheteur (NEURONES) → le vendeur, au plus près de son adresse.
  let supplier = "";
  const head = text.split(/Bon\s+de\s+Commande/i)[0] || text;
  const addr = /([A-ZÀ-Ÿ][A-ZÀ-Ÿ0-9&.'’\- ]{3,58}?)\s+(?:TOUR|LOT|RUE|AVENUE|IMMEUBLE|ZONE|BP\b|Casa|Hay|Anfa|VAT\b)/g;
  const found = [];
  let am;
  while ((am = addr.exec(head))) found.push(am[1].replace(/\s+/g, " ").trim());
  supplier = found.reverse().find((c) => c.length >= 5 && !/NEURONES/i.test(c)) || "";

  // Total : dernière occurrence « Total … <montant> <devise> » (le total TTC/net).
  let amount = 0, currency = "XOF";
  const totals = [...text.matchAll(/Total\s*(?:hors[-\s]?taxe|TTC|net|à\s+payer)?\s*[:]?\s*([\d][\d . ,]*\d|\d)\s*(€|\$|£|EUR|USD|FCFA|XOF|CFA)?/gi)];
  // On PRIVILÉGIE le total HORS TAXE (cohérent avec le CA/factures en HT) ; sinon dernier total (TTC/net).
  const ht = text.match(/Total\s*(?:hors[-\s]?taxe|h\.?t\.?)\s*[:]?\s*([\d][\d.,\s]*\d|\d)\s*(€|\$|£|EUR|USD|FCFA|XOF|CFA)?/i);
  const pick = ht || (totals.length ? totals[totals.length - 1] : null);
  if (pick) {
    amount = num(pick[1]);
    if (pick[2]) currency = normCur(pick[2]);
  }
  // Devise de repli si le total n'a pas capté le symbole : 1re devise vue.
  if (currency === "XOF") {
    const mc = text.match(/(€|\$|£|EUR|USD|FCFA|XOF|CFA)/);
    if (mc) currency = normCur(mc[1]);
  }

  // Description : 1re ligne d'article (code + libellé, quelques mots) ou la réf. fournisseur.
  let description = refFournisseur;
  const mArt = text.match(/Net\s+à\s+payer\s+(\S+(?:\s+\S+){1,10})/i);
  if (mArt) description = mArt[1].replace(/\s+/g, " ").replace(/\s+Exon[ée]r.*$/i, "").trim();

  return {
    bcNumber,
    supplier: cleanName(supplier),
    fp,
    refFournisseur,
    refDossier,
    expenseType: guessType(description + " " + refFournisseur),
    description: description.slice(0, 200),
    currency,
    amount,
    amountXof: currency === "XOF" ? amount : 0,
    dateIn,
  };
}

module.exports = { extractPdfText, parseBcText, normCur, guessType };
