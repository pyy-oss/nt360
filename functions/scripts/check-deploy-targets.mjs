#!/usr/bin/env node
// Garde-fou CI anti-dérive du déploiement (projet Firebase PARTAGÉ → on déploie nos fonctions PAR NOM).
// Depuis le split en codebases (docs/SPLIT-CODEBASES.md), il y a PLUSIEURS codebases, chacun avec son
// point d'entrée et son manifeste `deployed-functions.txt`. Cette garde vérifie, POUR CHAQUE codebase,
// que l'ensemble des exports de PREMIER NIVEAU de son index.js est EXACTEMENT celui de son manifeste :
//   • un export non listé  → fonction MORTE en prod (déployée nulle part) → échec.
//   • une entrée orpheline → nom obsolète dans la liste (firebase deploy échouerait « fonction inconnue ») → échec.
// Et un INVARIANT TRANSVERSE : les ensembles de fonctions des codebases sont DISJOINTS (une même fonction
// ne peut appartenir qu'à un seul codebase — sinon conflit de propriété au déploiement Firebase).
// Les triggers env-gated `ingest`/`onRecomputeRequest` sont INDENTÉS (exportés sous un `if`) donc jamais
// captés par /^exports\./ — exclus par construction, comme dans le workflow.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Un codebase = un dossier source (index.js + deployed-functions.txt) + son nom Firebase.
const CODEBASES = [
  { name: "default", root: join(here, "..") },                        // functions/
  { name: "partenariats", root: join(here, "..", "..", "functions-par") },
  { name: "rh", root: join(here, "..", "..", "functions-rh") },
  { name: "commerce", root: join(here, "..", "..", "functions-commerce") },
  { name: "ops", root: join(here, "..", "..", "functions-ops") },
];

function exportsOf(root) {
  const src = readFileSync(join(root, "index.js"), "utf8");
  return new Set([...src.matchAll(/^exports\.(\w+)\s*=/gm)].map((m) => m[1]));
}
function listedOf(root) {
  const src = readFileSync(join(root, "deployed-functions.txt"), "utf8");
  return new Set(src.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
}

let failed = false;
let total = 0;
const ownerOf = new Map(); // fonction → codebase (détecte les doublons transverses)

for (const cb of CODEBASES) {
  const exported = exportsOf(cb.root);
  const listed = listedOf(cb.root);
  const missing = [...exported].filter((n) => !listed.has(n)).sort();
  const orphan = [...listed].filter((n) => !exported.has(n)).sort();
  if (missing.length || orphan.length) {
    failed = true;
    if (missing.length) {
      console.error(`❌ [${cb.name}] EXPORTÉES mais absentes de deployed-functions.txt (mortes en prod) :`);
      for (const n of missing) console.error("   - " + n);
    }
    if (orphan.length) {
      console.error(`❌ [${cb.name}] listées mais plus exportées (obsolètes) :`);
      for (const n of orphan) console.error("   - " + n);
    }
  }
  for (const n of exported) {
    if (ownerOf.has(n)) {
      failed = true;
      console.error(`❌ Fonction « ${n} » exportée par DEUX codebases (${ownerOf.get(n)} + ${cb.name}) — conflit de propriété au déploiement.`);
    } else {
      ownerOf.set(n, cb.name);
    }
  }
  total += exported.size;
  console.log(`   • ${cb.name} : ${exported.size} fonctions`);
}

if (failed) {
  console.error("\n→ Mettez à jour le deployed-functions.txt du codebase concerné (une fonction/ligne).");
  process.exit(1);
}
console.log(`✅ Déploiement cohérent : ${total} fonctions sur ${CODEBASES.length} codebases, manifestes à jour, ensembles disjoints.`);
