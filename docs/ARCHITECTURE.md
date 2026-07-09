# nt360 — Architecture de référence

> Document d'architecture d'ingénierie (R8, axe #50). Décrit la structure du code, le modèle de
> données, le modèle de sécurité et les garde-fous de qualité. À tenir à jour à chaque évolution
> structurante. Voir aussi `BUILD_KIT.md` (conventions), `RUNBOOK-GOLIVE.md` (mise en prod) et
> `DISASTER-RECOVERY.md` (reprise après sinistre).

## 1. Vue d'ensemble

nt360 est un **CRM/cockpit revenu de niveau Salesforce** pour ESN/SS2I : pipeline d'opportunités,
comptes/contacts, activités & tâches, approbations, prévision gouvernable, scoring calibré, reporting
self-service, API REST, rentabilité, et intégration ClickUp bidirectionnelle.

| Couche | Technologie | Emplacement |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript, Tailwind | `web/` |
| Backend | Cloud Functions 2ᵉ gén. (Node 20) | `functions/` |
| Données | Firestore (base **nommée** `nt360`) | — |
| Auth | Firebase Auth (email/mot de passe + MFA/SSO), App Check | — |
| Hébergement | Firebase Hosting (PWA installable) | `web/dist` |
| Monorepo | pnpm workspace | racine |

**Projet Firebase PARTAGÉ** (`propulse-business-87f7a`) avec une application sœur → deux garde-fous
structurants : (1) claims d'auth **namespacés** `nt360Role` ; (2) déploiement des fonctions **par nom**
(`functions/deployed-functions.txt`) pour ne jamais toucher les fonctions de l'app sœur.

## 2. Frontend (`web/`)

- `src/App.tsx` — shell : navigation à deux niveaux (Domaines → Onglets), skip-link, `<main>`,
  `ErrorBoundary` par module, `Suspense` (lazy-load par module → code-splitting).
- `src/modules/*.tsx` — **19 écrans** (overview, pipeline, accounts, activities, approvals,
  salesforecast, scoring, reports, cleanup, backlog, operations, admin, finance…). Enregistrés dans
  `src/modules/index.tsx`.
- `src/design/` — design system (composants `Card`/`Table`/`Badge`…, tokens de thème clair/sombre).
  Garde-fou a11y automatisé : `design/a11y.test.tsx` (axe-core, WCAG 2 A/AA).
- `src/lib/` — `firebase.ts` (init + persistance offline `persistentLocalCache`), `hooks.ts`
  (`useDocData`/`useCollectionData` temps réel), `writes.ts` (wrappers callables typés), `scope.ts`
  (cadrage record-level côté client), `rbac.ts`, `nav.tsx`, `errorReporter.ts`.
- **PWA** : `public/sw.js` — network-first pour la navigation, **cache-first** pour les actifs hashés
  (démarrage à froid hors-ligne) ; `public/manifest.webmanifest`.
- **Budget bundle** : chunk d'entrée ≤ 120 KB (garde CI `check:bundle`).

## 3. Backend (`functions/`)

- `index.js` — point d'entrée : **102 fonctions** exportées (callables `onCall`, planifiées
  `onSchedule`, HTTP `onRequest`, trigger de recompute). Chaque callable est enveloppé par `guarded()`
  (observabilité : Cloud Logging + `opsLog` + alerte webhook + latence).
- `functions/domain/*.js` — **modules PURS testables** (aucun I/O) portant la logique métier : sécurité
  (`hierarchy`), activités, approbations, automatisation, prévision (`forecast`), scoring
  (`scoring` + `scoreCalib`), reporting, clés API, champs custom, devis (`quote`), vélocité, fuzzy,
  bornage des scans (`scan`), rejeu webhooks (`outboundRetry`)…
- `functions/handlers/*.js` — **sous-systèmes extraits** du monolithe sous forme de fabriques
  `create…(deps)` avec **injection de dépendances** (Firestore/logger/FieldValue/onSchedule) : le
  handler ne référence aucun global d'`index.js`, et l'export reste déclaré dans `index.js` pour le
  garde-fou de déploiement. Premier module : `handlers/outbound.js` (webhooks sortants + rejeu durable).
  C'est le **patron d'amincissement** progressif d'`index.js`.
