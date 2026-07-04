import { defineConfig, devices } from "@playwright/test";

// Smoke-test post-déploiement (go-live) : joué en GHA contre la prod (ou un environnement
// fourni via SMOKE_BASE_URL). Aucun serveur local n'est lancé — on cible une URL déjà déployée.
const baseURL = process.env.SMOKE_BASE_URL || "https://nt360.web.app";

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
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
