# 01 — L'existant

> Rempli par `/0-empreinte` (Phase 0). Chaque affirmation porte un chemin de fichier réel.
> **À relire et corriger par un humain avant la phase 1.** Il contient forcément des erreurs,
> notamment sur les règles métier que le code ne dit pas (voir §8 et §9).
>
> Stratégie d'échantillonnage : le monolithe `functions/index.js` (~4050 lignes, ~136 callables)
> n'a pas été lu ligne à ligne. Il a été cartographié par `grep` ciblés (collections, `config/*`,
> `onSchedule`, `require*`) puis lecture des zones repérées. Les modules `functions/domain/*.js` et
> `web/src/lib/*.ts` (petits, purs) ont été listés exhaustivement, lus par sondage. Toute affirmation
> non vérifiée par lecture directe est signalée « (indice grep, non lu intégralement) ».

## 1. Identité

| | |
|---|---|
| Nom / périmètre fonctionnel | **nt360** — cockpit de pilotage pour ESN/SSII (zone UEMOA/CEMAC). Pipeline commercial → carnet de commandes (P&L) → facturation → recouvrement ; achats (BC fournisseurs) ; fiches d'affaire ; consultants/CRA (activité ESN). `package.json` (`"pilote-revenu-nt-ci"`), `CLAUDE.md` |
| Âge (premier commit) | **2026-07-01** (`git log`, via `scripts/empreinte.sh`) — dépôt jeune, très dense |
| Contributeurs principaux | **pyy-oss** (369 commits) ; Claude (1). Contributeur quasi unique (`git log --format='%an'`) |
| Volume | **370 commits** en ~2 semaines. Extensions : 205 `.js`, 39 `.ts`, 35 `.tsx`, 33 `.md`, 90 `.html` (rapports de couverture générés). Fichiers de code : ~110 côté functions, ~60 côté web (`scripts/empreinte.sh`) |
| Statut | En production. Site Firebase Hosting `nt360`, projet **partagé** `propulse-business-87f7a` (`firebase.json`, `CLAUDE.md`). Déploiement continu via GitHub Actions (`.github/workflows/firebase-deploy.yml`) |

## 2. Pile technique

| Élément | Valeur | Source (fichier) |
|---|---|---|
| Langage / version | JavaScript **CommonJS** (backend, Node 20) + **TypeScript 5** (frontend) | `functions/package.json` (`"type":"commonjs"`, `engines.node:"20"`), `web/package.json` |
| Framework | **Firebase Functions v5** (callables/triggers/scheduler) backend ; **React 18 + React Router 6** frontend | `functions/package.json` (`firebase-functions:^5`), `web/package.json` (`react:^18`, `react-router-dom:^6`) |
| ORM / accès données | **Aucun ORM.** Accès direct au SDK Admin Firestore (`firebase-admin`, `@google-cloud/firestore`) côté serveur ; SDK client `firebase` côté web | `functions/package.json`, `web/src/lib/firebase.ts` |
| Base de données | **Cloud Firestore, base NOMMÉE `nt360`** (pas `(default)`). Schemaless, orientée documents | `firebase.json` (`firestore.database:"nt360"`) |
| Migrations (outil) | **Aucun.** Firestore est schemaless : pas de migrations relationnelles. Les « migrations » de données sont des scripts/callables ad hoc (ex. `migrateFpSatellites`, `functions/index.js:2296`) et la ré-ingestion (`functions/scripts/reingest.js`) | `scripts/empreinte.sh` (section MIGRATIONS vide) |
| Tests (moteur, commande) | **Vitest 2.** Back : `pnpm --filter functions test` (763 tests annoncés `CLAUDE.md`, 83 fichiers dans `functions/test/`). Front : `pnpm --filter web test` (13 fichiers `*.test.*` dans `web/src`). Règles Firestore : `pnpm test:rules` (émulateur). E2E : Playwright (`web/e2e/`) | `functions/package.json`, `web/package.json`, `package.json` |
| Build / dépendances | **pnpm 9.12** (monorepo, `pnpm-workspace.yaml` : `web`, `functions`). Front bâti par **Vite 5** (`tsc -b && vite build`) | `package.json` (`packageManager`), `web/package.json` |
| Interface (techno) | React 18 + **Tailwind 3.4** + tokens CSS-var maison. Graphes **Recharts**, icônes **lucide-react**, export **pptxgenjs** | `web/package.json`, `web/src/design/tokens.ts` |
| CI | **GitHub Actions**, 6 workflows : `ci.yml` (tests+gardes+build+smoke), `firebase-deploy.yml`, `firebase-preview.yml`, `firebase-setup.yml`, `reingest.yml`, `smoke.yml` | `.github/workflows/` |

