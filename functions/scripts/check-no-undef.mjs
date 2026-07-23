// GARDE STATIQUE « anti-ReferenceError » (blindage) — échoue le CI si un identifiant est utilisé sans
// être défini / requis dans sa portée (ex. le bug `buildFpAliasResolver is not defined` de correctionQueue,
// où un helper de lib/ids était appelé sans `require` local — les `require` de index.js sont fn-scoped).
// Ce type de bug ne se voyait qu'à l'EXÉCUTION (500 en prod) : aucune compilation ne le détecte côté JS.
// On lint donc le CODE SERVEUR avec `no-undef` (+ quelques règles de correction sûres) via l'API ESLint,
// SANS ajouter de dépendance (eslint est déjà hoisté par le workspace) ni fichier de config partagé.
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // dossier functions/
// Le code serveur PARTAGÉ (lib/domain/parsers/handlers) vit désormais dans le package @nt360/functions-shared
// (split en codebases, docs/SPLIT-CODEBASES.md). On lint donc les DEUX : le point d'entrée (functions/) et le socle.
// ESLint tourne depuis la RACINE du dépôt : sinon les fichiers hors du cwd (functions-shared/*) sont « ignorés ».
const repoRoot = path.resolve(root, "..");
const shared = path.join(repoRoot, "functions-shared");

// Globals Node (CommonJS) — évite la dépendance au paquet `globals` (non installé au niveau workspace).
const nodeGlobals = {
  require: "readonly", module: "writable", exports: "writable", process: "readonly",
  __dirname: "readonly", __filename: "readonly", Buffer: "readonly", console: "readonly",
  setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
  setImmediate: "readonly", clearImmediate: "readonly", queueMicrotask: "readonly", global: "readonly",
  URL: "readonly", URLSearchParams: "readonly", TextEncoder: "readonly", TextDecoder: "readonly",
  fetch: "readonly", structuredClone: "readonly", AbortController: "readonly", performance: "readonly",
};

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: true, // ignore toute config eslint alentour → garde autonome et déterministe
  overrideConfig: [{
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: nodeGlobals },
    // no-undef = le cœur (attrape le require manquant). Les autres = fautes de frappe/logique sûres à interdire.
    rules: {
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-func-assign": "error",
      "no-const-assign": "error",
      "no-unreachable": "error",
      "no-obj-calls": "error",
    },
  }],
});

// Code SERVEUR déployé uniquement (pas les tests, ni coverage/node_modules).
const targets = [
  path.join(root, "index.js"), path.join(root, "scripts"),
  path.join(repoRoot, "functions-par", "index.js"), // codebase partenariats (split Étape 1)
  ...["lib", "domain", "parsers", "handlers"].map((p) => path.join(shared, p)),
];
const results = await eslint.lintFiles(targets);
const problems = results.filter((r) => r.errorCount > 0);

if (problems.length) {
  const fmt = await eslint.loadFormatter("stylish");
  console.error(await fmt.format(problems));
  console.error(`\n❌ Garde no-undef : ${problems.reduce((s, r) => s + r.errorCount, 0)} erreur(s) — identifiant non défini / require manquant / faute sûre.`);
  process.exit(1);
}
console.log(`✅ Garde no-undef : ${results.length} fichiers serveur analysés, aucun identifiant non défini.`);
