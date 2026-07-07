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

/** Opportunité :
 *  - FP PRÉSENT → clé = FP SEUL (clé naturelle stable). Deux docs de même FP sont des doublons, même si
 *    D Prev/montant/étape diffèrent (attributs MUTABLES d'un même deal). Fait converger les orphelins dont
 *    l'oppId a dérivé sur d'anciens imports (formule héritée incluant D Prev/AM/client). Cf. audit cycle de vie.
 *  - FP ABSENT → clé métier COMPLÈTE (client/AM/BU/montant/étape/date) : sans clé naturelle, on ne fusionne
 *    PAS deux affaires distinctes de même client (suppression destructive). Comportement historique préservé. */
const opportunityKey = (o) => {
  const fp = n(o.fp);
  if (fp) return "opp:fp:" + fp;
  return "opp:" + [n(o.client), n(o.am), n(o.bu), money(o.amount), o.stage ?? "", o.closingDate || ""].join("|");
};

/** BC fournisseur : n° BC + FP + fournisseur + description + MONTANT (toujours). */
const bcKey = (o) => {
  const bc = n(o.bcNumber);
  const base = [n(o.fp), n(o.supplier), n(o.description)].join("|");
  // Le MONTANT fait TOUJOURS partie de la clé, même avec un N° BC : un BC peut porter PLUSIEURS
  // lignes (mêmes fp/fournisseur/description, montants différents) → sans le montant elles se
  // confondraient et le dédup en supprimerait une (exposition sous-estimée). L'idempotence de
  // ré-import reste assurée par l'_id déterministe du parseur, pas par cette clé.
  return "bc:" + (bc ? bc + "|" + base : base) + "|" + money(o.amountXof);
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