## 3. Couches et emplacements

| Couche | Chemin | Convention observée |
|---|---|---|
| Logique métier **PURE** (aucune I/O) | `functions/domain/*.js` (~70 fichiers : `commandes.js`, `projection.js`, `forecast.js`, `chaine.js`, `scoring.js`, `backlog.js`…) | Une responsabilité par fichier ; prédicats/agrégats/projections testés par vitest (`functions/domain/README.md`) |
| Ponts I/O / orchestration | `functions/lib/*.js` (`aggregate.js` = orchestrateur du recompute, `ids.js`, `fx.js`, `config.js`, `ingest.js`, `graphMail.js`, `clickup*.js`) | I/O Firestore + parsing + orchestration ; jamais de règle de calcul pure ici |
| Points d'entrée (contrôleurs) | `functions/index.js` (**monolithe** ~4050 lignes, ~136 callables/triggers HTTP) + `functions/handlers/*.js` (groupes extraits par injection de dépendances : `opportunities.js`, `timesheets.js`, `staffing.js`, `fiches.js`, `objectives.js`, `outbound.js`, `reports.js`, `candidates.js`, `automations.js`, `sanitize.js`) | Découpe en cours (« Lot Archi », `CLAUDE.md`). Le patron d'extraction injecte `{ db, logger, FieldValue, onSchedule }` (`functions/handlers/outbound.js:16`) |
| Parseurs d'import | `functions/parsers/*.js` (`salesData.js`, `pnl.js`, `bcPdf.js`, `facturationDf.js`, `ficheAffaire.js`, `logistics.js`, `oppImport.js`) | Un parseur par type de fichier source (Excel/PDF) ; lecture via `functions/lib/xlsxRead.js` (exceljs) |
| Vues / composants (écrans) | `web/src/modules/*.tsx` (~24 écrans lazy-loadés : `overview.tsx`, `pipeline.tsx`, `backlog.tsx`, `salesforecast.tsx`, `finance.tsx`, `staffing.tsx`, `admin.tsx`…) | 1 fichier = 1 famille d'écrans ; enregistrés dans `MODULES[]` (`web/src/modules/index.tsx:60`) |
| Hooks / logique front | `web/src/lib/*.ts` (`hooks.ts` = `useDocData`/`useCollectionData` temps réel `onSnapshot` ; `ids.ts` = miroir de `fpKey` ; `projection.ts` ; `perm.ts`/`rbac.tsx`/`scope.ts` = RBAC ; `writes.ts` = appels callables) | `ids.ts`/`projection.ts` sont des **miroirs exacts** du back (`CLAUDE.md`) |
| Primitives design | `web/src/design/*.tsx` (`components.tsx` = Card/Table/Modal/Kpi/…, `inputs.tsx`, `charts.tsx`, `tokens.ts`) | Tokens CSS-var `T.*` (`tokens.ts`) ; aucune valeur de couleur/taille en dur |
| Batchs / planifié | Fonctions `onSchedule` dans `functions/index.js` + `functions/handlers/outbound.js` | Cron déclaratif (`schedule: "every day 05:00"`) — voir §5 |
| Configuration | Documents Firestore `config/*` (voir §4.4) ; `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules` ; secrets dans **Secret Manager** | `firebase.json`, `grep config/*` |
| Tests | `functions/test/` (83 fichiers, unités domaine/parseurs), `functions/test-rules/` (règles), `web/src/**/*.test.ts(x)` (13), `web/e2e/` (Playwright) | Couverture back exigée **≥ 80 %** au CI (`ci.yml`) |

## 4. Schéma de données

### 4.1 Conventions de nommage
- **Collections : anglais, pluriel, camelCase** : `orders`, `invoices`, `opportunities`, `bcLines`,
  `projectSheets`, `billingMilestones`, `oppHistory`, `commandesRows`, `outboundQueue`, `apiKeys`,
  `auditLog`, `errorLog`, `opsLog` (`grep .collection(...)`). Exception **française** notable :
  `commandesRows` (chunks du carnet).
