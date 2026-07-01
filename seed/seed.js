#!/usr/bin/env node
// Amorçage du socle RBAC (BUILD_KIT §14, §15 F1) :
//   1) écrit la matrice de droits dans config/permissions
//   2) crée (ou réutilise) le 1er utilisateur `direction` et lui pose le custom claim
//
// Usage :
//   Émulateur :  FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//                GCLOUD_PROJECT=propulse-business-87f7a node seed/seed.js admin@nt.ci MotDePasse123
//   Prod :       GOOGLE_APPLICATION_CREDENTIALS=./sa.json node seed/seed.js admin@nt.ci MotDePasse123
const { readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { createRequire } = require("node:module");
// firebase-admin est résolu depuis le codebase functions (monorepo pnpm).
const freq = createRequire(join(__dirname, "../functions/package.json"));
const { initializeApp, applicationDefault } = freq("firebase-admin/app");
const { getFirestore } = freq("firebase-admin/firestore");
const { getAuth } = freq("firebase-admin/auth");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "propulse-business-87f7a";
const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

// Sur émulateur, pas de credentials requis ; en prod, ADC (compte de service).
initializeApp(useEmulator ? { projectId } : { credential: applicationDefault(), projectId });

const db = getFirestore();
const auth = getAuth();

async function main() {
  const [email, password] = process.argv.slice(2);
  const matrix = JSON.parse(readFileSync(resolve(__dirname, "permissions.json"), "utf8")).matrix;

  // 1) Matrice de droits (idempotent, merge).
  await db.doc("config/permissions").set({ matrix }, { merge: true });
  console.log("✓ config/permissions écrit (matrice §8)");

  if (!email || !password) {
    console.log("ℹ Aucun email/mot de passe fourni — 1er admin non créé.");
    console.log("  Usage : node seed/seed.js <email> <password>");
    return;
  }

  // 2) 1er utilisateur `direction`.
  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`✓ Utilisateur existant réutilisé : ${email} (${user.uid})`);
  } catch {
    user = await auth.createUser({ email, password, emailVerified: true });
    console.log(`✓ Utilisateur créé : ${email} (${user.uid})`);
  }

  await auth.setCustomUserClaims(user.uid, { role: "direction" });
  await db.collection("users").doc(user.uid).set(
    { email, name: email.split("@")[0], active: true },
    { merge: true }
  );
  console.log(`✓ Rôle 'direction' posé sur ${user.uid}. Les autres rôles se posent via setUserRole.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("✗ Échec du seed :", e);
  process.exit(1);
});
