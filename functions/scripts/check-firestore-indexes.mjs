#!/usr/bin/env node
// Garde-fou CI : valide firestore.indexes.json AVANT qu'il ne casse le déploiement prod.
// Contexte (incident réel) : un index MONO-CHAMP déclaré dans `indexes[]` fait échouer `firebase deploy`
// avec « HTTP 400 — this index is not necessary, configure using single field index controls ». Comme
// le déploiement est ATOMIQUE (--only hosting,firestore:...,functions), ce 400 empêche TOUT (hosting +
// functions) de partir en prod — silencieusement (le CI des PR, lui, reste vert). Ce garde-fou attrape
// le cas côté CI, sur la branche, avant merge.
//
// Règles Firestore : `indexes[]` = index COMPOSITES (≥ 2 champs OU un champ en array-contains/…).
// Les index MONO-CHAMP sont gérés automatiquement (les deux ordres) → ils vont dans `fieldOverrides`,
// jamais dans `indexes[]`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, "..", "..", "firestore.indexes.json");

let doc;
try { doc = JSON.parse(readFileSync(path, "utf8")); }
catch (e) { console.error(`❌ firestore.indexes.json illisible : ${e.message}`); process.exit(1); }

const indexes = Array.isArray(doc.indexes) ? doc.indexes : [];
const errors = [];

indexes.forEach((idx, i) => {
  const ref = `indexes[${i}] (${idx.collectionGroup || "?"})`;
  const fields = Array.isArray(idx.fields) ? idx.fields : [];
  if (!idx.collectionGroup) errors.push(`${ref} : collectionGroup manquant`);
  if (!fields.length) { errors.push(`${ref} : aucun champ`); return; }
  // Un index composite valide a ≥ 2 champs. Un seul champ « order » (ASC/DESC) est mono-champ →
  // rejeté par Firestore (400). Les modes array (arrayConfig) restent valides à 1 champ.
  const hasArrayField = fields.some((f) => f.arrayConfig);
  if (fields.length < 2 && !hasArrayField) {
    const f = fields[0] || {};
    errors.push(`${ref} : index MONO-CHAMP « ${f.fieldPath} ${f.order || ""} » — interdit dans indexes[] `
      + `(géré automatiquement par Firestore ; le déclarer casse le déploiement en 400). À retirer, ou à `
      + `déplacer dans "fieldOverrides" si un override est réellement voulu.`);
  }
});

if (errors.length) {
  console.error("❌ firestore.indexes.json invalide (casserait le déploiement prod) :");
  for (const e of errors) console.error("   - " + e);
  process.exit(1);
}

console.log(`✅ firestore.indexes.json valide : ${indexes.length} index composite(s), aucun mono-champ.`);
