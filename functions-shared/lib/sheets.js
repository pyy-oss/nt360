// Helpers de lecture de feuilles (SheetJS) partagés par les parseurs (BUILD_KIT §17).
const { noAcc } = require("./ids");

/** Index {libellé normalisé → index colonne} depuis la 1re ligne d'objets d'une feuille. */
function headerKeys(row) {
  return Object.keys(row || {});
}

/** Trouve la 1re clé d'un objet-ligne dont le libellé normalisé contient l'un des termes. */
function pickKey(keys, ...terms) {
  const T = terms.map((t) => noAcc(t));
  for (const k of keys) {
    const nk = noAcc(k);
    if (T.some((t) => nk.includes(t))) return k;
  }
  return null;
}

/**
 * Valeur d'une ligne, en respectant l'ordre de priorité des termes ET en ignorant
 * les valeurs vides (utile quand DF et Odoo exposent des colonnes concurrentes).
 */
function val(row, keys, ...terms) {
  // 1) Égalité normalisée (trim + sans accents) — évite " MB TOTAL Manuel " quand on veut " MB TOTAL ".
  for (const t of terms) {
    const nt = noAcc(t).trim();
    const k = keys.find((key) => noAcc(key).trim() === nt);
    if (k != null && row[k] != null && row[k] !== "") return row[k];
  }
  // 2) Inclusion, dans l'ordre de priorité des termes, valeur non vide.
  for (const t of terms) {
    const nt = noAcc(t);
    const k = keys.find((key) => noAcc(key).includes(nt));
    if (k != null && row[k] != null && row[k] !== "") return row[k];
  }
  // 3) Repli : 1re correspondance même vide (préserve le comportement pour clé unique).
  for (const t of terms) {
    const nt = noAcc(t);
    const k = keys.find((key) => noAcc(key).includes(nt));
    if (k != null) return row[k];
  }
  return null;
}

// Colonnes à EXCLURE d'une recherche de LIBELLÉ (désignation/objet) : identifiants et personnes
// dont le nom contient par hasard un terme recherché — ex. « Chargé d'affaires » contient « affaire »,
// « N° Opportunité » contient « opportunité ». Sans ce filtre, l'inclusion capte la mauvaise colonne.
const LABEL_EXCLUDE = ["charge", "responsable", "commercial", "chef de", "numero", "n°", "n °", "code", "identifiant", " id", "id ", "statut", "etape"];

/** Comme val(), mais en ignorant les colonnes ressemblant à un identifiant / une personne
 *  (LABEL_EXCLUDE). Utile pour capter un LIBELLÉ descriptif sans aspirer un id ou un nom. */
function valLabel(row, keys, ...terms) {
  const allowed = keys.filter((k) => { const nk = noAcc(k); return !LABEL_EXCLUDE.some((b) => nk.includes(b)); });
  return val(row, allowed, ...terms);
}

/** Convertit une valeur date (Date SheetJS, série Excel, ou chaîne) en ISO YYYY-MM-DD. */
function toISO(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Série Excel (jours depuis 1899-12-30).
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null; // ISO malformé → rejet
    return `${m[1]}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  const m2 = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m2) {
    let da = +m2[1], mo = +m2[2]; // par défaut JOUR d'abord (D/M/Y), format usuel ici
    // Si le « mois » dépasse 12 alors que le « jour » est un mois valide, la source est en MOIS
    // d'abord (US M/D/Y) → on permute pour ne jamais émettre un mois 13 (cf. audit intégral I6).
    if (mo > 12 && da <= 12) { const t = da; da = mo; mo = t; }
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null; // date invalide → rejet plutôt qu'ISO malformé
    return `${m2[3]}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  return null;
}

/** Hash déterministe (djb2) → identifiant stable pour les documents sans clé externe. */
function hashId(...parts) {
  const s = parts.map((p) => String(p ?? "")).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "h" + h.toString(36);
}

/** Sanitise un identifiant pour un doc Firestore (pas de '/').
 * Injectif : on échappe d'abord les '_' littéraux de la source (%5F) pour éviter
 * qu'un Numéro contenant déjà '_' (ex. "JV_2024_01") ne collisionne avec un Numéro
 * à '/' (ex. "JV/2024/01") après remplacement '/'→'_'. */
function safeId(v) {
  return String(v || "").trim().replace(/_/g, "%5F").replace(/\//g, "_").replace(/\s+/g, "");
}

module.exports = { headerKeys, pickKey, val, valLabel, toISO, hashId, safeId };
