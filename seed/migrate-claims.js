#!/usr/bin/env node
// Migration one-shot : renomme le custom claim `role` → `nt360Role` sur TOUS les comptes.
// Contexte : le projet Firebase est PARTAGÉ avec une autre app ; un claim générique `role` est commun
// aux deux → un `role:direction` posé par l'app sœur escaladait dans nt360. On namespace le claim.
//
// À exécuter UNE FOIS par un opérateur avec des identifiants Admin SDK (compte de service), AVANT ou
// juste après le déploiement des rules/functions namespacées. Les sessions actives reprennent le nouveau
// claim au prochain rafraîchissement du jeton (≤ 1 h) ou à la reconnexion.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/chemin/sa.json node seed/migrate-claims.js [--dry-run]
//
// Idempotent : réexécutable sans risque (un compte déjà migré est laissé tel quel).
const admin = require("firebase-admin");

const DRY = process.argv.includes("--dry-run");
admin.initializeApp();
const auth = admin.auth();

async function main() {
  let migrated = 0, already = 0, skipped = 0, scanned = 0;
  let pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) {
      scanned++;
      const claims = u.customClaims || {};
      const legacy = claims.role;
      if (legacy === undefined && claims.nt360Role === undefined) { skipped++; continue; } // aucun rôle
      if (claims.nt360Role !== undefined && legacy === undefined) { already++; continue; }   // déjà migré
      // Cible : nt360Role = valeur namespacée existante sinon l'ancien `role` ; on retire toujours `role`.
      const { role: _drop, ...keep } = claims;
      const next = { ...keep, nt360Role: claims.nt360Role ?? legacy };
      console.log(`${DRY ? "[dry-run] " : ""}${u.email || u.uid} : role=${JSON.stringify(legacy)} → nt360Role=${JSON.stringify(next.nt360Role)}`);
      if (!DRY) await auth.setCustomUserClaims(u.uid, next);
      migrated++;
    }
    pageToken = res.pageToken;
  } while (pageToken);

  console.log(`\n${DRY ? "[dry-run] " : ""}Terminé : ${scanned} comptes scannés — ${migrated} migré(s), ${already} déjà à jour, ${skipped} sans rôle.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("Échec migration :", e); process.exit(1); });
