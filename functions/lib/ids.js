// Helpers déterministes partagés (BUILD_KIT §14, §17).
// IDs déterministes ⇒ idempotence : set(..., {merge:true}) ne duplique jamais.

/** Normalise une clé d'or N° FP → forme canonique "FP/AAAA/N" (§18.1).
 *  Rejette les placeholders à séquence nulle (ex. FP/2024/0000). Normalise les ZÉROS DE TÊTE
 *  de la séquence (« 013 » ⇒ « 13 ») pour qu'un même FP zero-paddé différemment (courant en
 *  export Excel) ne produise pas deux clés → sinon double comptage CAS/backlog. */
const fpKey = (v) => {
  const m = String(v || "").match(/FP\/?\s*(\d{4})\/?\s*(\d+)/i);
  if (!m) return null;
  if (/^0+$/.test(m[2])) return null; // FP factice .../0000
  const seq = String(parseInt(m[2], 10)); // « 013 » → « 13 », « 13 » → « 13 »
  return `FP/${m[1]}/${seq}`;
};

/** Parse un nombre tolérant : gère milliers (espaces, ".", ","), décimale "." ou ",",
 *  symboles/lettres, et négatifs comptables "(1 000)" ou "1000-". Renvoie 0 si non numérique. */
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  // Négatif : parenthèses comptables, ou signe '-' en tête ou en queue.
  const negative = /^\(.*\)$/.test(s) || /^\s*-/.test(s) || /-\s*$/.test(s);
  s = s.replace(/[^\d.,]/g, ""); // ne garde que chiffres et séparateurs
  if (!s) return 0;
  const c = s.lastIndexOf(","), d = s.lastIndexOf(".");
  let dec = ""; // séparateur décimal retenu ("" = aucun, tout est millier)
  if (c > -1 && d > -1) dec = c > d ? "," : "."; // le séparateur le plus à droite = décimal
  else if (c > -1) dec = ((s.match(/,/g) || []).length === 1 && /,\d{1,2}$/.test(s)) ? "," : "";
  else if (d > -1) dec = ((s.match(/\./g) || []).length === 1 && /\.\d{1,2}$/.test(s)) ? "." : "";
  if (dec) s = s.replace(dec === "," ? /\./g : /,/g, "").replace(dec, ".");
  else s = s.replace(/[.,]/g, ""); // aucun décimal ⇒ tous les séparateurs sont des milliers
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -Math.abs(n) : n;
};

/** Normalise une BU vers ICT | CLOUD | FORMATION | AUTRE (§18.2). */
const cleanBu = (x) => {
  const s = String(x || "").trim().toUpperCase();
  return ["ICT", "CLOUD", "FORMATION"].includes(s) ? s : "AUTRE";
};

/** Noms de fournisseurs bruités à ignorer (§18.2). */
const NOISE = new Set(["COM", "MISC", "DIVERS", "TBD", "ALL", "PS", "0", "NAN", "NONE", ""]);

/** Minuscule sans accents (retire les diacritiques combinants U+0300–U+036F). */
const COMBINING = new RegExp("[\\u0300-\\u036f]", "g");
const noAcc = (s) => String(s || "").toLowerCase().normalize("NFD").replace(COMBINING, "");

/** Canonicalise un nom (client/AM) : espaces normalisés, trim, MAJUSCULES.
 *  Fusionne les doublons logiques (casse/espaces). */
const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();

// Nom de PERSONNE (commercial / AM) : comme cleanName, mais un libellé purement NUMÉRIQUE n'est
// jamais un nom — c'est le signe d'une colonne mal mappée à l'import (ex. « 35 », « 25.69 ») →
// vidé pour ne pas polluer les attributions par commercial.
const cleanPerson = (s) => { const v = cleanName(s); return /^[\d.,\s]+$/.test(v) ? "" : v; };

/** Année plausible pour un PO / une clôture : fenêtre GLISSANTE [2015, année courante + 3].
 *  Rejette les sentinelles (1899/1900/0) tout en restant valide dans le futur (pas de 2030 codé
 *  en dur qui périmerait). Retourne le nombre si plausible, sinon 0. */
const plausibleYear = (y) => {
  const n = Math.trunc(Number(y));
  if (!Number.isFinite(n)) return 0;
  const max = new Date().getFullYear() + 3;
  return n >= 2015 && n <= max ? n : 0;
};

module.exports = { fpKey, num, cleanBu, NOISE, noAcc, cleanName, cleanPerson, plausibleYear };
