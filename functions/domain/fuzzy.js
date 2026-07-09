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

// Paires de noms QUASI-identiques (similarité ≥ seuil, mais pas identiques) parmi une liste. Comparaison
// insensible à la casse/espaces. Borné (cap noms + cap résultats) pour maîtriser le coût O(n²).
function findFuzzyDuplicates(names, threshold = 0.82, cap = 800) {
  const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");
  const uniq = [...new Set((names || []).map(norm).filter(Boolean))].slice(0, cap);
  const out = [];
  for (let i = 0; i < uniq.length; i++) {
    const ai = uniq[i].toUpperCase();
    for (let j = i + 1; j < uniq.length; j++) {
      const s = similarity(ai, uniq[j].toUpperCase());
      if (s >= threshold && s < 1) out.push({ a: uniq[i], b: uniq[j], score: Math.round(s * 100) / 100 });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 200);
}

module.exports = { levenshtein, similarity, findFuzzyDuplicates };
