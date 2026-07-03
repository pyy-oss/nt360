// Dédoublonnage (BUILD_KIT §14) : regroupe par CLÉ MÉTIER canonique et désigne les
// doublons à supprimer (tous sauf le meilleur représentant). Module PUR (testable) :
// aucune dépendance Firestore. Utilisé par la Cloud Function `dedupe` (admin).
const { noAcc } = require("../lib/ids");

const n = (v) => noAcc(v).replace(/\s+/g, " ").trim();
const money = (v) => Math.round(Number(v) || 0);

// --- Clés métier : deux documents de même clé sont considérés comme doublons. ---

/** Facture : clé = Numéro normalisé (clé naturelle) ; repli sur FP+client+date+montant. */
const invoiceKey = (o) => {
  const num = n(o.numero);
  if (num) return "num:" + num;
  return "inv:" + [n(o.fp), n(o.client), o.date || "", money(o.amountHt)].join("|");
};

/** Opportunité : même N° FP + client/AM/BU/montant/étape/date de clôture ⇒ doublon (double saisie).
 *  Le FP entre dans la clé (quand présent) : deux affaires DISTINCTES de même client/montant/étape
 *  mais de FP différents ne sont PLUS fusionnées (sinon suppression destructive d'une opp réelle).
 *  FP absent des deux → clé inchangée (comportement historique préservé pour les opps sans FP). */
const opportunityKey = (o) =>
  "opp:" + [n(o.fp), n(o.client), n(o.am), n(o.bu), money(o.amount), o.stage ?? "", o.closingDate || ""].join("|");

/** BC fournisseur : n° BC + FP + fournisseur + description ; repli sur montant si pas de n°. */
const bcKey = (o) => {
  const bc = n(o.bcNumber);
  const base = [n(o.fp), n(o.supplier), n(o.description)].join("|");
  return "bc:" + (bc ? bc + "|" + base : base + "|" + money(o.amountXof));
};

// Priorité de source pour choisir le représentant à CONSERVER (source figée > saisie/legacy).
const SOURCE_RANK = { pnl: 3, facturationDf: 3, fiche: 3, salesData: 2, logistics: 2, legacy: 1, saisie: 1, bc_unitaire: 1 };

/** Score : source (prioritaire) > fraîcheur (updatedAt) > complétude (champs remplis). */
function score(o) {
  const filled = Object.values(o).filter((v) => v != null && v !== "").length;
  const src = SOURCE_RANK[o.source] || 0;
  const ts = Date.parse(o.updatedAt || "") || 0;
  return src * 1e15 + ts * 1e3 + filled;
}

/**
 * Plan de dédoublonnage : garde le meilleur de chaque groupe, liste les autres à supprimer.
 * @param {Array<{id:string}>} docs documents AVEC leur id Firestore
 * @param {(o:any)=>string} keyFn clé métier
 * @returns {{total:number, groups:number, duplicateGroups:number, duplicates:number, remove:string[]}}
 */
function planDedupe(docs, keyFn) {
  const byKey = new Map();
  for (const d of docs) {
    const k = keyFn(d);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(d);
  }
  const remove = [];
  let duplicateGroups = 0;
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    duplicateGroups++;
    arr.sort((a, b) => score(b) - score(a)); // meilleur représentant en tête
    for (let i = 1; i < arr.length; i++) remove.push(arr[i].id);
  }
  return { total: docs.length, groups: byKey.size, duplicateGroups, duplicates: remove.length, remove };
}

module.exports = { planDedupe, invoiceKey, opportunityKey, bcKey, score };
