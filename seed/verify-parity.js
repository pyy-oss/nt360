#!/usr/bin/env node
// GATE go/no-go de la migration : compare le NOMBRE de documents par collection entre l'ancien et le
// nouveau projet (base NOMMÉE nt360 des deux côtés). Attrape les tueurs silencieux : une collection non
// importée, des docs config/* manquants (alias, secrets HMAC webhooks), un import partiel. « Zéro faute »
// = aucune ligne d'écart (ou seulement des écarts ATTENDUS, ex. summaries recalculés côté neuf).
//
//   GOOGLE_APPLICATION_CREDENTIALS_OLD=/chemin/ancien-sa.json \
//   GOOGLE_APPLICATION_CREDENTIALS_NEW=/chemin/neurones-360-sa.json \
//   node seed/verify-parity.js
//
// Sort en code 1 s'il existe un écart (utilisable en garde de script). Base nommée « nt360 » gérée via
// getFirestore(app, 'nt360') — un comptage sur (default) donnerait 0 partout (piège classique).
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

const OLD_CRED = process.env.GOOGLE_APPLICATION_CREDENTIALS_OLD;
const NEW_CRED = process.env.GOOGLE_APPLICATION_CREDENTIALS_NEW;
const DB = process.env.FIRESTORE_DATABASE || "nt360";
if (!OLD_CRED || !NEW_CRED) {
  console.error("Définir GOOGLE_APPLICATION_CREDENTIALS_OLD et _NEW.");
  process.exit(2);
}

const oldDb = getFirestore(admin.initializeApp({ credential: admin.credential.cert(require(OLD_CRED)) }, "old"), DB);
const newDb = getFirestore(admin.initializeApp({ credential: admin.credential.cert(require(NEW_CRED)) }, "new"), DB);

// Compte les docs d'une collection via l'agrégation count() (efficace, pas de lecture des docs).
async function countAll(db) {
  const cols = await db.listCollections();
  const out = {};
  for (const c of cols) {
    const agg = await c.count().get();
    out[c.id] = agg.data().count;
  }
  return out;
}

async function main() {
  const [oldC, newC] = await Promise.all([countAll(oldDb), countAll(newDb)]);
  const names = [...new Set([...Object.keys(oldC), ...Object.keys(newC)])].sort();
  let diffs = 0;
  console.log(`${"collection".padEnd(28)} ${"ancien".padStart(9)} ${"neuf".padStart(9)}  écart`);
  console.log("-".repeat(60));
  for (const n of names) {
    const a = oldC[n] || 0, b = newC[n] || 0;
    const flag = a === b ? "  ok" : `  ⚠ ${b - a > 0 ? "+" : ""}${b - a}`;
    if (a !== b) diffs++;
    console.log(`${n.padEnd(28)} ${String(a).padStart(9)} ${String(b).padStart(9)}${flag}`);
  }
  console.log("-".repeat(60));
  if (diffs === 0) {
    console.log("✅ Parité stricte : aucune collection en écart.");
  } else {
    console.log(`⚠ ${diffs} collection(s) en écart. Attendus possibles : summaries/* (recalculés côté neuf).`);
    console.log("  Tout le reste en écart = import incomplet → NE PAS BASCULER avant résolution.");
    process.exitCode = 1;
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error("Échec :", e); process.exit(1); });
