// Helpers déterministes partagés (BUILD_KIT §14, §17).
// IDs déterministes ⇒ idempotence : set(..., {merge:true}) ne duplique jamais.

/** Normalise une clé d'or N° FP → "FP/AAAA/NNNNN" en majuscules sans espaces (§18.1). */
const fpKey = (v) => {
  const m = String(v || "").match(/FP\/?\s*\d{4}\/?\s*\d+/i);
  return m ? m[0].replace(/\s/g, "").toUpperCase() : null;
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

module.exports = { fpKey, num, cleanBu, NOISE, noAcc };
