#!/usr/bin/env node
// Garde-fou CI anti-dérive du déploiement (projet Firebase PARTAGÉ → on déploie nos fonctions PAR NOM).
// Vérifie que l'ensemble des exports de PREMIER NIVEAU de functions/index.js est EXACTEMENT celui listé
// dans functions/deployed-functions.txt (la source unique lue aussi par le workflow de déploiement).
//   • un export non listé  → fonction MORTE en prod (déployée nulle part) → échec.
//   • une entrée orpheline → nom obsolète dans la liste (firebase deploy échouerait « fonction inconnue ») → échec.
// Les triggers env-gated `ingest`/`onRecomputeRequest` sont INDENTÉS (exportés sous un `if`) donc jamais
// captés par /^exports\./ — exclus par construction, comme dans le workflow.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(here, "..", "index.js"), "utf8");
const listSrc = readFileSync(join(here, "..", "deployed-functions.txt"), "utf8");

const exported = new Set(
  [...indexSrc.matchAll(/^exports\.(\w+)\s*=/gm)].map((m) => m[1]),
);
const listed = new Set(
  listSrc.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")),
);

const missing = [...exported].filter((n) => !listed.has(n)).sort(); // exportées mais non déployées
const orphan = [...listed].filter((n) => !exported.has(n)).sort();   // listées mais plus exportées

if (missing.length || orphan.length) {
  if (missing.length) {
    console.error("❌ Fonctions EXPORTÉES mais absentes de deployed-functions.txt (mortes en prod) :");
    for (const n of missing) console.error("   - " + n);
  }
  if (orphan.length) {
    console.error("❌ Entrées de deployed-functions.txt sans export correspondant (obsolètes) :");
    for (const n of orphan) console.error("   - " + n);
  }
  console.error("\n→ Mettez à jour functions/deployed-functions.txt (une fonction/ligne).");
  process.exit(1);
}

console.log(`✅ Déploiement cohérent : ${exported.size} fonctions exportées, toutes listées.`);
