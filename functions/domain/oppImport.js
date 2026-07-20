// Logique PURE de l'import/mise à jour EN MASSE des opportunités (BUILD_KIT — Lot 9). Testable sans
// Admin SDK ni xlsx : le parseur (parsers/oppImport.js) transforme le classeur en lignes normalisées,
// ce module DÉCIDE (upsert vs création vs ignorée) et FABRIQUE les documents/patchs, et le callable
// (index.js importOpportunities) garde l'I/O (Firestore, auth, audit, recompute, transitions).
//
// RÈGLE DE RAPPROCHEMENT : Opp ID d'abord (identité stable = doc id), sinon N° FP (clé naturelle du
// carnet), sinon CRÉATION d'une opp `saisie`. Le N° FP et l'Opp ID sont des clés de MATCH — jamais
// modifiés sur une opp existante (l'identité reste maîtrisée par la source / la correction unitaire).
// MISE À JOUR NON EFFAÇANTE : seules les cellules RENSEIGNÉES écrasent la valeur courante ; une colonne
// vide ne remet jamais un champ à blanc (le vidage d'un champ passe par l'édition unitaire).
const { clampStage, oppWeighted } = require("./mutations");
const { STAGE_LABEL, DEFAULT_PROBA } = require("../parsers/salesData");

// Champs MUTABLES par l'import (ni l'Opp ID, ni le N° FP, ni la source). L'ordre n'a pas d'importance.
const MUTABLE_KEYS = [
  "client", "designation", "am", "bu", "amount", "stage", "probability",
  "mbPrev", "dr", "closingDate", "nextStep", "nextStepDate", "lostReason",
];

// Égalité « métier » entre valeur courante (Firestore) et valeur normalisée d'une cellule présente,
// pour ne PROPOSER que de vrais changements (une ré-import à l'identique ne doit RIEN modifier).
function sameField(cur, next) {
  if (typeof next === "number") return (Number(cur) || 0) === next;
  if (typeof next === "boolean") return !!cur === next;
  // Texte comparé INSENSIBLE À LA CASSE : le parseur canonicalise client/AM en MAJUSCULES (cleanName/
  // cleanPerson) alors que la saisie in-app les stocke en casse mixte — sans ça un aller-retour SANS
  // édition proposerait un faux changement et réécrirait silencieusement le champ en majuscules.
  return String(cur == null ? "" : cur).trim().toLowerCase() === String(next == null ? "" : next).trim().toLowerCase();
}

const pickBefore = (cur, keys) => Object.fromEntries(keys.map((k) => [k, cur[k] ?? null]));

/**
 * Plan d'import PUR : classe chaque ligne parsée en mise à jour / création / ignorée.
 * @param {Map<string,object>} byId  opps indexées par doc id ET par oppId (mêmes valeurs)
 * @param {Map<string,object>} byFp  opps indexées par N° FP normalisé (1re rencontrée si doublon)
 * @param {{oppId?:string, fp?:string, values:object, line:number}[]} rows lignes normalisées du classeur
 * @returns {{toUpdate:object[], toCreate:object[], skipped:object[]}}
 */
function planOpportunityImport(byId, byFp, rows) {
  const toUpdate = [], toCreate = [], skipped = [];
  for (const row of rows) {
    const line = row.line;
    let cur = null, matchBy = null;
    if (row.oppId && byId.has(row.oppId)) { cur = byId.get(row.oppId); matchBy = "id"; }
    else if (row.fp && byFp.has(row.fp)) { cur = byFp.get(row.fp); matchBy = "fp"; }

    if (cur) {
      const patch = {}, changed = [];
      for (const k of MUTABLE_KEYS) {
        if (!(k in row.values)) continue;             // cellule absente → jamais touchée (non effaçant)
        if (!sameField(cur[k], row.values[k])) { patch[k] = row.values[k]; changed.push(k); }
      }
      const id = cur.id || cur.oppId;
      if (!changed.length) { skipped.push({ line, id, client: cur.client || null, reason: "aucun changement" }); continue; }
      toUpdate.push({ line, id, matchBy, patch, changed, before: pickBefore(cur, changed), client: cur.client || null, stageFrom: Number(cur.stage) || 0 });
    } else {
      const client = row.values.client;
      if (!client) { skipped.push({ line, reason: "ni Opp ID ni N° FP connu, et client vide → ignorée" }); continue; }
      // `oppId` = Opp ID SOURCE de la ligne (id externe d'un CRM tiers, distinct de l'id `saisie_` généré).
      // Persisté sur le doc créé (srcOppId) pour que le PROCHAIN import le retrouve → pas de doublon.
      toCreate.push({ line, fp: row.fp || null, oppId: row.oppId || null, values: row.values, client });
    }
  }
  return { toUpdate, toCreate, skipped };
}

