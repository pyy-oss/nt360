# Smoke-test go-live (Playwright)

Smoke-test post-déploiement joué contre la **prod** (ou une URL fournie). Il vérifie :

1. **Chargement + authentification** — l'écran de connexion s'affiche, le login email/mot de passe aboutit sur le shell.
2. **Confidentialité de la marge** — un compte **sans** accès Rentabilité ne voit **aucune** marge sur la Vue d'ensemble ; un compte **avec** accès la voit. C'est la garantie que l'isolation serveur (`*Margin`, gating `rentabilite`) tient sur les vraies données.

## Exécution en CI

Workflow `.github/workflows/smoke.yml` :

- **Automatique** après un déploiement réussi (`workflow_run` sur « Firebase Deploy (main) »).
- **Manuel** via *Actions → Smoke go-live (prod) → Run workflow* (URL cible optionnelle).

### Secrets requis

À définir dans *Settings → Secrets and variables → Actions*. Utiliser des **comptes dédiés au test, sans MFA enrôlée** (sinon le login TOTP bloque l'automatisation) :

| Secret | Rôle attendu |
| --- | --- |
| `SMOKE_NOMARGIN_EMAIL` / `SMOKE_NOMARGIN_PASSWORD` | compte **sans** accès Rentabilité (ex. commercial / lecture) |
| `SMOKE_MARGIN_EMAIL` / `SMOKE_MARGIN_PASSWORD` | compte **avec** accès Rentabilité (ex. direction) |

Sans ces secrets, les tests de marge se **skippent** proprement ; le smoke de chargement/login reste joué.

## Exécution locale

```bash
cd web
pnpm install
pnpm exec playwright install chromium
SMOKE_BASE_URL="https://nt360.web.app" \
SMOKE_NOMARGIN_EMAIL="…" SMOKE_NOMARGIN_PASSWORD="…" \
SMOKE_MARGIN_EMAIL="…" SMOKE_MARGIN_PASSWORD="…" \
pnpm test:e2e
```

`SMOKE_BASE_URL` par défaut : `https://nt360.web.app`.
