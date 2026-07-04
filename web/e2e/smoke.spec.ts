import { test, expect, type Page } from "@playwright/test";

// Smoke-test go-live du cockpit Pilote Revenu.
// Vérifie sur la PROD (SMOKE_BASE_URL) que :
//   1. l'application se charge et l'authentification email/mot de passe fonctionne ;
//   2. la CONFIDENTIALITÉ DE LA MARGE tient côté serveur : un compte sans accès Rentabilité
//      ne voit AUCUNE marge, un compte avec accès la voit — sur la même page (Vue d'ensemble).
//
// Les identifiants sont fournis par variables d'environnement (secrets GHA) — jamais en clair :
//   SMOKE_NOMARGIN_EMAIL / SMOKE_NOMARGIN_PASSWORD  → rôle SANS accès Rentabilité
//   SMOKE_MARGIN_EMAIL    / SMOKE_MARGIN_PASSWORD    → rôle AVEC accès Rentabilité
// Ces comptes doivent être dédiés au test et SANS MFA enrôlée (sinon le login TOTP bloque).

const NOMARGIN = { email: process.env.SMOKE_NOMARGIN_EMAIL || "", password: process.env.SMOKE_NOMARGIN_PASSWORD || "" };
const MARGIN = { email: process.env.SMOKE_MARGIN_EMAIL || "", password: process.env.SMOKE_MARGIN_PASSWORD || "" };

/** Connexion email/mot de passe + attente du shell applicatif (bouton Déconnexion présent). */
async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto("/");
  await page.locator("#login-email").waitFor({ state: "visible" });
  await page.locator("#login-email").fill(creds.email);
  await page.locator("#login-pwd").fill(creds.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  // Marqueur « connecté » : le bouton Déconnexion n'existe que dans le shell, jamais sur l'écran de login.
  await expect(page.getByRole("button", { name: "Déconnexion" })).toBeVisible({ timeout: 30_000 });
}

/** Attend que la Vue d'ensemble soit réellement chargée (KPI toujours présent, indépendant de la marge). */
async function waitOverviewLoaded(page: Page) {
  // « Taux de facturation » est un KPI de la Vue d'ensemble rendu quel que soit le rôle → preuve de chargement.
  await expect(page.getByText("Taux de facturation").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("Go-live — chargement & authentification", () => {
  test("l'écran de connexion se charge", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#login-email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  });
});

test.describe("Confidentialité de la marge (accès Rentabilité)", () => {
  test.skip(!NOMARGIN.email || !NOMARGIN.password, "SMOKE_NOMARGIN_* non fourni");

  test("compte SANS accès Rentabilité → aucune marge visible sur la Vue d'ensemble", async ({ page }) => {
    await login(page, NOMARGIN);
    await waitOverviewLoaded(page);
    // La page est chargée (KPI neutre visible) MAIS le KPI « Marge brute » est absent (gaté serveur).
    await expect(page.getByText("Marge brute")).toHaveCount(0);
  });
});

test.describe("Accès Rentabilité — la marge réapparaît", () => {
  test.skip(!MARGIN.email || !MARGIN.password, "SMOKE_MARGIN_* non fourni");

  test("compte AVEC accès Rentabilité → « Marge brute » présente sur la Vue d'ensemble", async ({ page }) => {
    await login(page, MARGIN);
    await waitOverviewLoaded(page);
    await expect(page.getByText("Marge brute").first()).toBeVisible({ timeout: 30_000 });
  });
});