/**
 * Complète un patch de mise à jour avec les champs DÉRIVÉS (étiquette d'étape + pondéré recalculé),
 * en s'appuyant sur les valeurs courantes pour les composantes non modifiées. PUR.
 */
function finalizeUpdatePatch(cur, patch) {
  const out = { ...patch };
  if ("stage" in out) out.stageLabel = STAGE_LABEL[out.stage] || String(out.stage);
  if ("amount" in out || "probability" in out) {
    out.weighted = oppWeighted("amount" in out ? out.amount : cur.amount, "probability" in out ? out.probability : cur.probability);
  }
  return out;
}

/**
 * Construit le document d'une opportunité CRÉÉE (source `saisie`) à partir des valeurs normalisées.
 * Étape par défaut 1 ; proba = valeur fournie (0..1) sinon défaut de l'étape (jamais un pondéré à 0 par
 * oubli). L'identité (`oppId`) et le `fp` sont fournis par l'appelant (clés de match, non dans values). PUR.
 */
function buildCreateDoc(values, fp, id, srcOppId) {
  const stage = "stage" in values ? clampStage(values.stage) : 1;
  const pr = values.probability;
  const probability = (typeof pr === "number" && pr > 0 && pr <= 100) ? pr : (DEFAULT_PROBA[stage] ?? 0);
  const amount = Number(values.amount) || 0;
  return {
    oppId: id, source: "saisie",
    // Opp ID SOURCE (CRM tiers) conservé comme CLÉ DE MATCH additive → un ré-import de la même ligne
    // (sans N° FP) retrouve ce doc au lieu d'en recréer un (idempotence). Null si la ligne n'en portait pas.
    srcOppId: srcOppId || null,
    client: values.client, am: values.am || "", bu: values.bu || "AUTRE",
    fp: fp || null,
    amount, stage, stageLabel: STAGE_LABEL[stage] || String(stage),
    probability, weighted: oppWeighted(amount, probability),
    closingDate: values.closingDate || null,
    designation: values.designation || null,
    mbPrev: ("mbPrev" in values) ? values.mbPrev : null,
    dr: ("dr" in values) ? values.dr : false,
    nextStep: values.nextStep || null,
    nextStepDate: values.nextStepDate || null,
    lostReason: values.lostReason || null,
  };
}

/**
 * Décide s'il faut JOURNALISER un glissement de D Prev (closingDate) pour une mise à jour d'import → alimente
 * le slippage (summaries/oppSlippage), à PARITÉ avec patchOpportunity/upsertOpportunity. Renvoie l'événement
 * à écrire (mêmes champs que recordOppDateChange) ou `null` si la date n'a pas changé. PUR (aucun I/O).
 * Lot 11 : sans ce journal, le slippage était aveugle aux mouvements de date issus des imports (voie dominante).
 * @param {object} cur   opp courante (Firestore)
 * @param {object} patch patch finalisé appliqué (contient closingDate/amount/am/stage/forecastCategory si modifiés)
 * @param {string} uid   auteur de l'import
 */
function importDateChange(cur, patch, uid) {
  const c = cur || {}, p = patch || {};
  if (p.closingDate === undefined) return null; // la cellule n'était pas dans le fichier → date jamais touchée
  const toD = String(p.closingDate || "").slice(0, 10);
  const fromD = String(c.closingDate || "").slice(0, 10);
  if (toD === fromD) return null; // même jour → pas un glissement
  return {
    oppId: c.id || c.oppId || null, from: c.closingDate || null, to: p.closingDate || null,
    amount: p.amount !== undefined ? p.amount : (Number(c.amount) || 0),
    am: p.am !== undefined ? p.am : (c.am || null),
    stage: p.stage !== undefined ? p.stage : (Number(c.stage) || 0),
    forecastCategory: p.forecastCategory !== undefined ? p.forecastCategory : (c.forecastCategory || null),
    client: c.client || null, uid: uid || null,
  };
}

module.exports = { MUTABLE_KEYS, sameField, planOpportunityImport, finalizeUpdatePatch, buildCreateDoc, importDateChange };
