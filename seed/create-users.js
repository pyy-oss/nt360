#!/usr/bin/env node
// Création EN MASSE des comptes utilisateurs nt360 depuis un CSV. À lancer par un opérateur avec des
// identifiants Admin SDK (compte de service). Réservé au provisionnement initial ; en régime courant,
// utiliser l'UI Habilitations (createUser / setUserRole, direction-only, audité).
//
//   GOOGLE_APPLICATION_CREDENTIALS=/chemin/sa.json node seed/create-users.js utilisateurs.csv [--dry-run] [--send-reset]
//
// Format CSV (en-tête obligatoire, séparateur « , » ; ordre libre) :
//   email,role,name
//   p.pdg@neurones.ci,direction,PDG
//   dir.co@neurones.ci,commercial_dir,Directeur Commercial
//   assistante1@neurones.ci,assistante,Assistante 1
//
// • role ∈ ROLES (direction|commercial_dir|commercial|pmo|achats|assistante|lecture). Rejeté sinon.
// • Pose le custom claim NAMESPACÉ nt360Role + la fiche users/{uid} (miroir pour l'écran Habilitations).
// • Compte existant (même email) : met à jour le rôle (idempotent), ne recrée pas, ne touche pas le mot de passe.
// • --send-reset : génère un lien de définition de mot de passe (à communiquer / à faire envoyer par email).
//   Sans lui, un mot de passe temporaire aléatoire est posé (l'utilisateur le change via « Mot de passe oublié »).
// • --dry-run : n'écrit rien, affiche le plan.
const fs = require("node:fs");
const admin = require("firebase-admin");

const ROLES = ["direction", "commercial_dir", "commercial", "pmo", "achats", "assistante", "lecture"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const SEND_RESET = args.includes("--send-reset");
const csvPath = args.find((a) => !a.startsWith("--"));
if (!csvPath) { console.error("Usage: node seed/create-users.js <fichier.csv> [--dry-run] [--send-reset]"); process.exit(2); }

// Parse CSV minimal (pas de virgule dans les champs — noms simples attendus).
function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const iEmail = header.indexOf("email"), iRole = header.indexOf("role"), iName = header.indexOf("name");
  if (iEmail < 0 || iRole < 0) throw new Error("En-tête CSV doit contenir 'email' et 'role'.");
  return lines.slice(1).map((l, n) => {
    const c = l.split(",");
    return { line: n + 2, email: (c[iEmail] || "").trim().toLowerCase(), role: (c[iRole] || "").trim(), name: (iName >= 0 ? (c[iName] || "").trim() : "") };
  });
}

function randomPassword() {
  // 16 caractères base36 issus de l'horloge + compteur (pas de dépendance crypto ; mot de passe temporaire
  // que l'utilisateur remplace immédiatement via « Mot de passe oublié »).
  return "Nt!" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

admin.initializeApp();
const auth = admin.auth();
const db = admin.firestore();

async function upsertUser(row) {
  if (!EMAIL_RE.test(row.email)) return { ...row, status: "email invalide" };
  if (!ROLES.includes(row.role)) return { ...row, status: `rôle invalide (${row.role})` };
  let user = null;
  try { user = await auth.getUserByEmail(row.email); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
  const name = row.name || (user && user.displayName) || row.email.split("@")[0];
  if (DRY) return { ...row, status: user ? "MAJ rôle (dry-run)" : "création (dry-run)" };

  if (!user) user = await auth.createUser({ email: row.email, password: randomPassword(), displayName: name, emailVerified: true });
  // Claim namespacé + purge d'un éventuel legacy `role`.
  const { role: _legacy, ...keep } = user.customClaims || {};
  await auth.setCustomUserClaims(user.uid, { ...keep, nt360Role: row.role });
  await db.collection("users").doc(user.uid).set(
    { email: row.email, name, active: true, role: row.role, createdBy: "seed:create-users", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );
  let resetLink = null;
  if (SEND_RESET) { try { resetLink = await auth.generatePasswordResetLink(row.email); } catch (e) { resetLink = `(échec lien: ${e.message})`; } }
  return { ...row, uid: user.uid, status: "OK", resetLink };
}

(async () => {
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  if (!rows.length) { console.error("CSV vide."); process.exit(1); }
  console.log(`${DRY ? "[dry-run] " : ""}${rows.length} ligne(s) à traiter…\n`);
  let ok = 0, ko = 0;
  for (const row of rows) {
    try {
      const r = await upsertUser(row);
      const good = r.status === "OK" || r.status.includes("dry-run");
      good ? ok++ : ko++;
      console.log(`${good ? "✓" : "✗"} L${row.line} ${row.email} [${row.role}] — ${r.status}${r.resetLink ? `\n    reset: ${r.resetLink}` : ""}`);
    } catch (e) { ko++; console.log(`✗ L${row.line} ${row.email} — ERREUR ${e.message}`); }
  }
  console.log(`\n${DRY ? "[dry-run] " : ""}Terminé : ${ok} OK, ${ko} en échec. Rôle = custom claim → reconnexion requise.`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error("Échec:", e); process.exit(1); });