- `functions/parsers/`, `functions/lib/` — parseurs d'ingestion (SheetJS) et utilitaires (ids, fx,
  sheets, config).
- **Tests** : `functions/test/*.test.js` (vitest, 600+), `functions/test-rules/*.test.js` (règles via
  émulateur).

### Pipeline de calcul
Ingestion (Storage trigger `gs://nt360`) et saisies → **recompute** sérialisé (verrou/coalescing) →
agrégats `summaries/*` lus en temps réel par les dashboards. Les recomputes concurrents s'excluent
mutuellement (test d'intégration émulateur).

## 4. Modèle de données (Firestore, base `nt360`)

| Collection | Rôle | Accès |
|---|---|---|
| `opportunities` | pipeline (owner + `visibleTo`) | record-level (voir §5) |
| `accounts` / `contacts` | comptes & contacts | record-level / gouverné |
| `activities` | activités & tâches | **callable-only** |
| `approvals` | workflow d'approbation | **callable-only** |
| `reports` | rapports sauvegardés | **callable-only** |
| `apiKeys` | clés API (hashées) | **callable-only** |
| `summaries/*` | agrégats dashboards | lecture gouvernée par module |
| `config/*` | référentiels & réglages | lecture allowlistée, écriture callable |
| `oppHistory` | transitions d'étape (funnel) | `write:false` |
| `auditLog` / `opsLog` / `errorLog` / `outboundQueue` | traçabilité & ops | lecture admin, `write:false` |

**Contrainte de conception** : requêtes à **multi-égalité** ou **array-contains** uniquement → aucun
index composite requis (garde CI `check-firestore-indexes.mjs`).

## 5. Modèle de sécurité

- **RBAC** — matrice opposable `config/permissions` (même source pour Security Rules, callables et
  front). `direction` = superviseur. Révoquer un droit a un effet réel serveur.
- **Sécurité par enregistrement** (owner + hiérarchie) — chaque enregistrement porte `ownerUid` et
  `visibleTo` (chaîne ascendante dénormalisée). OWD par objet (`config/recordAccess`, `public` par
  défaut). Sous `private`, seuls propriétaire/hiérarchie/admin voient l'enregistrement — appliqué à la
  fois par les Security Rules (`array-contains uid`) et par les callables serveur.
- **Collections callable-only** — `activities`/`approvals`/`reports`/`apiKeys` : `read:false+write:false`
  en rules ; accès et visibilité **appliqués côté serveur** dans les callables.
- **App Check** — enforcement pilotable par variable d'env (`APPCHECK_ENFORCE`).
- **Secrets** — `defineSecret`/Secret Manager (`CLICKUP_TOKEN`, `ANTHROPIC_API_KEY`), jamais en clair.

## 6. Intégrations

- **ClickUp** — bidirectionnel (push commande→tâche, pull tâche→app), webhooks temps réel, back-off 429,
  réconciliation anti-doublons (match Opp ID = FP), cockpit qualité.
- **API REST publique** — `exports.api` (`onRequest`) : clés à scopes `read`/`write`, rate-limit.
- **Webhooks sortants** — `fireOutbound` + file de rejeu durable `outboundQueue` + `retryOutbound`
  (backoff, dead-letter).

## 7. CI / garde-fous (`.github/workflows/ci.yml`)

`vitest` functions + web · `tsc` · `eslint` (react-hooks) · `test:rules` (émulateur) · budget bundle ·
`check-deploy-targets.mjs` (exports = liste déployée) · `check-firestore-indexes.mjs` (aucun mono-champ).
Smoke E2E Playwright post-déploiement (`smoke.yml`) : chargement, confidentialité de marge, et
**parcours de navigation** de tous les écrans. Preview Firebase par PR.

## 8. Cartographie des responsabilités (où intervenir)

| Besoin | Fichier(s) |
|---|---|
| Nouveau callable | `functions/index.js` + `functions/deployed-functions.txt` + `domain/*` (logique pure) |
| Nouvelle logique métier testable | `functions/domain/*.js` + `functions/test/*.test.js` |
| Nouvel écran | `web/src/modules/*.tsx` + `modules/index.tsx` + wrapper `lib/writes.ts` |
| Règle d'accès | `firestore.rules` + `functions/test-rules/*` |
| Réglage de déploiement | `functions/deployed-functions.txt`, `firebase.json`, `.firebaserc` |
