// GÉNÉRATION COMMANDE + OPPORTUNITÉ depuis des factures NON RATTACHÉES (Centre de correction).
// Regroupe les factures orphelines par N° FP CANONIQUE et propose, pour chaque FP ABSENT du carnet,
// une commande (CAS = Σ factures HT du FP) + une opportunité GAGNÉE (même FP → se réconcilient). Le FP
// FACTURE fait foi (hiérarchie d'autorité du rapprochement). Sûr en masse : on IGNORE les factures sans
// FP canonique (rien à créer — elles relèvent de « corriger le N° FP ») et les FP DÉJÀ au carnet (aucun
// doublon). Fonction PURE (aucun I/O) → testable.

const { fpKey, cleanName, cleanBu, plausibleYear, num } = require("../lib/ids");

// Année de PO extraite du N° FP (« …/2021/… »), bornée. Repli quand les factures n'ont pas de date
// exploitable : sans année de PO, la commande générée tombe HORS exercice (atterrissage la compte à
// l'année 0). Le N° FP porte quasi toujours l'année → rattachement comptable fiable.
const yearOfFp = (fp) => { const m = String(fp || "").match(/\/(\d{4})\//); return m ? plausibleYear(m[1]) : 0; };

// Montant HT d'une facture, ROBUSTE au nom de colonne (imports variés / anciens) : premier champ
// numérique non nul parmi les alias connus. Sans ça, une facture dont le montant est stocké sous
// « montant »/« montantHt » (et non « amountHt ») donnait 0 → commande générée SANS montant.
const AMOUNT_KEYS = ["amountHt", "montantHt", "montant", "amount", "amountTtc", "totalHt"];
function invoiceAmount(inv) {
  for (const k of AMOUNT_KEYS) { const v = num(inv && inv[k]); if (v) return v; }
  return 0;
}

// Valeur majoritaire d'un histogramme { valeur: occurrences } (départage déterministe par clé).
function majority(hist) {
  let best = null, n = -1;
  for (const k of Object.keys(hist).sort()) { if (hist[k] > n) { n = hist[k]; best = k; } }
  return best;
}

/**
 * @param {object[]} invoices  factures candidates { fp, client, amountHt, date, numero }
 * @param {Set<string>|string[]} existingOrderFps  FP CANONIQUES déjà au carnet (à ne pas recréer)
 * @returns {{plan: object[], skippedNoFp:number, skippedExisting:number}}
 *   plan: [{ fp, cas, client, yearPo, closingDate, invoiceCount, numeros }]
 */
function planFromInvoices(invoices, existingOrderFps) {
  const existing = existingOrderFps instanceof Set ? existingOrderFps : new Set(existingOrderFps || []);
  const byFp = new Map();
  let skippedNoFp = 0, skippedExisting = 0;
  for (const inv of invoices || []) {
    const k = fpKey(inv && inv.fp);
    if (!k) { skippedNoFp++; continue; }             // pas de FP exploitable → pas de commande à créer
    if (existing.has(k)) { skippedExisting++; continue; } // déjà au carnet → on ne double pas
    let g = byFp.get(k);
    if (!g) byFp.set(k, (g = { fp: k, cas: 0, invoiceCount: 0, clients: {}, bus: {}, years: {}, numeros: [], latestDate: "" }));
    g.cas += invoiceAmount(inv);
    g.invoiceCount++;
    const cl = cleanName(inv.client);
    if (cl) g.clients[cl] = (g.clients[cl] || 0) + 1;
    const bu = cleanBu(inv.bu);
    if (bu && bu !== "AUTRE") g.bus[bu] = (g.bus[bu] || 0) + 1; // BU depuis la facture (au lieu de « AUTRE » figé)
    const y = inv.date ? plausibleYear(String(inv.date).slice(0, 4)) : 0;
    if (y) g.years[y] = (g.years[y] || 0) + 1;
    if (inv.numero) g.numeros.push(String(inv.numero));
    if (inv.date && String(inv.date) > g.latestDate) g.latestDate = String(inv.date);
  }
  const plan = [...byFp.values()]
    .filter((g) => g.cas > 0) // une commande à CAS nul n'a pas de sens (facture d'avoir/annulée)
    .map((g) => ({
      fp: g.fp,
      cas: Math.round(g.cas),
      invoiceCount: g.invoiceCount,
      client: majority(g.clients) || "",   // "" → l'appelant pose un placeholder
      bu: majority(g.bus) || "",           // BU majoritaire des factures ("" si aucune → placeholder « AUTRE »)
      // Année de PO = année majoritaire des factures ; repli sur l'année du N° FP (rattachement comptable
      // fiable même sans date de facture) puis sur l'année de la dernière facture. Jamais 0 si le FP est daté.
      yearPo: Number(majority(g.years)) || yearOfFp(g.fp) || plausibleYear(String(g.latestDate).slice(0, 4)) || 0,
      closingDate: g.latestDate || null,
      numeros: g.numeros.slice(0, 20),
    }))
    .sort((a, b) => b.cas - a.cas);
  return { plan, skippedNoFp, skippedExisting };
}

module.exports = { planFromInvoices };
