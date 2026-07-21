// Helpers déterministes partagés (BUILD_KIT §14, §17).
// IDs déterministes ⇒ idempotence : set(..., {merge:true}) ne duplique jamais.

/** Normalise une clé d'or N° FP → forme canonique "FP/AAAA/N" (§18.1).
 *  Rejette les placeholders à séquence nulle (ex. FP/2024/0000). Normalise les ZÉROS DE TÊTE
 *  de la séquence (« 013 » ⇒ « 13 ») pour qu'un même FP zero-paddé différemment (courant en
 *  export Excel) ne produise pas deux clés → sinon double comptage CAS/backlog. */
const fpKey = (v) => {
  // `(?!\d)` après l'année : une année à 5+ chiffres (coquille, ex. « FP/20244/13 ») ne doit PAS être
  // tronquée à 4 chiffres (→ « FP/2024/4 ») et collisionner avec une AUTRE commande. Forme ambiguë →
  // aucun match → null (rejetée), plutôt que fusionnée par erreur.
  const m = String(v || "").match(/FP\/?\s*(\d{4})(?!\d)\/?\s*(\d+)/i);
  if (!m) return null;
  if (/^0+$/.test(m[2])) return null; // FP factice .../0000
  const seq = String(parseInt(m[2], 10)); // « 013 » → « 13 », « 13 » → « 13 »
  return `FP/${m[1]}/${seq}`;
};

/** Normalise un N° de BON DE COMMANDE fournisseur → clé canonique (audit continuité : un même BC saisi
 *  « BC-001 » côté Excel et « BC 001 » côté ClickUp créait DEUX bcLines → double engagement du fournisseur).
 *  Forme structurée BC/AAAA/NNNN (comme fpKey : zéros de tête normalisés, placeholder .../0000 rejeté) ;
 *  sinon repli générique MAJUSCULES sans séparateurs (espaces/tirets/points/slash). "" si vide. */
const bcKey = (v) => {
  const s = String(v || "").trim();
  if (!s) return "";
  const m = s.match(/BC\/?\s*(\d{4})(?!\d)\/?\s*(\d+)/i);
  if (m && !/^0+$/.test(m[2])) return `BC/${m[1]}/${String(parseInt(m[2], 10))}`;
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
};

/** Clé de COMPARAISON inter-graphies d'un N° BC (anti double-compte SOA) : les tirets/points/underscores
 *  sont d'abord assimilés à des espaces pour que la forme structurée soit reconnue (« BC-2026-001 » ≡
 *  « BC/2026/1 »), puis la clé bcKey est réduite aux alphanumériques. Ainsi « BC-001 » ≡ « BC 001 » ≡
 *  « BC001 », et « BC/2026/001 » ≡ « BC 2026 1 ». Sert à l'ÉVICTION des amorçages ClickUp au recompute —
 *  la clé de stockage safeId, elle, ne plie ni tirets ni zéros de tête. "" si vide. */
const bcCompareKey = (v) => bcKey(String(v == null ? "" : v).replace(/[-._]/g, " ")).replace(/[^A-Z0-9]/g, "");

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
  // Séparateur UNIQUE : décimal si 1-2 chiffres (ex. « 12,5 ») OU 4+ chiffres (float calculé, ex.
  // « 7906306.3352601165 ») — un GROUPE de milliers fait EXACTEMENT 3 chiffres, donc seul le cas « .ddd »
  // reste ambigu et est traité comme millier. Sans le « 4+ », un montant Excel à décimales longues voyait son
  // « . » pris pour un séparateur de milliers et RETIRÉ → montant ×10^(décimales) (corruption « ×1 milliard »).
  else if (c > -1) dec = ((s.match(/,/g) || []).length === 1 && /(,\d{1,2}|,\d{4,})$/.test(s)) ? "," : "";
  else if (d > -1) dec = ((s.match(/\./g) || []).length === 1 && /(\.\d{1,2}|\.\d{4,})$/.test(s)) ? "." : "";
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

/** Construit un résolveur de RÉCONCILIATION N° FP à partir de la table config/fpAliases (`map` :
 *  clé canonique source → N° FP cible P&L). Le résolveur canonise le FP d'entrée (fpKey) pour la
 *  recherche, puis renvoie la CIBLE si un alias existe, sinon le FP d'origine INCHANGÉ (pas de
 *  fpKey imposé aux non-aliasés → on ne réécrit rien par surprise). Un FP illisible (fpKey null)
 *  ou une map vide passe tout à travers. Miroir de buildClientResolver, testable isolément. */
const buildFpAliasResolver = (map) => {
  const m = map && typeof map === "object" ? map : {};
  const hasAny = Object.keys(m).length > 0;
  return (fp) => {
    if (!hasAny || fp == null || fp === "") return fp;
    const k = fpKey(fp);
    return (k && m[k]) || fp;
  };
};

module.exports = { fpKey, bcKey, bcCompareKey, num, cleanBu, NOISE, noAcc, cleanName, cleanPerson, plausibleYear, buildFpAliasResolver };
