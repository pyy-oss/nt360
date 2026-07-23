// LIGNES PRODUIT / DEVIS — CPQ-lite (Lot 8 « niveau Salesforce ») — une opportunité peut détailler ses
// LIGNES (produit × quantité × prix unitaire × remise), et son montant est alors DÉRIVÉ de la somme des
// lignes (comme Salesforce CPQ). Comble l'écart #8 (opportunité mono-montant, sans détail chiffrable).
//
// Fonctions PURES (aucun I/O) → testables.

// Normalise une liste de lignes : chaque ligne { product, qty, unitPrice, discountPct }. On écarte les
// lignes sans désignation, borne à 50 lignes, et clampe remise ∈ [0,100].
function sanitizeLines(input) {
  const out = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const product = String((raw && raw.product) || "").trim().slice(0, 160);
    if (!product) continue;
    const qty = Math.max(0, Number(raw.qty) || 0);
    const unitPrice = Math.max(0, Number(raw.unitPrice) || 0);
    const discountPct = Math.min(100, Math.max(0, Number(raw.discountPct) || 0));
    out.push({ product, qty, unitPrice, discountPct });
    if (out.length >= 50) break;
  }
  return out;
}

// Total d'une ligne = quantité × prix unitaire × (1 − remise%). Arrondi à l'unité (XOF, sans décimale).
function lineTotal(l) {
  return Math.round((Number(l.qty) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPct) || 0) / 100));
}

// Calcule les lignes (avec leur total) + le total général. Renvoie { lines, total }.
function computeLines(input) {
  const lines = sanitizeLines(input).map((l) => ({ ...l, lineTotal: lineTotal(l) }));
  const total = lines.reduce((s, l) => s + l.lineTotal, 0);
  return { lines, total };
}

module.exports = { sanitizeLines, lineTotal, computeLines };
