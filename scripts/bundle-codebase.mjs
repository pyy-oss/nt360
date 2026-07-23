// BUNDLE D'UN CODEBASE FIREBASE POUR LE DÉPLOIEMENT (esbuild) — ADR-SPLIT-02.
//
// Pourquoi : le split en codebases fait dépendre chaque codebase du package workspace
// `@nt360/functions-shared` via `"workspace:*"`. Au déploiement, Firebase envoie le source à
// Cloud Build qui lance `npm install` (npm, PAS pnpm) → npm ne connaît pas le protocole
// `workspace:` → `EUNSUPPORTEDPROTOCOL` → le build de CHAQUE fonction échoue (cf. run deploy
// #597 du 2026-07-23). C'est le risque résiduel « empaquetage de la dépendance workspace »
// signalé à l'Étape 0.
//
// Solution : on COMPILE le codebase avec esbuild dans `<codebase>/.deploy/` :
//  - `@nt360/functions-shared` (et ses sous-chemins) est INLINÉ dans le bundle → plus aucune
//    dépendance `workspace:*` dans le `package.json` déployé.
//  - TOUTE autre importation « bare » (firebase-functions, firebase-admin, exceljs, …) reste
//    EXTERNE → réinstallée par npm côté Cloud Build (comme aujourd'hui), avec sa version prise
//    dans la source de vérité (functions/package.json ∪ functions-shared/package.json).
//  - firebase-functions/-admin DOIVENT rester externes : le Functions Framework les `require`
//    lui-même pour découvrir les triggers (les inliner casse la découverte des endpoints).
//  - On ne liste dans le `package.json` déployé que les deps RÉELLEMENT référencées par le
//    bundle (metafile esbuild) → pas de dépendance lourde inutile (pdfkit/pdfjs/exceljs) dans un
//    petit codebase → images plus légères, cold start moindre (règle coûts GCP).
//
// firebase.json pointe `source` sur `<codebase>/.deploy` ; un hook `predeploy` lance ce script.
// Le `.env` de la source (écrit par le workflow : IMPORTS_BUCKET/APPCHECK_ENFORCE/RECOMPUTE_REGION)
// est recopié dans `.deploy/` car Firebase lit le `.env` DANS le dossier source du codebase.
//
// Usage : node scripts/bundle-codebase.mjs <codebaseDir>   (ex. functions-par, functions)

import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const srcRel = process.argv[2];
if (!srcRel) {
  console.error("usage: node scripts/bundle-codebase.mjs <codebaseDir> [--install]");
  process.exit(2);
}
// --install : installe node_modules DANS .deploy (deps réelles, plus de workspace:*). REQUIS au
// déploiement : firebase-tools charge le code LOCALEMENT pour découvrir les triggers et exige
// firebase-functions résoluble depuis le dossier source (sinon « Failed to find location of Firebase
// Functions SDK »). Inutile pour la garde CI (elle charge via le node_modules hoïsté du repo).
const doInstall = process.argv.includes("--install");
const srcDir = path.join(repoRoot, srcRel);
const outDir = path.join(srcDir, ".deploy");
const entry = path.join(srcDir, "index.js");
if (!fs.existsSync(entry)) {
  console.error(`❌ ${srcRel} : ${entry} introuvable`);
  process.exit(1);
}

const SHARED = "@nt360/functions-shared";
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => "node:" + m)]);

// Source de vérité des versions : deps déclarées de functions/ ET du socle partagé (elles
// s'accordent ; en cas de collision on privilégie functions/, le codebase historique).
const readDeps = (p) => {
  try { return JSON.parse(fs.readFileSync(path.join(repoRoot, p), "utf8")).dependencies || {}; }
  catch { return {}; }
};
const versionMap = { ...readDeps("functions-shared/package.json"), ...readDeps("functions/package.json") };
delete versionMap[SHARED];

// Plugin : on n'inline QUE le relatif/absolu + le package partagé ; tout autre import « bare »
// (paquets npm réels, builtins node) est laissé EXTERNE (résolu par npm à l'exécution).
const externalizeAllButShared = {
  name: "externalize-all-but-shared",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") return undefined;
      const p = args.path;
      if (p.startsWith(".") || path.isAbsolute(p)) return undefined; // → bundle
      if (p === SHARED || p.startsWith(SHARED + "/")) return undefined; // → bundle (inline)
      return { external: true }; // paquets npm + builtins → externes
    });
  },
};

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(outDir, "index.js"),
  metafile: true,
  logLevel: "warning",
  plugins: [externalizeAllButShared],
});

// Garde-fou : aucune trace résiduelle du package workspace dans le bundle produit.
const bundled = fs.readFileSync(path.join(outDir, "index.js"), "utf8");
if (bundled.includes(SHARED)) {
  console.error(`❌ ${srcRel} : le bundle référence encore ${SHARED} — inlining incomplet.`);
  process.exit(1);
}

// Dépendances runtime = imports externes réellement référencés (hors builtins), versionnés.
const used = new Set();
for (const out of Object.values(result.metafile.outputs)) {
  for (const imp of out.imports || []) if (imp.external) used.add(imp.path);
}
const deps = {};
const missing = [];
for (const name of [...used].sort()) {
  if (BUILTINS.has(name) || BUILTINS.has(name.replace(/^node:/, ""))) continue;
  const pkg = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
  if (versionMap[pkg]) deps[pkg] = versionMap[pkg];
  else missing.push(name);
}
if (missing.length) {
  console.error(`❌ ${srcRel} : deps externes sans version connue (ajouter à functions/package.json) : ${missing.join(", ")}`);
  process.exit(1);
}

// package.json déployé : self-contained, SANS workspace:* — npm côté Cloud Build l'installe.
const pkgJson = {
  name: `${srcRel.replace(/[^a-z0-9-]/gi, "-")}-deploy`,
  version: "0.0.0",
  private: true,
  main: "index.js",
  type: "commonjs",
  engines: { node: "20" },
  dependencies: deps,
};
fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n");

// Firebase lit le `.env` DANS le dossier source → recopier ceux de la source vers .deploy/.
let envCopied = 0;
for (const f of fs.readdirSync(srcDir)) {
  if (f === ".env" || f.startsWith(".env.")) {
    fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
    envCopied++;
  }
}

// node_modules local (discovery firebase-tools) mais EXCLU de l'upload : Cloud Build réinstalle
// depuis package.json (deps réelles, npm sait résoudre). Évite un upload lourd inutile.
fs.writeFileSync(path.join(outDir, ".gcloudignore"), "node_modules/\n");

let installed = false;
if (doInstall) {
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", "--prefix", outDir],
    { stdio: "pipe" });
  installed = true;
}

const kb = Math.round(fs.statSync(path.join(outDir, "index.js")).size / 1024);
console.log(`✅ ${srcRel} → .deploy/ (bundle ${kb} KB, ${Object.keys(deps).length} deps: ${Object.keys(deps).join(", ")}${envCopied ? `, ${envCopied} .env` : ""}${installed ? ", node_modules installé" : ""})`);
