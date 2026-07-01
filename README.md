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

## Roadmap (BUILD_KIT §15)

| Phase | Contenu | État |
|-------|---------|------|
| **F0** | Socle : config Firebase, Emulator Suite, SPA vide, seed `config/permissions` | ✅ |
| F1 | Auth + custom claims + `setUserRole` + `firestore.rules` + tests de règles | ⬜ |
| F2 | Ingestion SheetJS (P&L, DF, fiche, Sales_DATA) idempotente + `imports` | ⬜ |
| F3 | Agrégation `summaries/*` (backlog FY, pipeline, fournisseurs, overview…) | ⬜ |
| F4 | Frontend parité 13 modules (valeurs de contrôle §18) | ⬜ |
| F5 | Écritures gardées (opp, statut BC, crédit, objectifs, matrice) | ⬜ |
| F6 | Sync Sales_DATA quotidien (Scheduler) | ⬜ |
| F7 | Bonifications (atterrissage, alertes, drill-down, exports PDF/XLSX) | ⬜ |
| F8 | Durcissement (App Check, MFA, export Firestore planifié, tests ≥80%) | ⬜ |
