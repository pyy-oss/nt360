#!/usr/bin/env node
// Déploiement SÉLECTIF — dérive les cibles `functions:` d'un `git diff`.
//
// But coût : si un commit/merge ne touche RIEN sous functions/ (ex. un changement web/ ou doc seul),
// on ne redéploie AUCUNE fonction → zéro conteneur Cloud Build rebâti, zéro réconciliation Cloud Run.
// Le hosting + les règles Firestore (bon marché, idempotents) restent déployés par le workflow.
//
// Fail-safe : au MOINDRE doute (base git introuvable, clone superficiel, diff en échec, drapeau --all),
// on renvoie la liste COMPLÈTE des fonctions (comportement historique). Le script ne peut donc JAMAIS
// rendre un déploiement MOINS sûr — au pire il déploie autant qu'avant.
//
// Sortie (stdout) : la liste des cibles `functions:<nom>` séparées par des virgules, ou VIDE si aucune
// fonction n'est concernée. Diagnostics sur stderr. Le workflow y ajoute hosting/firestore et les
// fonctions env-gated (onRecomputeRequest…). Voir .github/workflows/firebase-deploy.yml et RUNBOOK-COUTS.md.
//
// Usage : node functions/scripts/deploy-targets.mjs --base <ref>   (défaut : $DEPLOY_BASE ou HEAD^)
//         node functions/scripts/deploy-targets.mjs --all          (force la liste complète)

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// Depuis le split en codebases (docs/SPLIT-CODEBASES.md) : UN manifeste par codebase. La liste complète
// = l'union de tous. `firebase deploy --only functions:<nom>` retrouve le codebase propriétaire de <nom>.
const MANIFESTS = [
  resolve(HERE, "../deployed-functions.txt"),               // codebase default (functions/)
  resolve(HERE, "../../functions-par/deployed-functions.txt"), // codebase partenariats (functions-par/)
  resolve(HERE, "../../functions-rh/deployed-functions.txt"),  // codebase rh (functions-rh/)
  resolve(HERE, "../../functions-commerce/deployed-functions.txt"), // codebase commerce (functions-commerce/)
  resolve(HERE, "../../functions-ops/deployed-functions.txt"),      // codebase ops (functions-ops/)
];

function fullTargets() {
  // Union des sources uniques de vérité (une fonction/ligne ; # et vides ignorées), les mêmes fichiers
  // que vérifie check-deploy-targets.mjs contre les exports de chaque index.js.
  const names = [];
  for (const m of MANIFESTS) {
    for (const l of readFileSync(m, "utf8").split("\n").map((s) => s.trim())) {
      if (l && !l.startsWith("#")) names.push(l);
    }
  }
  return names.map((fn) => `functions:${fn}`);
}

// Un chemin modifié impacte-t-il le DÉPLOIEMENT des fonctions ? Oui si sous functions/ OU functions-shared/
// (le socle partagé : un changement y redéploie le codebase — cf. docs/SPLIT-CODEBASES.md), SAUF les tests
// (non déployés) et la doc. deployed-functions.txt compte (change la liste des cibles). scripts/ compte
// (conservateur : un changement d'outillage de déploiement mérite un déploiement complet de vérification).
function affectsFunctions(path) {
  const inFunctions = path.startsWith("functions/");
  const inShared = path.startsWith("functions-shared/");
  const inPar = path.startsWith("functions-par/");
  const inRh = path.startsWith("functions-rh/");
  const inCommerce = path.startsWith("functions-commerce/");
  const inOps = path.startsWith("functions-ops/");
  if (!inFunctions && !inShared && !inPar && !inRh && !inCommerce && !inOps) return false;
  if (path.startsWith("functions/test/") || path.startsWith("functions-shared/test/")) return false;
  if (path.endsWith(".md")) return false;
  return true;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--all")) { process.stdout.write(fullTargets().join(",")); return; }

  const baseIdx = args.indexOf("--base");
  const base = (baseIdx >= 0 && args[baseIdx + 1]) || process.env.DEPLOY_BASE || "HEAD^";

  let changed;
  try {
    const out = execSync(`git diff --name-only ${base} HEAD`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    changed = out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    // Base inconnue / clone superficiel / diff impossible → fail-safe : tout déployer.
    process.stderr.write(`deploy-targets: git diff (base=${base}) impossible → repli sur la liste COMPLÈTE.\n`);
    process.stdout.write(fullTargets().join(","));
    return;
  }

  if (!changed.length) {
    // Aucun fichier détecté (base == HEAD ?) → prudence : liste complète (on ne « saute » jamais par erreur).
    process.stderr.write("deploy-targets: aucun fichier au diff → repli sur la liste COMPLÈTE (prudence).\n");
    process.stdout.write(fullTargets().join(","));
    return;
  }

  const fnTouched = changed.some(affectsFunctions);
  if (fnTouched) {
    process.stderr.write("deploy-targets: changements sous functions/ détectés → déploiement des fonctions.\n");
    process.stdout.write(fullTargets().join(","));
  } else {
    process.stderr.write(`deploy-targets: aucun changement fonctionnel (${changed.length} fichier(s), hors functions/) → 0 fonction déployée.\n`);
    process.stdout.write(""); // vide = le workflow ne déploie que hosting/firestore
  }
}

main();
