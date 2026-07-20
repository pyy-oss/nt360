// Modèle de NORMALISATION des noms de FOURNISSEURS (module PUR, testable) — variante MINIMALE.
// Contrairement aux clients (domain/clientName.js, règles + IA), la clé canonique fournisseur reste
// STRICTEMENT `cleanName` (autorité ERP-wide, ADR-P20 : espaces compactés, trim, MAJUSCULES) — AUCUN
// retrait de forme juridique / pays / bruit (ce serait un changement de sémantique du SOA, hors périmètre).
// Seul étage additionnel : une table d'ALIAS MANUELS déterministes (config/supplierAliases) qui fusionne
// les graphies que `cleanName` ne rattrape pas (ex. « SAMSUNG » ↔ « SAMSUNG ELECTRONICS »). Un alias mappe
// la clé cleanName d'une variante vers la clé cleanName de la cible. Appliqué au RECOMPUTE (non destructif) :
// les documents bruts gardent le nom d'origine. Sans alias, le résolveur est l'IDENTITÉ de `cleanName`
// (comportement SOA historique byte-identique — invariant de non-régression).
const { cleanName } = require("../lib/ids");

/** Construit un résolveur `fournisseur brut → clé canonique effective` à partir de paires {from, to} brutes.
 *  Résolution à UN niveau (pas de chaînage) : pointez les variantes directement vers la cible finale.
 *  Sans paire applicable, `resolve(x) === cleanName(x)` (identité — non-régression du SOA). */
function buildSupplierResolver(pairs) {
  const map = {};
  for (const p of pairs || []) {
    const f = cleanName(p && p.from);
    const t = cleanName(p && p.to);
    if (f && t && f !== t) map[f] = t;
  }
  return (raw) => { const k = cleanName(raw); return (k && map[k]) || k; };
}

/** ATELIER DE NORMALISATION — regroupe des noms fournisseurs BRUTS par leur CLÉ CANONIQUE EFFECTIVE
 *  (`cleanName` + alias `config/supplierAliases`). Donne l'inventaire à normaliser : quelles graphies se
 *  rejoignent déjà (même cleanName), lesquelles restent isolées, et où un alias manuel a été posé.
 *  @param {{name:string,count?:number}[]} names comptes agrégés par nom brut (tous docs confondus)
 *  @param {{from:string,to:string}[]} aliasPairs table config/supplierAliases.pairs
 *  @returns {{canon:string, variants:{name:string,count:number,aliased:boolean}[], total:number, distinct:number, hasVariants:boolean}[]}
 */
function groupSupplierNames(names, aliasPairs) {
  const resolver = buildSupplierResolver(aliasPairs);           // nom brut → clé canonique finale
  const aliasedKeys = new Set((aliasPairs || []).map((p) => cleanName(p && p.from)).filter(Boolean));
  const groups = {};
  for (const n of names || []) {
    const raw = String((n && n.name) || "");
    if (!raw.trim()) continue;
    const canon = resolver(raw);
    if (!canon) continue;
    const g = groups[canon] || (groups[canon] = { canon, variants: [], total: 0 });
    g.variants.push({ name: raw, count: Number(n && n.count) || 0, aliased: aliasedKeys.has(cleanName(raw)) });
    g.total += Number(n && n.count) || 0;
  }
  return Object.values(groups)
    .map((g) => ({ ...g, variants: g.variants.sort((a, b) => b.count - a.count), distinct: g.variants.length, hasVariants: g.variants.length > 1 }))
    .sort((a, b) => b.total - a.total);
}

module.exports = { buildSupplierResolver, groupSupplierNames };
