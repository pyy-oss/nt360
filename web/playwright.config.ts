import { defineConfig, devices } from "@playwright/test";

// Deux modes :
//   • SMOKE_BASE_URL fourni → smoke post-déploiement (go-live) contre une URL DÉJÀ déployée (prod).
//     Aucun serveur local ; les tests de marge (avec secrets) s'y jouent.
//   • sinon → mode LOCAL (CI de PR) : on sert l'app BUILDÉE via `vite preview` et on joue le smoke
//     de chargement (rendu du login) SANS secret. Attrape les régressions runtime (écran blanc,
//     crash au boot, assets manquants) avant merge — les tests de marge se skippent d'eux-mêmes.
const prodUrl = process.env.SMOKE_BASE_URL;
const baseURL = prodUrl || "http://localhost:4173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 }, // l'app charge ses abonnements Firestore après login
  fullyParallel: false,        // deux sessions d'auth distinctes → on évite les collisions
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Échappatoire pour environnements où Chromium est PRÉ-provisionné à un chemin fixe (sandbox,
    // images CI custom) : PW_CHROMIUM_PATH pointe l'exécutable. Inerte en CI standard (variable non
    // définie → Playwright utilise le navigateur installé par `playwright install`).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  // Mode local : sert le dossier `dist` (build préalable) sur le port 4173. Aucun webServer en
  // mode prod (on cible l'URL déployée).
  webServer: prodUrl ? undefined : {
    command: "pnpm preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
