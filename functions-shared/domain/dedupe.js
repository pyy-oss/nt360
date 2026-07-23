// Dédoublonnage (BUILD_KIT §14) : regroupe par CLÉ MÉTIER canonique et désigne les
// doublons à supprimer (tous sauf le meilleur représentant). Module PUR (testable) :
// aucune dépendance Firestore. Utilisé par la Cloud Function `dedupe` (admin).
const { noAcc, fpKey } = require("../lib/ids");

const n = (v) => noAcc(v).replace(/\s+/g, " ").trim();
const money = (v) => Math.round(Number(v) || 0);
// FP CANONIQUE pour les clés (fpKey) — sinon un même FP formaté différemment (zéros de tête, espaces)
// produirait deux clés et un doublon réel ÉCHAPPERAIT au dédup (divergence avec la DÉTECTION dataQuality
// qui, elle, utilise déjà fpKey). Repli chaîne vide si FP illisible → bascule sur la clé métier complète.
const fpk = (v) => fpKey(v) || "";

// --- Clés métier : deux documents de même clé sont considérés comme doublons. ---

/** Facture : clé = Numéro normalisé (clé naturelle) ; repli sur FP CANONIQUE+client+date+montant. */
const invoiceKey = (o) => {
  const num = n(o.numero);
  if (num) return "num:" + num;
  return "inv:" + [fpk(o.fp), n(o.client), o.date || "", money(o.amountHt)].join("|");
};

/** Opportunité :
 *  - FP PRÉSENT → clé = FP CANONIQUE SEUL (clé naturelle stable). Deux docs de même FP sont des doublons,
 *    même si D Prev/montant/étape diffèrent (attributs MUTABLES d'un même deal). Fait converger les orphelins
 *    dont l'oppId a dérivé sur d'anciens imports (formule héritée incluant D Prev/AM/client). Cf. audit cycle de vie.
 *  - FP ABSENT → clé métier COMPLÈTE (client/AM/BU/montant/étape/date) : sans clé naturelle, on ne fusionne
 *    PAS deux affaires distinctes de même client (suppression destructive). Comportement historique préservé. */
const opportunityKey = (o) => {
  const fp = fpk(o.fp);
  if (fp) return "opp:fp:" + fp;
  return "opp:" + [n(o.client), n(o.am), n(o.bu), money(o.amount), o.stage ?? "", o.closingDate || ""].join("|");
};

/** BC fournisseur : n° BC + FP CANONIQUE + fournisseur + description + MONTANT (toujours). */
const bcKey = (o) => {
  const bc = n(o.bcNumber);
  const base = [fpk(o.fp), n(o.supplier), n(o.description)].join("|");
  // Le MONTANT fait TOUJOURS partie de la clé, même avec un N° BC : un BC peut porter PLUSIEURS
  // lignes (mêmes fp/fournisseur/description, montants différents) → sans le montant elles se
  // confondraient et le dédup en supprimerait une (exposition sous-estimée). L'idempotence de
  // ré-import reste assurée par l'_id déterministe du parseur, pas par cette clé.
  return "bc:" + (bc ? bc + "|" + base : base) + "|" + money(o.amountXof);
};

// Priorité de source pour choisir le représentant à CONSERVER (source figée > saisie/legacy).
const SOURCE_RANK = { pnl: 3, facturationDf: 3, fiche: 3, salesData: 2, logistics: 2, legacy: 1, saisie: 1, bc_unitaire: 1 };

// Fraîcheur robuste : `updatedAt` est un Timestamp Firestore EN PROD (→ .toMillis()), une chaîne ISO en
// test/legacy, ou un nombre. Date.parse(<Timestamp>) donnait NaN→0 : la fraîcheur était MORTE en prod → on
// pouvait GARDER le doc périmé et SUPPRIMER la correction récente. Même conversion que lib/aggregate.js.
function freshMs(u) {
  if (u == null) return 0;
  if (typeof u.toMillis === "function") return u.toMillis(); // Timestamp Firestore (prod)
  if (typeof u === "number") return Number.isFinite(u) ? u : 0; // AVANT Date.parse (sinon "5000" = an 5000)
  const p = Date.parse(u); // chaîne ISO (test/legacy)
  return Number.isFinite(p) ? p : 0;
}
const filledCount = (o) => Object.values(o).filter((v) => v != null && v !== "").length;

// Représentant à CONSERVER : comparaison LEXICOGRAPHIQUE source figée > fraîcheur > complétude (et NON une
// somme pondérée, où la fraîcheur en millisecondes pouvait dépasser l'écart entre rangs de source et faire
// gagner une source moins prioritaire — cf. audit). cmpRep(a,b) < 0 ⇒ a est le meilleur représentant.
function cmpRep(a, b) {
  return ((SOURCE_RANK[b.source] || 0) - (SOURCE_RANK[a.source] || 0))
    || (freshMs(b.updatedAt) - freshMs(a.updatedAt))
    || (filledCount(b) - filledCount(a));
}

// Réf lisible d'un doc pour l'APERÇU avant suppression (le représentant gardé et les doublons écartés).
const refOf = (o) => o.numero || o.fp || o.bcNumber || o.client || o.id || "—";

/**
 * Plan de dédoublonnage : garde le meilleur de chaque groupe, liste les autres à supprimer, et renvoie un
 * ÉCHANTILLON de groupes (keep + remove) pour prévisualiser la suppression (op destructive → aperçu requis).
 * @param {Array<{id:string}>} docs documents AVEC leur id Firestore
 * @param {(o:any)=>string} keyFn clé métier
 * @param {number} sampleCap nombre max de groupes détaillés dans l'aperçu (0 = aucun)
 */
function planDedupe(docs, keyFn, sampleCap = 50) {
  const byKey = new Map();
  for (const d of docs) {
    const k = keyFn(d);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(d);
  }
  const remove = [];
  const sample = [];
  let duplicateGroups = 0;
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    duplicateGroups++;
    arr.sort(cmpRep); // meilleur représentant EN TÊTE (source figée > fraîcheur > complétude)
    const keep = arr[0], dups = arr.slice(1);
    for (const d of dups) remove.push(d.id);
    if (sample.length < sampleCap) {
      sample.push({
        keep: { id: keep.id, ref: refOf(keep), source: keep.source || null },
        remove: dups.map((d) => ({ id: d.id, ref: refOf(d), source: d.source || null })),
      });
    }
  }
  return { total: docs.length, groups: byKey.size, duplicateGroups, duplicates: remove.length, remove, sample };
}

module.exports = { planDedupe, invoiceKey, opportunityKey, bcKey, cmpRep, freshMs };
