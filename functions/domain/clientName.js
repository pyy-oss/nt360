// Modèle de NORMALISATION des noms de clients (module PUR, testable). Deux étages :
//  1. Règles déterministes → une CLÉ CANONIQUE (déburrée, MAJUSCULES, ponctuation retirée, formes
//     juridiques et suffixes pays supprimés). Cette clé est à la fois l'identifiant de regroupement
//     ET le libellé affiché (cohérent avec la convention MAJUSCULES de l'app).
//  2. Table d'ALIAS (config/clientAliases, gérée en Admin) → fusionne les graphies que les règles
//     ne rattrapent pas (ex. « SGBCI » ↔ « Société Générale »). Un alias mappe la clé d'une variante
//     vers la clé de la cible.
// Appliqué au RECOMPUTE (non destructif) : les documents bruts gardent le nom d'origine.
const { noAcc, cleanName, NOISE } = require("../lib/ids");

// Formes juridiques (tokens isolés) retirées de la clé. Volontairement CONSERVATEUR : on ne retire
// PAS « SOCIETE / STE / ENTREPRISE » (souvent partie intégrante du nom, ex. « Société Générale »).
const LEGAL = new Set([
  "SA", "SARL", "SAS", "SASU", "SARLU", "SUARL", "EURL", "SNC", "SCI", "GIE",
  "LTD", "LLC", "INC", "PLC", "CO", "CORP", "GROUP", "GROUPE", "HOLDING", "CIE",
]);
// Suffixes pays (Côte d'Ivoire) — après déburrage « CÔTE D'IVOIRE » → COTE IVOIRE.
const COUNTRY = new Set(["CI", "COTE", "IVOIRE", "DIVOIRE"]);
// Particules de liaison (issues de la ponctuation : d' / l' / de / la…) — retirées pour rapprocher
// les graphies. Sans effet sur le cœur du nom.
const STOP = new Set(["DE", "DU", "DES", "D", "LA", "LE", "LES", "L", "ET", "AND", "OF", "THE"]);

/** Clé canonique d'un nom brut : MAJUSCULES déburrées, ponctuation → espace, tokens juridiques /
 *  pays / particules / bruit retirés, espaces normalisés. Ne réduit jamais à vide (repli sur le brut). */
function canonicalKey(name) {
  const base = noAcc(name).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  if (!base) return "";
  const toks = base.split(/\s+/).filter((t) => t && !LEGAL.has(t) && !COUNTRY.has(t) && !STOP.has(t) && !NOISE.has(t));
  const key = toks.join(" ").trim();
  return key || base; // si tout a été filtré (nom = uniquement forme juridique/pays), on garde le brut
}

/** Construit un résolveur `client → nom canonique` à partir de paires d'alias {from, to} (brutes).
 *  Résolution à UN niveau (pas de chaînage) : pointez les variantes directement vers la cible finale. */
function buildClientResolver(pairs) {
  const map = {};
  for (const p of pairs || []) {
    const f = canonicalKey(p && p.from);
    const t = canonicalKey(p && p.to);
    if (f && t && f !== t) map[f] = t;
  }
  return (raw) => {
    const k = canonicalKey(raw);
    if (!k) return cleanName(raw); // nom non normalisable → nettoyage minimal
    return map[k] || k;
  };
}

module.exports = { canonicalKey, buildClientResolver, LEGAL, COUNTRY };