- **Documents de config/agrégat : chemins `config/<nom>` et `summaries/<nom>`** en camelCase
  (`config/permissions`, `config/fxRates`, `summaries/backlog_fy`, `summaries/atterrissage_<fy>`).
  Suffixe d'exercice `_<fy>` (millésime) sur les agrégats périodisés (`functions/lib/aggregate.js:390`).
- **Champs métier : mélange fr/en** — `bu`, `am`, `client`, `stage`, `probability`, `amount`, `cas`,
  `raf`, `mb`, `yearPo`, `fp`, `closingDate` (`web/src/types.ts`, non lu intégralement — indice grep).
- **Clé d'affaire canonique : `N° FP`** au format `FP/AAAA/N` (`functions/lib/ids.js:4`). Voir §4.3.
- Langue de l'ERP : **anglais pour la technique (collections/champs), français pour le métier affiché**
  (UI 100 % fr, `CLAUDE.md`). Le vocabulaire du module de contrats devra trancher fr/en **selon cette
  règle** — à valider (§9).

### 4.2 Tables (collections) structurantes

> Firestore : pas de clé étrangère ni de contrainte d'intégrité déclarative. Les « relations » sont
> des champs portant une clé logique (souvent le **N° FP**), rapprochés en code via `fpKey`.

| Collection | Rôle | Clé (id doc) | Colonnes structurantes (indice grep) | Relations |
|---|---|---|---|---|
| `orders` | Carnet de commandes / P&L | id interne | `fp`, `yearPo`, `cas`, `raf`, `mb`, `bu`, `am`, `client` | `fp` ↔ tout |
| `commandesRows` | Chunks matérialisés du carnet (lecture) | chunk | lignes de commande projetées | dérivé de `orders` (`aggregate.js`) |
| `invoices` | Factures | id | `fp`, `date`, `amountHt`, `bu`, `client` | `fp` → `orders` |
| `opportunities` | Pipeline commercial | id (`saisie_*` si créée à la main, `functions/handlers/opportunities.js:304`) | `fp`, `stage` (1-9), `probability` (IdC %), `amount`, `closingDate`, `source`, `stale`, `bu`, `am`, `client` | `fp` → `orders` |
| `oppHistory` | Historique des transitions d'étape | id | étape avant/après, horodatage | → `opportunities` (`aggregate.js:430`) |
| `bcLines` | Bons de commande fournisseurs (achats) | id | statut BC, devise, montant | `fp` (`apply.js:91`, `handlers/fiches.js:44`) |
| `projectSheets` / `fiches` | Fiches d'affaire | id | lignes de fiche | `fp` (`handlers/fiches.js:150`) |
| `billingMilestones` | Jalons de facturation | id | dates/jalons | `fp` (`aggregate.js:283`) |
| `consultants` | Ressources ESN | id | profil, coût/TJM | → `assignments`, `timesheets` |
| `assignments` | Affectations (staffing) | id | consultant × affaire × période | `consultants`, affaire |
| `timesheets` | CRA / temps constaté | id | consultant, période, jours | `consultants`, `assignments` |
| `activities` | Activités & tâches (call/email/meeting/note/task) par enregistrement | id | type, cible, date | polymorphe (record-level) |
| `approvals` | Workflow d'approbation | id | soumission → décision | → enregistrement soumis |
| `objectives` | Objectifs / R-O (cibles CAS/CAF) | id | cible, exercice | par BU/AM |
| `accounts` / `contacts` | Comptes & contacts (CRM) | id | — | `contacts` → `accounts` |
| `candidates` | Vivier / recrutement | id | avancement (sourcé/entretien/offre) | → BU |
| `reports` | Rapports self-service sauvegardés | id | définition de rapport | — |
| `apiKeys` | Clés d'API publique | id | hash, périmètre | → `users` |
| `outboundQueue` | File de webhooks sortants | id | payload, tentatives | rejouée par `retryOutbound` |
| `imports` | Journal des imports bruts | id | fichier, statut | déclenche l'ingestion |
| `users` | Utilisateurs provisionnés nt360 | uid | rôle, hiérarchie | claim `nt360Role` |
| `auditLog` | **Journal d'audit** (omniprésent) | id | acteur, action, cible, horodatage | transverse (voir §5) |
| `errorLog` | Erreurs client remontées | id | message, contexte | `aggregate.js:510` |
| `opsLog` | Journal d'opérations/ingestion | id | — | `functions/index.js:191` |
| `summaries/*` | Agrégats matérialisés (lecture) | nom | par module/exercice | recalculés par `aggregate.js` |

