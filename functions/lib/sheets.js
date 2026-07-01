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
  for (const t of terms) {
    const nt = noAcc(t);
    const k = keys.find((key) => noAcc(key).includes(nt));
    if (k != null && row[k] != null && row[k] !== "") return row[k];
  }
  // Repli : 1re correspondance même vide (préserve le comportement pour clé unique).
  for (const t of terms) {
    const nt = noAcc(t);
    const k = keys.find((key) => noAcc(key).includes(nt));
    if (k != null) return row[k];
  }
  return null;
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
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const m2 = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return null;
}

/** Hash déterministe (djb2) → identifiant stable pour les documents sans clé externe. */
function hashId(...parts) {
  const s = parts.map((p) => String(p ?? "")).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "h" + h.toString(36);
}

/** Sanitise un identifiant pour un doc Firestore (pas de '/'). */
function safeId(v) {
  return String(v || "").trim().replace(/\//g, "_").replace(/\s+/g, "");
}

module.exports = { headerKeys, pickKey, val, toISO, hashId, safeId };
