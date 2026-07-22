#!/usr/bin/env node
// Transfert des custom claims `nt360Role` d'un projet à un AUTRE (migration projet dédié).
// `auth:export`/`auth:import` préservent UID + hash de mots de passe mais PAS les custom claims → sans ce
// script, chaque compte du nouveau projet tombe sur « Compte en attente d'habilitation » (RBAC bloqué).
//
// Prérequis : deux clés de compte de service Admin (ancien + nouveau projet), et que les UTILISATEURS
// aient déjà été importés côté nouveau projet (mêmes UID via `firebase auth:import`).
//
//   GOOGLE_APPLICATION_CREDENTIALS_OLD=/chemin/ancien-sa.json \
//   GOOGLE_APPLICATION_CREDENTIALS_NEW=/chemin/neurones-360-sa.json \
//   node seed/migrate-claims-cross.js [--dry-run]
//
// Idempotent : un compte déjà porteur du bon nt360Role est laissé tel quel. On ne pose QUE nt360Role
// (jamais l'ancien `role` non namespacé). Ré-exécutable sans risque.
const admin = require("firebase-admin");

const DRY = process.argv.includes("--dry-run");
const OLD_CRED = process.env.GOOGLE_APPLICATION_CREDENTIALS_OLD;
const NEW_CRED = process.env.GOOGLE_APPLICATION_CREDENTIALS_NEW;
if (!OLD_CRED || !NEW_CRED) {
  console.error("Définir GOOGLE_APPLICATION_CREDENTIALS_OLD et _NEW (chemins des clés SA des deux projets).");
  process.exit(2);
}

const oldApp = admin.initializeApp({ credential: admin.credential.cert(require(OLD_CRED)) }, "old");
const newApp = admin.initializeApp({ credential: admin.credential.cert(require(NEW_CRED)) }, "new");
const oldAuth = oldApp.auth();
const newAuth = newApp.auth();

// Rôle namespacé porté par un compte (nt360Role, ou l'ancien `role` en repli pour les comptes non migrés).
const roleOf = (claims) => (claims && (claims.nt360Role ?? claims.role)) ?? undefined;

async function main() {
  // 1. Dump {uid → nt360Role} de l'ANCIEN projet.
  const wanted = new Map();
  let pageToken;
  do {
    const res = await oldAuth.listUsers(1000, pageToken);
    for (const u of res.users) {
      const r = roleOf(u.customClaims);
      if (r !== undefined) wanted.set(u.uid, { role: r, email: u.email || u.uid });
    }
    pageToken = res.pageToken;
  } while (pageToken);
  console.log(`Ancien projet : ${wanted.size} compte(s) porteur(s) d'un rôle.`);

  // 2. Ré-application sur le NOUVEAU projet (par UID — mêmes UID via auth:import).
  let set = 0, already = 0, missing = 0;
  for (const [uid, { role, email }] of wanted) {
    let target;
    try { target = await newAuth.getUser(uid); }
    catch { missing++; console.warn(`  MANQUANT sur le nouveau projet : ${email} (${uid}) — importer les comptes Auth d'abord.`); continue; }
    const current = roleOf(target.customClaims);
    if (current === role && (target.customClaims || {}).role === undefined) { already++; continue; } // déjà à jour + propre
    const { role: _drop, ...keep } = target.customClaims || {};
    const next = { ...keep, nt360Role: role };
    console.log(`${DRY ? "[dry-run] " : ""}${email} : nt360Role=${JSON.stringify(role)}`);
    if (!DRY) await newAuth.setCustomUserClaims(uid, next);
    set++;
  }
  console.log(`\n${DRY ? "[dry-run] " : ""}Terminé : ${set} posé(s), ${already} déjà à jour, ${missing} absent(s) du nouveau projet.`);
  if (missing) process.exitCode = 1; // signale qu'il manque des comptes (Auth non importé)
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error("Échec :", e); process.exit(1); });
