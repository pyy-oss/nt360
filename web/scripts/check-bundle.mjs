// Garde-fou de taille du CHUNK D'ENTRÉE (index-*.js) : c'est le code chargé au tout premier rendu
// (shell + écran de connexion). Un import STATIQUE d'un module lourd (ou de recharts) le ferait
// gonfler et retomberait sur le chemin critique — ce script échoue alors la CI pour le signaler.
// Les vendors (firebase, recharts) et les modules sont volontairement des chunks séparés (lazy).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "dist/assets";
const BUDGET_KB = 122; // chunk d'entrée — actuel ~120 KB (shell + login + centre d'activité) : marge ~2 KB.
// Le budget garde son rôle : bloquer tout import STATIQUE lourd (module, recharts…) qui doit rester lazy
// (React.lazy). Relevé de 120→122 KB : la croissance vient de l'accumulation d'entrées de nav (onglets
// Admin), pas d'un import lourd — le garde-fou anti-import-lourd reste pleinement actif.

let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith(".js"));
} catch {
  console.error(`check-bundle : ${DIR} introuvable — lance d'abord \`vite build\`.`);
  process.exit(1);
}
const kb = (f) => statSync(join(DIR, f)).size / 1024;
const entry = files.find((f) => /^index-.*\.js$/.test(f));
if (!entry) {
  console.error("check-bundle : chunk d'entrée index-*.js introuvable.");
  process.exit(1);
}

const all = files.map((f) => ({ f, kb: kb(f) })).sort((a, b) => b.kb - a.kb);
console.log("Chunks JS :");
for (const c of all) console.log(`  ${c.kb.toFixed(0).padStart(5)} KB  ${c.f}`);

const entryKb = kb(entry);
console.log(`\nChunk d'entrée ${entry} : ${entryKb.toFixed(1)} KB (budget ${BUDGET_KB} KB)`);
if (entryKb > BUDGET_KB) {
  console.error(`\n❌ Budget dépassé : ${entryKb.toFixed(1)} KB > ${BUDGET_KB} KB.`);
  console.error("   Un import statique a probablement alourdi le chunk d'entrée — charge le module concerné en lazy (React.lazy).");
  process.exit(1);
}
console.log("✅ Budget respecté.");
