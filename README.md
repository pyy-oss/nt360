# Pilote Revenu NT CI — cockpit 100% Firebase serverless

Industrialisation du cockpit **Pilote Revenu NT CI** (Neurones Technologies CI) selon la
spécification faisant autorité : [`docs/BUILD_KIT.md`](docs/BUILD_KIT.md).

Reliant **commercial (pipeline) → commandes (CAS) → facturation → backlog → rentabilité
projet → exposition fournisseurs**, indexé par la clé d'or **N° FP**.

## Stack

Firebase Hosting (React 18 + Vite + TS) · Firebase Auth (custom claims + MFA) ·
Firestore (collections sources + agrégats `summaries/*`) · Cloud Functions Node.js 20
(ingestion SheetJS, agrégation, `setUserRole`, `syncSalesData`, export) · Cloud Storage ·
Cloud Scheduler. **RBAC opposable** via custom claims + Security Rules.

## Arborescence

```
docs/BUILD_KIT.md          Spécification autoportante (métier + Firebase)
docs/ARCHITECTURE.md       Architecture de référence (code, données, sécurité, CI)
docs/DISASTER-RECOVERY.md  Runbook reprise après sinistre (RTO/RPO, restauration)
firebase.json .firebaserc  Config Firebase (projet propulse-business-87f7a)
firestore.rules            RBAC opposable (matrice lue côté serveur)
firestore.indexes.json     Index composites
storage.rules              Imports (écriture rôles habilités) / exports
functions/                 Cloud Functions 2nd gen (Node.js 20) — parsers/ domain/ lib/
web/                       SPA React/Vite/TS — modules/ (13) design/ lib/
seed/                      Matrice de droits + bootstrap 1er admin
```

## Développement local

```bash
pnpm install                 # workspace (web + functions)
pnpm --filter functions install
pnpm test                    # Vitest (parseurs + domaine + front)
pnpm emulators               # Firebase Emulator Suite (auth/firestore/functions/storage/hosting)
pnpm dev                     # front Vite (VITE_USE_EMULATORS=true pour brancher l'émulateur)
```

Copier `web/.env.example` → `web/.env.local` au besoin (la config web Firebase est publique).

**Bucket imports/exports** : `gs://nt360` (constante `IMPORTS_BUCKET`, `functions/lib/config.js`,
surchargeable via `IMPORTS_BUCKET`). Utilisé par le trigger `ingest` (F2) et les exports (F7).

### Amorçage (F1)

```bash
# Émulateur : matrice de droits + 1er admin 'direction'
FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
  GCLOUD_PROJECT=propulse-business-87f7a node seed/seed.js admin@nt.ci MotDePasse123

pnpm test:rules   # 23 tests de règles RBAC via l'émulateur Firestore
```

## Roadmap (BUILD_KIT §15)

| Phase | Contenu | État |
|-------|---------|------|
| **F0** | Socle : config Firebase, Emulator Suite, SPA vide, seed `config/permissions` | ✅ |
| **F1** | Auth + custom claims + `setUserRole`/`logLogin` + `firestore.rules` + tests de règles (23) | ✅ |
| **F2** | Ingestion SheetJS (P&L, DF, fiche, Sales_DATA) idempotente + `imports` + quarantaine + tests §18 | ✅ |
| **F3** | Agrégation `summaries/*` (backlog FY, pipeline, fournisseurs, overview, facturation, rentabilité, clients, domaines) | ✅ |
| **F4** | Frontend parité 13 modules (lecture summaries/* + détail, RBAC, période) | ✅ |
| **F5** | Écritures gardées (opp saisie, statut BC, crédit, objectifs, matrice, rôles) | ✅ |
| **F6** | Sync Sales_DATA quotidien (Scheduler) — remplace le lot salesData, préserve les saisies | ✅ |
| **F7** | Bonifications : atterrissage, centre d'alertes, drill-down FP 360°, export CODIR XLSX, N vs N-1, migration legacy | ✅ |
| **F8** | Durcissement : App Check, MFA (TOTP), export Firestore planifié, couverture ≥80% | ✅ |

> **Roadmap F0→F8 complète.** Validation données réelles (§18) : P&L CAS 31.72 Md / RAF 3.66 Md / MB 6.75 Md ; LIVE actif 42.98 Md brut / 13.78 Md pondéré, conversion 62%.

## Durcissement (F8)

- **App Check** : reCAPTCHA v3 côté front (`VITE_APPCHECK_SITE_KEY`) ; jeton de debug en dev.
- **MFA (TOTP)** : `web/src/lib/mfa.ts` (enrôlement authenticator) — à activer dans la console Firebase Auth ; recommandé pour `direction`/`achats`.
- **Sauvegarde** : `scheduledFirestoreExport` (dimanche 03:00) → export Firestore managé vers `gs://nt360/backups/`.
- **Couverture** : `pnpm --filter functions test:coverage` (seuil 80 %, actuel ~91 %).
