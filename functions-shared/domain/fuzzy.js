// FUZZY MATCHING QUALITÉ (Lot 9 « niveau Salesforce ») — détection des QUASI-DOUBLONS de noms clients
// que la normalisation exacte (canonicalKey) N'A PAS fusionnés (fautes de frappe, mot en plus/moins).
// Comble le volet qualité de l'écart #9 : deux graphies proches d'un même client éclatent la rentabilité
// et le CA — les repérer permet de proposer un alias. Fonctions PURES (aucun I/O) → testables.

// Distance de Levenshtein (édition) entre deux chaînes.
function levenshtein(a, b) {
  a = String(a || ""); b = String(b || "");
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Similarité normalisée ∈ [0,1] = 1 − distance / longueur max. 1 = identique.
function similarity(a, b) {
  const s1 = String(a || ""), s2 = String(b || "");
  const L = Math.max(s1.length, s2.length);
  return L === 0 ? 1 : 1 - levenshtein(s1, s2) / L;
}

const FUZZY_NAME_CAP = 800; // plafond de noms comparés (coût O(n²)) — au-delà, troncature SIGNALÉE

// Radical d'un nom sans suffixe purement NUMÉRIQUE final (« AGENCE 1 » → « AGENCE »). Deux noms qui ne
// diffèrent QUE par ce suffixe sont des entités DISTINCTES numérotées (agences/lots), PAS des quasi-doublons
// → on ne les propose pas à la fusion (sinon faux positif « AGENCE 1 » ⇄ « AGENCE 2 »).
const numberedStem = (s) => String(s || "").toUpperCase().replace(/[\s.\-#°n]*\d+\s*$/i, "").trim();

// Paires de noms QUASI-identiques (similarité ≥ seuil, mais pas identiques) parmi une liste. Comparaison
// insensible à la casse/espaces. Borné (cap noms + cap résultats) pour maîtriser le coût O(n²). Renvoie
// { pairs, scanned, capped } : `scanned` = nb de noms EFFECTIVEMENT comparés, `capped` = troncature.
function findFuzzyDuplicates(names, threshold = 0.82, cap = FUZZY_NAME_CAP) {
  const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");
  const all = [...new Set((names || []).map(norm).filter(Boolean))];
  const capped = all.length > cap;
  const uniq = capped ? all.slice(0, cap) : all;
  const out = [];
  for (let i = 0; i < uniq.length; i++) {
    const ai = uniq[i].toUpperCase(), aStem = numberedStem(uniq[i]);
    for (let j = i + 1; j < uniq.length; j++) {
      // Entités numérotées distinctes (même radical, suffixe numérique différent) → PAS un doublon.
      if (aStem && aStem === numberedStem(uniq[j]) && ai !== uniq[j].toUpperCase()) continue;
      const s = similarity(ai, uniq[j].toUpperCase());
      if (s >= threshold && s < 1) out.push({ a: uniq[i], b: uniq[j], score: Math.round(s * 100) / 100 });
    }
  }
  return { pairs: out.sort((x, y) => y.score - x.score).slice(0, 200), scanned: uniq.length, capped };
}

module.exports = { levenshtein, similarity, findFuzzyDuplicates, FUZZY_NAME_CAP };
