// Helpers déterministes partagés (BUILD_KIT §14, §17).
// IDs déterministes ⇒ idempotence : set(..., {merge:true}) ne duplique jamais.

/** Normalise une clé d'or N° FP → forme canonique "FP/AAAA/NNNNN" (§18.1).
 *  Rejette les placeholders à séquence nulle (ex. FP/2024/0000). */
const fpKey = (v) => {
  const m = String(v || "").match(/FP\/?\s*(\d{4})\/?\s*(\d+)/i);
  if (!m) return null;
  if (/^0+$/.test(m[2])) return null; // FP factice .../0000
  return `FP/${m[1]}/${m[2]}`.toUpperCase();
};

/** Parse un nombre tolérant (espaces, virgule décimale, symboles). Renvoie 0 si NaN. */
const num = (v) => {
  const n = parseFloat(
    String(v ?? "")
      .replace(/\s/g, "")
      .replace(",", ".")
      .replace(/[^\d.\-]/g, "")
  );
  return isNaN(n) ? 0 : n;
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

module.exports = { fpKey, num, cleanBu, NOISE, noAcc, cleanName };
