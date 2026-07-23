// GARDE CI « bundle déployable » (ADR-SPLIT-02) — attrape AVANT le merge la classe de bug qui a
// fait échouer le déploiement du split (run #597, 2026-07-23) : chaque codebase dépend de
// `@nt360/functions-shared` en `workspace:*`, protocole que le `npm install` de Cloud Build ne
// comprend pas (`EUNSUPPORTEDPROTOCOL`). On COMPILE désormais chaque codebase (esbuild) dans
// `.deploy/` avec le socle inliné. Cette garde vérifie, pour les 5 codebases, que :
//   1. le bundle se PRODUIT (esbuild n'échoue pas) ;
//   2. le `package.json` déployé ne contient AUCUNE dépendance `workspace:*` (sinon Cloud Build casse) ;
//   3. le bundle se CHARGE (require) et expose EXACTEMENT les fonctions du manifeste deployed-functions.txt
//      (parité découverte Firebase ⇔ cibles nommées — aucune fonction perdue/ajoutée par le bundling).
// Ne remplace pas un vrai `firebase deploy` (le comportement npm de Cloud Build reste hors sandbox),
// mais verrouille tout ce qui est vérifiable statiquement.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");

// codebase dir → manifeste
const CODEBASES = ["functions", "functions-par", "functions-rh", "functions-commerce", "functions-ops"];

const manifestCount = (dir) => {
  const f = path.join(repoRoot, dir, "deployed-functions.txt");
  return fs.readFileSync(f, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).length;
};

let failed = 0;
for (const dir of CODEBASES) {
  try {
    // 1. produire le bundle
    execFileSync("node", ["scripts/bundle-codebase.mjs", dir], { cwd: repoRoot, stdio: "pipe" });

    // 2. package.json déployé sans workspace:*
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, dir, ".deploy", "package.json"), "utf8"));
    const wsDeps = Object.entries(pkg.dependencies || {}).filter(([, v]) => String(v).startsWith("workspace:"));
    if (wsDeps.length) {
      console.error(`❌ ${dir} : package.json déployé contient encore du workspace:* → ${wsDeps.map(([k]) => k).join(", ")}`);
      failed++; continue;
    }

    // 3. charger le bundle + compter les triggers, comparer au manifeste.
    // CHAQUE bundle dans SON process (comme au déploiement) : sinon le 2e admin.initializeApp()
    // lève « default app already exists » — faux positif dû au partage de process, pas au bundle.
    const bundlePath = path.join(repoRoot, dir, ".deploy", "index.js");
    const out = execFileSync("node", ["-e",
      `const m=require(process.argv[1]);` +
      `console.log(Object.keys(m).filter(k=>m[k]&&(m[k].__endpoint||m[k].__trigger||typeof m[k]==='function')).length)`,
      bundlePath], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    const triggers = parseInt(String(out).trim(), 10);
    const expected = manifestCount(dir);
    if (triggers !== expected) {
      console.error(`❌ ${dir} : bundle expose ${triggers} fonctions, manifeste en attend ${expected}.`);
      failed++; continue;
    }
    console.log(`✅ ${dir} : bundle OK, self-contained, ${triggers}/${expected} fonctions.`);
  } catch (e) {
    console.error(`❌ ${dir} : ${e.stderr ? e.stderr.toString() : e.message}`);
    failed++;
  }
}

if (failed) {
  console.error(`\n❌ Garde bundle : ${failed} codebase(s) en échec — voir ci-dessus.`);
  process.exit(1);
}
console.log(`\n✅ Garde bundle : ${CODEBASES.length} codebases compilés, self-contained, parité manifeste OK.`);