### 4.3 Domaines fonctionnels

| Domaine | Collections / docs | Fichiers |
|---|---|---|
| Tiers / clients | `accounts`, `contacts` ; normalisation `config/clientAliases` | `functions/domain/clientName.js`, `web/src/lib/clientName.ts`, modules `clients.tsx`/`clientnorm.tsx` |
| Facturation | `invoices`, `billingMilestones` | `functions/domain/billing.js`, `preBilling.js`, `reporting.js` ; `web/src/modules/finance.tsx` |
| Règlements / trésorerie | (pas de collection « paiements » dédiée trouvée) `summaries/receivables`, `summaries/cashflow`, `summaries/cashScenario` | `functions/domain/receivables.js`, `cashflow.js`, `cashScenario.js`, `relances.js` |
| Achats / fournisseurs | `bcLines` ; `config/clickupBc*` | `functions/domain/fournisseurs.js`, `clickupBc.js` ; `functions/parsers/bcPdf.js` ; module `finance.tsx` (BC) |
| Comptabilité générale / analytique | **pas de plan comptable ni de comptabilité en propre** (indice grep — voir §8). Analytique = axes `bu`/`am`/`client`/`fp` | `functions/domain/reporting.js`, `resourcePnl.js` |
| Paie / RH | **pas de paie** (« paie » ne renvoie qu'aux `timesheets`/coûts consultants — voir §8) | `functions/domain/consultant.js`, `timesheet.js` |
| Temps passé | `timesheets`, `assignments` | `functions/domain/timesheet.js`, `activityKpi.js`, `capacity.js` ; `functions/parsers` (import CRA) |
| Projets / affaires | `orders`, `projectSheets`/`fiches` (clé `N° FP`) | `functions/domain/commandes.js`, `ficheAffaire.js`, `chaine.js` |
| Utilisateurs / droits | `users`, `config/permissions`, `config/recordAccess`, `config/security` | `functions/domain/authz.js` ; `web/src/lib/perm.ts`, `rbac.tsx`, `scope.ts` ; `firestore.rules` |

### 4.4 Overlays de configuration (`config/*`) — survivent aux ré-imports
`config/permissions` (matrice RBAC), `config/recordAccess` (OWD par objet), `config/security`,
`config/fiscal` (exercice), `config/projection` (paliers d'IdC), `config/alerts`, `config/fxRates`
(taux de change), `config/clientAliases`, `config/fpAliases` (réconciliation FP), `config/cancelOrders`
& `config/cancelInvoices` (annulations), `config/orderPm`, `config/orderCasOverride`, `config/staffingTargets`,
`config/emailNotify`, `config/notifications`, `config/customFields`, `config/outboundWebhooks`, `config/automations`,
`config/clickup*` (jetons/liens/sync), `config/recomputeLock` & `config/recomputeRequest` (sérialisation du recompute).
(Source : `grep '.doc("config/…'`.) Ce sont les **points d'ancrage de paramétrage additif** de l'ERP.

## 5. Mécanismes transverses

| Mécanisme | Existe ? | Où | Comment on s'en sert | Limites observées |
|---|---|---|---|---|
| Authentification | Oui | Firebase Auth ; `web/src/lib/firebase.ts`, `mfa.ts` | Connexion Firebase ; MFA/SSO (Lot 2). Projet Firebase **partagé** | Un compte de l'app sœur satisfait `signedIn()` mais n'a pas le claim `nt360Role` (`firestore.rules`) |
| Moteur de droits | **Oui, matriciel opposable** | `config/permissions` (matrice `role × module → none/read/write`) ; `functions/domain/authz.js` ; `firestore.rules` ; `web/src/lib/perm.ts` | Rôles : `direction, commercial_dir, commercial, pmo, achats, assistante, lecture` (`authz.js:6`). Serveur : `requireWrite(req, module)` / `requireRead(req, module)` (`functions/index.js:574`). Rules : `canRead(m)`/`canWrite(m)`. `direction` = write partout | Le front ne fait **jamais** autorité (`firestore.rules`) |
| Sécurité par enregistrement | Oui (OWD `private`) | `config/recordAccess` ; `firestore.rules` (`owdPrivate`, `isRecordAdmin`, `canSeeRecord`) | Champ dénormalisé `visibleTo` (chaîne hiérarchique) → filtrage O(1) `where('visibleTo','array-contains',uid)` | Défaut = « public » (rétro-compatible) ; `visibleTo` doit être matérialisé par les callables |
| Workflow / validation | Oui | collection `approvals` ; `functions/domain/approval.js` ; module `approvals.tsx` | Soumission → décision hiérarchique + suivi (Lot 4) | Générique au CRM, pas de moteur BPMN |
| Notifications | Oui (e-mail) | `functions/lib/graphMail.js` (Microsoft Graph) ; `config/emailNotify`, `config/notifications` ; `functions/domain/emailNotify.js` | Digests planifiés : `alertDigest` (07:00), `emailRelancesDigest` (07:15), `emailCodirDigest` (lundi 08:00) — `functions/index.js:633+`. Secret `GRAPH_CLIENT_SECRET` | Pas de SMS ; pas de notif in-app persistée dédiée (les alertes vivent dans `summaries/alerts`) |
| Ordonnanceur / jobs | Oui | `onSchedule` (Cloud Scheduler) | Crons : `scheduledRecompute` (05:00), `syncSalesData` (06:00), `curateNews` (05:30), `scheduledClickupPull` (04:30), `scheduledBcPull` (04:45), `scheduledClickupEnrich` (05:00), `scheduledFirestoreExport` (dimanche 03:00), `retryOutbound` (toutes les 10 min) | Fuseau du scheduler à confirmer (§8) |
| Journal d'audit | **Oui, omniprésent** | collection `auditLog` (écrite depuis ~120 sites : `functions/index.js`, tous les `handlers/*`) | Chaque action sensible écrit une entrée `auditLog` | Schéma d'entrée non lu (indice grep) |
| Séquences de numérotation | **Non trouvé (point critique).** Le `N° FP` **n'est pas généré** par l'ERP : il vient des fichiers importés (vérité externe). `fpKey` (`functions/lib/ids.js:8`) **canonicalise** `FP/AAAA/N` (rejette `.../0000`, normalise zéros de tête) mais ne fabrique aucun numéro | Seule génération d'id vue : `saisie_<timestamp>` pour les opps créées à la main (`handlers/opportunities.js:304`) | Un module de contrats aura besoin de sa **propre** stratégie de numérotation — ADR (§9) |
| Pièces jointes | Oui (limité) | Cloud Storage ; `storage.rules` | `imports/` (dépôt de fichiers d'import, RBAC par rôle) ; `exports/` (artefacts générés, lecture par URL signée éphémère uniquement) | Lecture directe SDK **interdite** sur les deux chemins (`storage.rules`) — pas de GED généraliste |
| Exports | Oui | `exceljs` (Excel), `pdfkit` (PDF) côté back ; `pptxgenjs` (PPTX CODIR), `web/src/lib/exportCsv.ts` côté front | Exports des vues clés + rapport CODIR | Migration `xlsx→exceljs` effectuée (tâche #131) |
| Reporting | Oui | `summaries/*` (agrégats matérialisés) + report builder self-service (collection `reports`, module `reports.tsx`) ; `functions/domain/report.js`, `reporting.js` | Le recompute (`aggregate.js`) alimente les summaries ; le front re-dérive en miroir (`overviewCalc.ts`) | Invariant fort : « même métrique 2 endroits = même nombre » (`CLAUDE.md`) |
| Multi-devises | Oui | `functions/lib/fx.js` (`FIXED_PEG = { EUR: 655.957, XAF: 1 }`) ; `config/fxRates` (taux paramétrables) ; miroir front `FIXED_PEG` | **Devise pivot XOF/FCFA**. Repli sur la parité légale `1 EUR = 655,957 XOF` si `config/fxRates` muet | Le FCFA n'a **pas de subdivision** (arrondi entier — voir §9) |
| Multi-société / pays | Partiel | Territoires & équipes (Lot 10) ; zone UEMOA/CEMAC | Notion de BU (`ICT/CLOUD/FORMATION/AUTRE`, `web/src/design/tokens.ts`) | Pas de multi-entité juridique comptable identifiée (§8) |
| Calendriers / jours fériés | **Non trouvé** | — | `ferie`/`holiday` : 1 fichier chacun (indice `scripts/empreinte.sh`), non localisé comme moteur | Le SLA d'un contrat (jours ouvrés, fériés locaux) n'a **aucune** source dans l'ERP — à confirmer (§8/§9) |
| Internationalisation | Non (français figé) | UI 100 % française (`CLAUDE.md`) | Pas de fichiers de traduction | — |
| API externe | Oui | API REST publique + clés (`apiKeys`, Lot 7) ; webhooks sortants (`outboundQueue`) ; intégration **ClickUp** bidirectionnelle massive (`functions/lib/clickup*.js`, `config/clickup*`) | ClickUp = source/miroir des tâches d'exécution et du CAF | Couplage ClickUp fort (nombreux `config/clickup*`) |

## 6. Zones dangereuses

| Zone | Pourquoi | Fichiers les plus modifiés (nb commits, `git log`) | Couverture de test |
|---|---|---|---|
| Monolithe des points d'entrée | ~136 callables, découpe en cours | `functions/index.js` (**178**) | Indirecte (domaine testé, pas `index.js` lui-même) |
| Écritures front (appels callables) | Surface d'appel de toute l'app | `web/src/lib/writes.ts` (**100**) | Partielle |
| Orchestrateur du recompute | Autorité des agrégats ; sérialisé par verrou à bail | `functions/lib/aggregate.js` (**89**) | Tests de parité (`consistencyAlertsDq.test.js`) |
| Suivi backlog | Millésimes, RAF dérivés, invariants | `web/src/modules/backlog.tsx` (**71**) | `web/src/lib/milestones.test.ts` (partiel) |
| Types front | Contrat de données de tout le web | `web/src/types.ts` (**66**) | — (types) |
| Règles de sécurité | Une erreur = fuite ou blocage | `firestore.rules` (**62**) | `functions/test-rules/` + `pnpm test:rules` |
| Pipeline commercial | IdC/étapes/pondération | `web/src/modules/pipeline.tsx` (**59**) | `web/src/lib/ids.test.ts`, `projection` |
| Déploiement | Déploiement **par nom** (`deployed-functions.txt`, 144 lignes) | `.github/workflows/firebase-deploy.yml` (**52**) | Garde `check-deploy-targets.mjs` |
| Champs fourre-tout / JSON | Overlays `config/*` : documents à structure libre (matrice, alias, overrides) survivant aux ré-imports | `functions/lib/aggregate.js`, `functions/index.js` | Selon overlay |
| Autorités de calcul à ne pas contourner | `mergeCommandes` (`domain/commandes.js`), `fpKey` (`lib/ids.js`), `plausibleYear`, `projectionWeight` — double-compte / faux orphelins si contournées | idem | Tests domaine dédiés |

**Marqueurs de contournement / dette** : `xlsx@0.18` (CVE-2023-30533) — dette signalée `CLAUDE.md`
(migration `exceljs` largement faite, tâche #131) ; commentaires « ne pas toucher »/`TODO`/`HACK` non
recensés exhaustivement (indice non exécuté — voir §8).

## 7. Rituel de développement

| | Commande | Source |
|---|---|---|
| Lancer les tests | `pnpm test` (web + functions) ; ciblé : `pnpm --filter functions test` / `pnpm --filter web test` | `package.json`, `CLAUDE.md` |
| Tests de règles Firestore | `pnpm test:rules` (émulateur) | `package.json` |
| « Migration » de données | Ré-ingestion : `functions/scripts/reingest.js` / workflow `reingest.yml` ; pas de migration schéma | `.github/workflows/reingest.yml` |
| Démarrer en local | `pnpm dev` (web) ; `pnpm emulators` (Firebase : auth/firestore/functions/storage/hosting) | `package.json`, `firebase.json` |
| Jeu de données de recette | `seed/` (répertoire présent) ; environnement de **preview** par PR (`firebase-preview.yml`) | `scripts/empreinte.sh`, `.github/workflows/` |
| CI (garde-fous) | `ci.yml` : tests+couverture ≥80 %, lint hooks React, tests de règles, `check-deploy-targets.mjs`, `check-no-undef.mjs`, `check-firestore-indexes.mjs`, build web, **budget de bundle** (`check:bundle`, chunk d'entrée ≤120 KB), smoke E2E Playwright | `.github/workflows/ci.yml` |
| Déploiement | `firebase-deploy.yml` (push sur `main`) ; toute fonction exportée doit figurer dans `functions/deployed-functions.txt` | `.github/workflows/firebase-deploy.yml`, `CLAUDE.md` |

## 8. Ce que je n'ai pas compris

> **Section obligatoire.** Chaque point : ce que j'ai cherché, avec quels termes, ce que je n'ai pas
> trouvé, ce qu'il faudrait pour lever le doute.

- [ ] **Numérotation d'un objet créé nativement dans l'ERP.** Cherché : `generateFp`, `nextFp`,
  `sequence`, `numerotation`, `` `FP/${ ``. Trouvé : `fpKey` canonicalise mais ne génère pas ; les opps
  manuelles reçoivent un id `saisie_<timestamp>` (`handlers/opportunities.js:304`). **Je n'ai trouvé
  aucun compteur/séquence côté serveur.** Pour lever le doute : demander comment l'ERP attribuerait un
  numéro à un objet dont la source n'est pas un import (cas d'un `contrat` saisi à la main).

- [ ] **Structure exacte d'une entrée `auditLog`.** `auditLog` est écrit depuis ~120 sites mais je n'ai
  pas lu le schéma d'une entrée (acteur/action/cible/avant-après ?). Pour lever le doute : lire 2–3
  appels `.collection("auditLog").add(...)` dans `functions/index.js`.

- [ ] **Fuseau horaire de stockage et des crons.** Le kit signale « Abidjan = UTC+0, SLA à la minute »
  (`CLAUDE.md`). Les `onSchedule` utilisent `"every day 05:00"` sans fuseau explicite lu. **Je ne sais
  pas** si Firestore stocke les timestamps en UTC exploité tel quel, ni le fuseau des crons. Pour lever
  le doute : vérifier la config région/fuseau des Functions et le format des dates dans `invoices.date`.

- [ ] **Absence de comptabilité / paie / règlements en propre.** Cherché : `compta`, `account`,
  `analytique`, `paie`, `payroll`, `reglement`, `paiement`. Les hits `account` renvoient à la collection
  CRM `accounts` (comptes clients), **pas** à un plan comptable ; `reglement` = 1 fichier. **Je conclus
  provisoirement** que l'ERP n'a ni GL, ni paie, ni encaissements formels — le recouvrement se pilote via
  `receivables`/`relances`. À confirmer par un humain (risque de vue partielle).

- [ ] **Coûts horaires chargés des consultants.** Le kit dit « ils existent déjà, ne pas les recréer »
  (`CLAUDE.md`). J'ai localisé `functions/domain/resourcePnl.js`, `preBilling.js`, `consultant.js` et une
  parité TJM `preBilling/resourcePnl` (tâche #137), mais **je n'ai pas lu** où le coût chargé (vs TJM de
  vente) est stocké au niveau d'un `consultant`. Pour lever le doute : lire la structure d'un doc
  `consultants` et ses champs de coût.

- [ ] **Jours fériés / calendrier ouvré.** `ferie`/`holiday` = 1 fichier chacun (indice grep), non
  identifié comme moteur. **Je n'ai trouvé aucune source de jours ouvrés/fériés locaux** exploitable pour
  un calcul de SLA. Pour lever le doute : demander si un référentiel de jours fériés existe (paie ?
  config ?) ou s'il est absent.

- [ ] **Contenu réel de `web/src/types.ts` et `functions/index.js`.** Non lus intégralement (taille).
  Les colonnes structurantes des collections (§4.2) sont des **indices grep**, pas une lecture du type.
  Pour lever le doute : lire `types.ts` en entier avant la phase 2.

- [ ] **Marqueurs `HACK`/`TODO`/« ne pas toucher »/code commenté.** Non recensés (grep non exécuté sur
  tout l'arbre). À faire avant d'ancrer le module, pour éviter une zone contournée.

## 9. Ce que le code ne dit pas

> Règles métier, contraintes réglementaires (OHADA, BCEAO, fiscalité locale), habitudes d'usage
> qu'aucun fichier ne documente et qu'il faut demander à un humain. **Rien ci-dessous n'est une
> recommandation** — ce sont des questions ouvertes pour la phase 1.

- [ ] **Absence totale de la notion de contrat de maintenance dans l'ERP existant.** Cherché :
  `contrat`, `contract`, `sla`, `ticket`, `intervention`, `maintenance`, `entretien`, `astreinte`,
  `couverture`, `quota`. **Aucun objet métier correspondant.** « Maintenance » n'apparaît que comme un
  libellé de *nature* d'affaire (`web/src/modules/backlog.tsx:756`), et « Entretien » comme un statut de
  vivier (`staffing.tsx:270`). ⇒ Le module `mnt_*` **ne recrée rien** qui existe déjà (interdit du kit
  respecté) ; il s'ancrera à des affaires (`orders`/`fp`), des clients (`accounts`), des consultants et du
  temps (`timesheets`) — mais l'objet contrat lui-même est neuf. **À confirmer** qu'aucune gestion de
  contrats ne vit hors dépôt (tableur, ClickUp).

- [ ] **Numérotation d'un contrat.** L'ERP n'attribue pas de numéro nativement (§8). Comment numéroter
  un `mnt_contrat` (séquence annuelle ? clé adossée au `N° FP` de l'affaire ?) est une **décision (ADR)**.

- [ ] **Arrondi FCFA et type des montants.** Le FCFA n'a pas de subdivision. Il faut vérifier **comment
  l'ERP stocke les montants** (entier ? flottant ?) dans `orders.cas`/`invoices.amountHt` et faire
  pareil dans le module (piège du kit). Non tranché ici (nécessite lecture de `types.ts` + un cas réel).

- [ ] **Fuseau et calcul SLA à la minute.** Voir §8. Le respect d'un engagement SLA dépend du fuseau de
  référence et des jours ouvrés/fériés — dont l'ERP ne fournit pas de source claire.

- [ ] **Langue des identifiants du module.** L'ERP mêle collections anglaises et métier français (§4.1).
  Le vocabulaire du kit est en français (`contrat`, `engagement_sla`…). La règle « suivre l'ERP » impose
  de trancher : **collections/champs techniques en anglais camelCase préfixés `mnt_`** paraît cohérent
  avec l'existant, mais c'est une décision à acter (ADR), pas une évidence.

- [ ] **Couleurs des 4 niveaux de risque.** L'ERP a déjà des teintes sémantiques (`STAGE_COL`, `BC_COL`,
  `tokens.ts`). Les couleurs de `score_risque`/`signal` du module doivent-elles s'y aligner ? → ADR
  (piège du kit).

- [ ] **Coûts chargés vs TJM de vente pour la marge d'un contrat.** Quelle source fait foi pour le coût
  d'une intervention (§8) — à cadrer avant tout calcul de rentabilité de contrat.

- [ ] **Drapeau de fonctionnalité.** Le kit impose que le module s'éteigne sans redéploiement, l'ERP
  redevenant *strictement* celui d'avant. Le mécanisme d'overlay `config/*` (§4.4) est le candidat
  naturel (ex. `config/mntFeature`), mais **aucun feature-flag générique n'existe aujourd'hui** — à
  concevoir en phase 3.

---

### Résumé (≤ 10 lignes)

nt360 est un ERP-cockpit **Firebase serverless** (Firestore base nommée `nt360`, Functions Node/CommonJS,
front React/Vite/TS), jeune (juil. 2026) mais très dense, en production sur un projet Firebase **partagé**.
Architecture nette : `domain/` **pur** (testé) + `lib/` **I/O** + `index.js` monolithe (~136 callables, en
cours de découpe) + `web/src/modules` lazy. La clé d'affaire est le **N° FP** (`fpKey`), jamais généré par
l'ERP (vérité importée). RBAC **matriciel opposable** (`config/permissions` + `nt360Role` + record-level OWD),
audit omniprésent (`auditLog`), recompute sérialisé (`aggregate.js` → `summaries/*`), multi-devises **XOF pivot**
(peg EUR 655,957). **Aucune** notion de contrat/SLA/ticket/intervention n'existe : le module `mnt_*` est neuf et
s'ancrera à `orders`/`fp`, `accounts`, `consultants`, `timesheets`. Zones d'ombre majeures : numérotation native,
fuseau/SLA, jours fériés, arrondi/type des montants, coûts chargés — toutes à lever avant la phase 1.

> **Phase 0 terminée. `01-EXISTANT.md` est à relire et à corriger — il contient forcément des
> erreurs, notamment sur les règles métier que le code ne dit pas. Validez-le avant `/1-regles`.**
