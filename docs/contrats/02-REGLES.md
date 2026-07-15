# 02 — Les règles de l'existant

> Rempli par `/1-regles`. C'est le document que le module doit **respecter**, pas améliorer.
>
> **Règle d'or : la règle de l'ERP gagne.** Toujours. Même laide, datée, ou contraire à l'état
> de l'art. Chaque règle porte son **taux de dominance** (`N/M occurrences`) et sa source.
> Une règle observée dans 4 fichiers sur 200 est un accident, pas une règle.

## Comment cette carte a été établie

| | |
|---|---|
| Périmètre lu | `web/src/types.ts`, `web/src/lib/format.ts`, `web/src/design/{tokens.ts,components.tsx,inputs.tsx}`, `functions/lib/{ids.js,fx.js,ingest.js,aggregate.js}`, `functions/index.js` (échantillon ciblé), `functions/handlers/*`, `functions/parsers/bcPdf.js`, configs (`eslint.config.js`, `tailwind.config.js`, `firestore.rules`, `.github/workflows/ci.yml`) |
| Stratégie d'échantillonnage | Comptages mécaniques (`rg`/`grep`) sur tout le dépôt pour la dominance ; lecture directe des primitives design, du formatage et des types ; `index.js` (~4050 l.) non lu intégralement — mesuré par grep + lecture des zones repérées |
| Poids donné au code récent et testé | Dépôt jeune (juil. 2026), une seule école dans la plupart des cas ; divergences tranchées en faveur du code le plus fréquent ET couvert (domaine testé) |
| Sources de vérité mécaniques trouvées | `eslint.config.js` (react-hooks only), `tailwind.config.js`, `web/src/index.css` (CSS-vars de thème), `web/src/design/tokens.ts` (tokens JS), `tsconfig.json`. **Absents** : `.editorconfig`, `.prettierrc`, `.gitattributes`, linter SQL, ORM/migrations |

---

# A. RÈGLES DE BASE DE DONNÉES

> Firestore (base nommée `nt360`), schemaless, orienté documents. Pas de DDL, pas de clé
> étrangère déclarative, pas de migrations. Les « règles de schéma » vivent dans le **type
> miroir** `web/src/types.ts` et dans le code d'écriture.

## A.1 Nommage

| Élément | Règle observée | Dominance | Exemple réel | Source |
|---|---|---|---|---|
| Nom de « table » (collection) | anglais, camelCase | universel | `orders`, `opportunities`, `bcLines` | `grep .collection(...)` |
| Casse | camelCase, jamais snake_case ni `T_XXX` | 100 % (0 snake, 0 préfixe maison) | `commandesRows`, `billingMilestones` | Phase 0 §4.1 |
| Singulier ou pluriel | **pluriel** pour les collections ; singulier pour les docs de config | dominant | `invoices`, `consultants` ; `config/permissions` | `grep` |
| Préfixe de module | aucun préfixe historique. Overlays sous chemin `config/*` et `summaries/*` | — | `config/fxRates`, `summaries/backlog_fy` | Phase 0 §4.4 |
| Nom de colonne (champ) | camelCase ; **anglais technique + métier fr/abrégé** | mixte assumé | `amount`, `status`, `dueDate` / `cas`, `raf`, `mb`, `yearPo`, `am`, `tjm`, `fp` | `types.ts:189-209` |
| Clé primaire | id de document Firestore (souvent `safeId(fp)` ou `saisie_<ts>`) | — | `handlers/opportunities.js:304` | Phase 0 |
| Clé étrangère | **champ logique `fp`** (N° FP), rapproché en code par `fpKey` | universel | `Invoice.fp → Order.fp` | `lib/ids.js:8` |
| Table de liaison | `assignments` (consultant × affaire × période) | — | `assignments` | Phase 0 §4.2 |
| Index | `firestore.indexes.json`, validés par `check-firestore-indexes.mjs` (pas d'index mono-champ) | — | garde CI | `ci.yml` |
| Contrainte unique | **aucune contrainte de base** ; l'unicité est applicative (id = `fpKey`) | — | `patchOrder` refuse une ré-clé si le FP cible existe (`index.js:2382`) | `index.js` |
| Contrainte de vérification | applicative uniquement (gardes `HttpsError`) | — | `plausibleYear`, `fpKey` rejette `.../0000` | `lib/ids.js` |
| Séquence | **aucune** — aucune numérotation générée (voir A.3 « Exercice » et E) | 0 | `Invoice.numero` est **importé** | agent §8 |
| Vue | pas de vue SQL ; équivalent = agrégats matérialisés `summaries/*` | — | `summaries/overview` | `aggregate.js` |
| Langue des identifiants | **anglais pour la technique, français/abrégé maison pour le métier** | mixte constant | `client`/`customer` (deux mots pour un concept), `cas`, `raf` | `types.ts:201-203` |

## A.2 Types

> **Montants : `number` (flottant JS), arrondis À L'AFFICHAGE seulement.** Le module fait pareil —
> `number`, jamais `string` ni décimal dédié. ADR pour signaler le risque flottant, pas pour le corriger.

| Donnée | Type observé | Précision / échelle | Dominance | Source |
|---|---|---|---|---|
| Identifiant technique | `string` (id doc) | — | universel | `types.ts` |
| **Montant** | **`number`** (flottant JS) | pas de décimale imposée en base ; `num()` conserve les décimales de la source | **100 % `number`, 0 `string`** | `types.ts:189,201-203` |
| Pourcentage / taux | `number`. IdC (`probability`) **en % 0-100** (décision actée #368) ; taux internes en 0-1 (`pct` fait `×100`) | — | mixte, normalisé par `p01` | `projection.js`, `tokens.ts:53` |
| Quantité / durée | `number` (jours CRA, ETP) | — | — | `timesheets` |
| Date seule | **`string` ISO `AAAA-MM-JJ`** | — | **12 champs `string`, 0 `Timestamp`** | agent §9 |
| Date + heure (technique) | **Timestamp Firestore** (`serverTimestamp()`) | — | universel sur horodatage | agent §2 |
| Fuseau horaire stocké ? | **non** — dates métier en string sans fuseau ; calculs techniques en `Date.UTC` | `Africa/Abidjan` = 0 occ. | agent §9 |
| Booléen | `boolean` (`dr`, `paid`, `linked`, `stale`) | — | — | `types.ts` |
| Énumération | **code applicatif** (jamais table ni contrainte) : `stage` 1-9, `source`, statuts BC | universel | `salesData.js`, `tokens.ts` `STAGE_COL`/`BC_COL` |
| Texte court / long | `string` ; nettoyé par `cleanName`/`cleanPerson`/`valLabel` | — | `lib/ids.js`, `lib/sheets.js` |
| JSON / semi-structuré | documents `config/*` à structure libre + champ `detail` d'`auditLog` | — | Phase 0 §4.4 |
| Fichier / pièce jointe | Cloud Storage (`imports/`, `exports/`), URL signée éphémère | — | `storage.rules` |

## A.3 Colonnes techniques

| Colonne | Nom exact | Type | Obligatoire ? | Alimentée par | Dominance |
|---|---|---|---|---|---|
| Horodatage d'écriture (dominant) | **`ts`** | Timestamp | de facto sur `auditLog`/config | `FieldValue.serverTimestamp()` | **106 `ts: serverTimestamp()`** |
| Modification (date) | `updatedAt` | Timestamp | sur overlays/satellites | `serverTimestamp()` | 82 occ. |
| Création (date) | `createdAt` | Timestamp | ponctuel (`users`) | `serverTimestamp()` | 16 occ. |
| Création / modification (auteur) | `uid` (dans `auditLog`) ; `createdBy`/`updatedBy`/`actor` non systématiques | string | non | callable (req.auth.uid) | `createdBy` 10 · `updatedBy` 8 · `actor` 10 |
| Suppression logique | overlays d'annulation (`config/cancelOrders`, `cancelInvoices`) plutôt qu'un flag `deleted` | doc config | — | callables | Phase 0 §4.4 |
| Verrouillage optimiste (version) | **aucun champ `version`** ; concurrence gérée par verrou à bail (`config/recomputeLock`) | — | — | `aggregate.js` |
| Société / entité | pas de multi-entité ; axe = **BU** (`ICT/CLOUD/FORMATION/AUTRE`) | string | — | `tokens.ts` |
| Exercice | **`yearPo`** (année du PO) sur les commandes ; `fiscalYear` sur objectifs ; `config/fiscal.currentFy` = `max(yearPo)` | number | — | `ingest.js:135` |

## A.4 Intégrité et cycle de vie

| Sujet | Règle observée | Source |
|---|---|---|
| Suppression : logique ou physique ? | **overlays d'annulation** (`cancelOrders`/`cancelInvoices`) qui survivent aux ré-imports, plutôt qu'un delete | `aggregate.js:170` |
| Clés étrangères : base ou applicatif ? | **applicatif** (Firestore n'a pas de FK). Rapprochement par `fpKey` | `lib/ids.js` |
| Comportement `ON DELETE` | n/a (pas de FK). Ré-clé de FP → `migrateFpSatellites` propage le nouveau FP aux satellites | `index.js:2296` |
| Contraintes `NOT NULL` | applicatives : gardes `HttpsError("invalid-argument", …)` | agent §4-5 |
| Valeurs par défaut | **applicatif** (`Number(x) || 0`, `cleanBu` → `"AUTRE"`) | `lib/ids.js`, `oppImport.js:60` |
| Transactions | `db.runTransaction` / `batch` côté serveur ; jamais côté client | `index.js` |
| Verrouillage concurrent | recompute **sérialisé** par verrou à bail + coalescing (`RECOMPUTE_LEASE_MS`) | `aggregate.js`, CLAUDE.md |
| Archivage / purge | export Firestore hebdomadaire (`scheduledFirestoreExport`, dimanche 03:00) vers bucket dédié | `index.js:4046` |

## A.5 Migrations

| Sujet | Règle observée | Source |
|---|---|---|
| Outil | **aucun** (Firestore schemaless) | Phase 0 §2 |
| Nommage du fichier | n/a | — |
| Réversibilité exigée ? | n/a | — |
| Migrations de données | scripts/callables ad hoc + **ré-ingestion** (rejoue les imports) | `scripts/reingest.js`, `reingest.yml` |
| Ajout de colonne à une table volumineuse | **additif implicite** : un nouveau champ n'existe que sur les docs qui le portent (pas de DDL) | modèle Firestore |
| Renommage | via callable de migration + propagation satellites (`migrateFpSatellites`) | `index.js:2296` |
| Qui joue les migrations en prod | déploiement CI (`firebase-deploy.yml`) + callables direction | Phase 0 §7 |

## A.6 Multi-société, multi-pays, devises

| Sujet | Règle observée | Source |
|---|---|---|
| Cloisonnement par société | aucun (pas de multi-entité). Cloisonnement = **RBAC module + record-level OWD** | `firestore.rules` |
| Cloisonnement par pays | champ `country` sur `BcLine` (importé), pas de moteur pays | `types.ts:203` |
| Devise de stockage | **XOF** (pivot). Les BC portent `amountXof` (converti) + `amount`/`currency` bruts | `fx.js`, `types.ts:203` |
| Devise de restitution | **XOF/FCFA** partout ; libellés `M`/`Md`/`k` | `tokens.ts:29-39` |
| Où sont les taux de change | `config/fxRates` `{ rates: { <DEVISE>: taux } }`, édité en Habilitations (direction) | `fx.js`, `apply.js:45` |
| Taux fixe XOF/EUR (655,957) | `FIXED_PEG = { EUR: 655.957, XAF: 1 }`, repli auto si `config/fxRates` muet ; miroir front `FIXED_PEG` | `functions/lib/fx.js:9` |
| **Arrondi FCFA** | **entier à l'affichage ET à la conversion** : `Math.round` partout dans `toXof` ; `fmt`/`fmtFull` arrondissent. Pas de décimale FCFA affichée | `fx.js:16-22`, `tokens.ts:39,44` |
| Fuseau de référence | **non spécifié dans le code** (crons `onSchedule` sans `timeZone`) ; calculs en `Date.UTC`. Abidjan = UTC+0 → cohérent mais implicite | agent §9 |

---

# B. RÈGLES D'INGÉNIERIE

## B.1 Architecture

| Sujet | Règle observée | Dominance | Source |
|---|---|---|---|
| Découpage en couches | `domain/` **pur** (aucune I/O) → `lib/` I/O/orchestration → `index.js`/`handlers/` points d'entrée → `web/src/modules` UI | strict | Phase 0 §3, CLAUDE.md |
| Qui appelle qui | UI → callables (`writes.ts`) → handlers → domain. Le domaine n'importe jamais Firestore | strict | `domain/README.md` |
| Un contrôleur touche-t-il la base ? | oui (`index.js`/`handlers` font l'I/O) ; le **domaine** ne la touche jamais | — | Phase 0 §3 |
| Où vit la règle métier | `functions/domain/*.js`, **testée vitest** ; miroirs front `web/src/lib/{ids,projection}.ts` | universel | CLAUDE.md |
| Injection de dépendances | patron d'extraction `create<Handler>({ db, logger, FieldValue, onSchedule })` | croissant | `handlers/outbound.js:16` |
| Structure interne d'un module | 1 fichier écran `.tsx` lazy + hooks `lib/` + primitives `design/` | — | `modules/index.tsx:60` |
| Communication inter-modules | nav légère par état (`lib/nav.tsx`), pas de router | — | `nav.tsx:1` |
| Événements / hooks | trigger Firestore `onRecomputeRequest` + `requestRecompute` (recompute différé) | — | `index.js:115` |

## B.2 Écriture du code

| Sujet | Règle observée | Source mécanique |
|---|---|---|
| Formateur | **aucun** (pas de prettier/`.editorconfig`) | absence de fichier |
| Linter | **ESLint ciblé react-hooks uniquement** : `rules-of-hooks` = **error** (bloque CI), `exhaustive-deps` = warn. Pas de lint de style | `web/eslint.config.js` |
| Indentation, longueur de ligne | 2 espaces observés ; lignes longues tolérées (domaine dense) | code |
| Casse code | `camelCase` fonctions/variables ; `PascalCase` composants/types ; fichiers `camelCase.ts`/`kebab` rares | code |
| Langue des identifiants de code | anglais + métier fr (cf. A.1) | code |
| Langue des commentaires | **français, orientés « pourquoi »** | universel, CLAUDE.md |
| Commentaires : où | en-tête de fichier (rôle) + au-dessus des règles non triviales | universel |
| Typage | **TS strict côté web** (`tsc -b` bloque le build) ; **JS CommonJS non typé côté functions** (garde `check-no-undef.mjs`) | `tsconfig.json`, `ci.yml` |

## B.3 Erreurs, journalisation, validation

| Sujet | Règle observée | Source |
|---|---|---|
| Exceptions | `firebase-functions/https.HttpsError` (pas de hiérarchie maison) | agent §4 |
| Erreurs métier vs techniques | mêmes `HttpsError` avec code sémantique | agent §4 |
| Que renvoie une API en erreur | `HttpsError(code, messageFR)`. **272 occ.** Codes : `invalid-argument` ~92, `permission-denied` ~66, `failed-precondition` ~56, `not-found` ~15, `unauthenticated` ~10 | agent §4 |
| Journalisation | **`auditLog`** (voir schéma A.3/ci-dessous) + `errorLog` (client) + `opsLog` (ingestion) ; `logger` firebase-functions | agent §6 |
| Ce qu'on ne journalise jamais | `detail` d'auditLog porte un **extrait minimal** ({role}, ids tronqués à 500), **jamais l'objet complet ni before/after** | `sanitize.js:38` |
| Validation des entrées | **impérative défensive** : coercition (`String(x||"")`, `num`, `fpKey`, `cleanName`) + garde `HttpsError`. **Pas de schéma** (zod/joi/yup/ajv absents) | agent §5 |
| Messages d'erreur | en clair **français**, dans le `throw` (pas de catalogue i18n) | agent §4 |

**Schéma canonique d'une entrée `auditLog`** (6 champs, `index.js:246-249`) :
`{ uid, action (verbe snake_case), module (RBAC), entity, entityId, detail (objet libre), ts: serverTimestamp() }`.

## B.4 Tests

| Sujet | Règle observée | Source |
|---|---|---|
| Moteur | **Vitest 2** (back + front) ; Playwright (E2E/smoke) ; `@firebase/rules-unit-testing` (règles) | `package.json` |
| Commande | `pnpm test` ; `pnpm --filter functions test:coverage` ; `pnpm test:rules` ; `pnpm --filter web test:e2e` | Phase 0 §7 |
| Emplacement / nommage | `functions/test/*.test.js`, `functions/test-rules/`, `web/src/**/*.test.ts(x)`, `web/e2e/` | Phase 0 |
| Types pratiqués | unitaire (domaine/parseurs) + parité (front miroir back) + règles (émulateur) + smoke E2E | CLAUDE.md |
| Jeux de données | fixtures d'import + `seed/` + émulateur | Phase 0 §7 |
| Base de test | **émulateur Firestore** (règles) ; domaine pur sans I/O | `firebase.json` |
| Couverture réelle | **≥ 80 % exigé au CI** (functions) ; 763 tests functions + 58 web annoncés | `ci.yml`, CLAUDE.md |
| Couverture attendue d'un module | règle métier PURE + test vitest **avant** tout code inline | CLAUDE.md §Style |
| Doublures | mocks Firestore maison dans `functions/test/` | `apply.test.js` |

## B.5 Sécurité

| Sujet | Règle observée | Source |
|---|---|---|
| Authentification | Firebase Auth ; claim **namespacé `nt360Role`** (projet partagé) | `firestore.rules` |
| Déclaration d'une permission | matrice `config/permissions` `{ role: { module: none/read/write } }` | `authz.js` |
| Vérification d'une permission | serveur `requireWrite(req, module)`/`requireRead` (`index.js:574`) ; rules `canRead`/`canWrite` ; front `perm.ts` (jamais autorité) | `firestore.rules`, `index.js` |
| Cloisonnement par utilisateur | record-level OWD `private` : `visibleTo` dénormalisé + `where('visibleTo','array-contains',uid)` | `firestore.rules` |
| Protection injection | n/a SQL ; `assertPlainId` rejette `/` dans les ids | agent §5 |
| Protection CSRF / XSS | React (échappement par défaut) ; callables (pas de form POST classique) ; App Check optionnel | Phase 0 |
| Téléversement de fichier | `imports/` réservé aux rôles d'import (`direction/commercial_dir/pmo/achats`), lecture SDK interdite | `storage.rules` |
| Secrets | **Secret Manager** (`ANTHROPIC_API_KEY`, `GRAPH_CLIENT_SECRET`, `CLICKUP_TOKEN`) ; jamais en clair | Phase 0 §Sécurité |
| Chiffrement de colonnes | aucun (au repos Firestore) | — |
| **Qui voit un coût / une marge** | agrégats marge (`overviewMargin*`, `clientsMargin*`…) gated **`rentabilite`** dans `summaryModule()` ; exports marge en URL signée | `firestore.rules` |

## B.6 Rituel

| Sujet | Règle observée | Source |
|---|---|---|
| Nommage de branche | une branche de dev par tâche (ici `claude/build-kit-docs-push-ssfkvp`) | CLAUDE.md §Workflow |
| Format des commits | titre FR descriptif + trailers `Co-Authored-By`/`Claude-Session` | historique |
| Langue des commits | **français** | historique |
| Revue de code | PR **squash-merge** ; fusion sur « go » explicite | CLAUDE.md |
| CI : ce qui bloque | tests+couverture ≥80 %, lint hooks, tests de règles, `check-deploy-targets/no-undef/firestore-indexes`, build, **budget bundle ≤120 KB**, smoke E2E | `ci.yml` |
| Environnements | preview par PR (`firebase-preview.yml`), prod sur `main` | `.github/workflows/` |
| Ajout de dépendance | **ADR requis** (kit) ; déploiement par nom (`deployed-functions.txt`) | CLAUDE.md |

## B.7 Performance

| Sujet | Règle observée | Source |
|---|---|---|
| Pagination | `Table` (pageSize 50) / `ListView` (25) côté front ; caps `MAX_SCAN` côté callables | `components.tsx:234,395`, tâche #147 |
| Chargement des relations (N+1) | agrégats précalculés (`summaries/*`), pas de N+1 en lecture chaude | `aggregate.js` |
| Cache | temps réel `onSnapshot` (`useDocData`/`useCollectionData`) ; recompute coalescé | `lib/hooks.ts` |
| Traitements lourds | **différés** (`requestRecompute` → trigger) ; imports asynchrones ; LRO export | `index.js:115` |
| Volumétrie | carnet chunké (`commandesRows`), `oppHistory` fenêtré/tronqué | `aggregate.js:430` |

---

# C. RÈGLES DE TOKENS ET DE DESIGN

| | |
|---|---|
| Source des tokens | **doublée** : variables CSS de thème dans `web/src/index.css` (`--bg`, `--gold`…) + helpers JS `web/src/design/tokens.ts` (`T.*`, `BU_COL`, `STAGE_COL`, `BC_COL`) qui les référencent |
| Format | couleurs en **triplets RGB** (`14 22 19`) consommés via `rgb(var(--x))` ; permet l'opacité `rgb(var(--gold)/0.15)` |
| Mécanisme de thème | **clair + sombre**, via `prefers-color-scheme` + attribut `data-theme` sur `:root` (bascule manuelle). Contrastes annotés **WCAG AA** | `index.css:11-28` |
| Valeurs en dur constatées | rares exceptions de teinte d'étape (`STAGE_COL[5]="#5FB0A0"`, `[8]="#B07A3C"`) — hors palette de var | `tokens.ts` |

> **Aucune valeur en dur dans le module.** Couleur, taille, espacement, police, format : tout
> passe par `T.*`/CSS-vars ou les primitives `design/`.

## C.1 Couleurs

| Rôle | Token / valeur | Dominance | Source |
|---|---|---|---|
| Fond de page | `--bg` (`rgb(var(--bg))` = `T.bg`) | universel | `index.css:11`, `tokens.ts:6` |
| Fond de panneau / carte | `--panel` / `--panel2` | universel | `tokens.ts:7-8` |
| Bordure / séparateur | `--line` (souvent `border-line/60`) | universel | `components.tsx:148` |
| Texte principal | `--ink` (`T.ink`) | universel | `tokens.ts:9` |
| Texte secondaire | `--muted` (`T.dim`) | universel | `tokens.ts:10` |
| Texte désactivé | `--faint` (≥ 4.5:1 WCAG AA) | — | `index.css:12` |
| Primaire / action | **`--gold`** (accent, `accent-color`, focus) | universel | `index.css:43`, `tokens.ts:11` |
| Primaire survolé / actif | `--gold` + `box-shadow 0 0 0 3px rgb(var(--gold)/0.15)` | — | `index.css:101-102` |
| Succès | **`--emerald`** (gagné, positif) | — | `tokens.ts:12` |
| Avertissement | `--gold` | — | usage |
| Erreur / danger | **`--clay`** (perdu, négatif, `DangerBtn`) | — | `tokens.ts`, `components.tsx:693` |
| Information | `--steel` | — | `tokens.ts` |
| Focus | `--gold` (outline + halo) | universel | `index.css:101` |
| **Couleurs de statut métier** | `BU_COL` (ICT=emerald, CLOUD=steel, FORMATION=gold, AUTRE=faint) ; `STAGE_COL` (1-9) ; `BC_COL` (a_emettre→solde) ; `BADGE`/`TONES` (6 tons) | définies une fois | `tokens.ts`, `components.tsx:29,53` |

> **Le module aura besoin de 4 couleurs de risque (Vert / Ambre / Rouge / Critique).** L'ERP a
> déjà emerald (succès), gold (attention), clay (danger). **Doivent-elles servir de base au
> risque du module, ou faut-il une 4ᵉ teinte « critique » ?** → **ADR obligatoire (voir G).**

## C.2 Typographie

| Rôle | Famille | Taille | Graisse | Source |
|---|---|---|---|---|
| Titre de page / KPI | **Bricolage Grotesque Variable** (`font-display`) | `text-[22px]`→`[26px]` | — | `tailwind.config.js:23`, `components.tsx:39` |
| Titre de section | `font-display` | ~lg | medium | `Card` |
| Corps | **Inter Variable** (`font-sans`) | `text-[13px]` dominant | normal | `tailwind.config.js:24`, `components.tsx:161` |
| Libellé de champ | Inter | `text-xs`/`[11px]` | medium | `components.tsx` |
| Légende / aide | Inter | `text-[11px]` muted | — | `Tip`, `Kpi` |
| **Chiffres et montants** | classe **`tabnum`** (chiffres tabulaires) | — | — | `components.tsx:148,161` |
| Code / référence | mono ponctuel | — | — | — |

## C.3 Espacement, formes, élévation

| Élément | Valeur | Source |
|---|---|---|
| Échelle d'espacement | échelle Tailwind (gap-2/3/4) | usage |
| Gouttière de grille | `gap-4` dominant sur les colonnes de cartes | `salesforecast.tsx:33` |
| Padding d'un panneau | `Card` (rembourrage interne standard) | `components.tsx:15` |
| Padding d'une cellule de tableau | **`px-3 py-2`** | `components.tsx:148,302` |
| Rayon des angles | `rounded-md` (badges/boutons), `rounded` (barres) | `components.tsx:58` |
| Épaisseur des bordures | `border` 1px, `border-line/60` | `components.tsx:148` |
| Ombres / élévation | discrètes (focus halo gold) ; pas d'ombres portées lourdes | `index.css:102` |
| Hauteur d'un champ | `min-h-[40px]` (pagination), inputs standard | `components.tsx:506` |
| Hauteur d'une ligne de tableau | densité `px-3 py-2` + `text-[13px]` (segmented `min-h-[34px]`) | `components.tsx:70,148` |

## C.4 Autres tokens

| Élément | Valeur | Source |
|---|---|---|
| Points de rupture | Tailwind (`sm:` utilisé pour la densité mobile) | `components.tsx:314` |
| Échelle de `z-index` | modale/toast au-dessus (Tailwind) | `components.tsx:575` |
| Bibliothèque d'icônes | **lucide-react uniquement** (9 sites d'import, 0 autre lib) | `grep` |
| Tailles d'icônes | `size={15/18}` dominant | `components.tsx:544,622` |
| Durées d'animation | `transition-colors` (courtes) ; pas d'animations longues | `components.tsx` |
| Courbes | défaut Tailwind | — |
| `prefers-reduced-motion` | thème respecte `prefers-color-scheme` ; motion minimal | `index.css` |

---

# D. RÈGLES D'INTERFACE ET D'EXPÉRIENCE

## D.1 Gabarits et navigation

| Sujet | Règle observée | Source (écran de référence) |
|---|---|---|
| Page de liste | `ListView` (recherche + tri + colonnes pilotables + pagination 25) | `components.tsx:395` |
| Page de détail | `Card` + `DetailGrid` (grille clé/valeur), drawer d'activité | `ActivityDrawer.tsx` |
| Page de formulaire | `Modal` + champs `inputs.tsx` (`Select`, `DateField`) + `Busy` | `components.tsx:575` |
| Tableau de bord | grille de `Card`/`Kpi`/`charts` (Recharts lazy) | `overview.tsx` |
| Navigation principale | `MODULES[]` + `GROUPS[]` (onglets par état, pas de router) | `modules/index.tsx:60,100` |
| Fil d'Ariane | pas de breadcrumb ; navigation par onglets + nav intents | `nav.tsx` |
| Titre de page / onglet | libellé du module (`label`) | `modules/index.tsx` |
| Retour / annulation | `Modal` fermable ; `DangerBtn` a un « Annuler » ; toasts | `components.tsx:711` |

## D.2 Tableaux

| Sujet | Règle observée | Source |
|---|---|---|
| Composant existant | **`Table`** (colonnes typées `Col`, tri, détail expandable, colonnes pilotables via `colsKey`) et **`ListView`** | `components.tsx:234,395` |
| Densité (hauteur de ligne) | `px-3 py-2` + `text-[13px]`, `tabnum` sur nombres | `components.tsx:148,161` |
| Tri | en-tête cliquable, flèche ; mémoïsé sur `[rows, sort, hidden]` | `components.tsx:285` |
| Filtres | recherche `ListView` (`searchKeys`), filtres transverses BU/AM/PM/client | `filters.tsx` |
| Recherche | champ `placeholder="Rechercher…"` | `components.tsx:395` |
| Pagination | interne, **50** (`Table`) / **25** (`ListView`) par défaut | `components.tsx:234,395` |
| Actions de ligne | boutons ghost en cellule ; détail expandable | `components.tsx:303` |
| Sélection multiple | ponctuelle (Centre de correction, lots) | modules |
| Colonnes figées / défilement | en-tête `sticky top-0` ; scroll horizontal encadré | `components.tsx:282` |
| Alignement des nombres | **à droite** (`c.align === "right"`, `text-right whitespace-nowrap tabnum`) | `components.tsx:148` |
| Tableau vide | `EmptyState` (icône + libellé) | `components.tsx:347` |
| Export | bouton ghost « Exporter … CSV (Excel) » via `exportCsv` | `components.tsx:228` |

## D.3 Formulaires

| Sujet | Règle observée | Source |
|---|---|---|
| Position du libellé | libellé au-dessus / `aria-label` sur les champs compacts | `inputs.tsx` |
| Marquage de l'obligatoire | garde à la soumission (`HttpsError`), pas d'astérisque systématique | agent §5 |
| Aide contextuelle | primitive **`Tip`** + attribut `title` | `components.tsx:390` |
| Validation | **à la soumission** (callable), coercition serveur | agent §5 |
| Erreur de champ | toast d'erreur + message `HttpsError` remonté | `components.tsx:523` |
| Erreur globale | `ErrorState` / toast | `components.tsx:358` |
| Position/libellé des boutons | action primaire à droite via **`Busy`** ; « Annuler » ghost | `components.tsx:633,711` |
| Protection double envoi | **`Busy`/`DangerBtn` désactivent pendant l'exécution** (`disabled={s==="busy"}`) + `trackWrite` | `components.tsx:633,706` |
| Brouillon / autosave | non | — |
| Sortie avec modifs non enregistrées | non géré explicitement | — |

## D.4 Retours, états, confirmations

| Sujet | Règle observée | Source |
|---|---|---|
| Succès | **toast** (`ToastProvider`), `okMsg` par défaut « Fait »/« Supprimé » | `components.tsx:523,633,693` |
| Erreur | toast, `errMsg` par défaut « Action refusée »/« Suppression refusée » | `components.tsx:633,693` |
| Action destructive | **`DangerBtn`** ouvre une confirmation (modale avec `confirm` + « Annuler ») ; `useConfirm` | `components.tsx:693-712` |
| État de chargement | **`DataGate`** + `Skeleton`/`KpiSkeletons`/`CardSkeleton` | `components.tsx:370-386` |
| État vide | `EmptyState` | `components.tsx:347` |
| Erreur de page | `ErrorState` | `components.tsx:358` |
| Absence de droit | **masquer** (RBAC gate) + désactiver les actions d'écriture | `rbac.tsx`, tâche #141 |

## D.5 Formats — le détail qui trahit un module étranger

| Donnée | Format observé | Exemple réel | Source |
|---|---|---|---|
| Date | **`JJ/MM/AAAA`** (stockée ISO `AAAA-MM-JJ`) | `15/07/2026` | `format.ts:31` (`frDate`) |
| Date + heure | Timestamp technique ; affichage relatif privilégié | — | `format.ts` |
| Date relative | **oui** (`relTime`) : « à l'instant », « il y a 3 h », « il y a 5 j » | « il y a 2 j » | `format.ts:17` |
| Durée | jours (CRA/ETP) | — | `timesheet.js` |
| Séparateur de milliers | **espace** (`fr-FR` normalisé) | `1 085 668` | `tokens.ts:45` |
| Séparateur décimal | virgule (`fr-FR`) ; montants affichés sans décimale | — | `tokens.ts` |
| **Montant FCFA** | **entier, abrégé** `k`/`M`/`Md` ; sigle **« FCFA »/« XOF »** ; 0 décimale | `36,22 Md`, `1 085 668` | `tokens.ts:35-39`, CLAUDE.md |
| Montant en devise étrangère | converti en XOF (`amountXof`) ; devise/taux tracés (`fxSource`) | `fxSource: "peg"` | `fx.js` |
| Grands montants | **abrégés** (`Md`/`M`/`k`) dans les KPI, complets (`fmtFull`) en tooltip/export | `36,22 Md` | `tokens.ts:35,42` |
| Pourcentage | `pct` = `(n×100).toFixed(1)+"%"` ; absence → « — » | `18,5 %` | `tokens.ts:49` |
| Valeur nulle / vide | **« — »** (distinct d'un vrai 0 = « 0 ») | `—` | `tokens.ts:34,50` |
| Valeur négative | signe `-` ; couleur `clay` selon contexte (delta KPI) | `-12 M` | `components.tsx:33` |

## D.6 Voix de l'interface

| Sujet | Règle observée | Exemple réel |
|---|---|---|
| Vouvoiement / tutoiement | **vouvoiement** (« Validez », « Alimentez le vivier ») | `staffing.tsx:308` |
| Libellé de bouton | **infinitif** ; « **Enregistrer** » domine massivement (**31 vs 1 « Sauvegarder »**) | `label="Enregistrer"` |
| Casse des titres | Capitale initiale, pas de Title Case anglais | « Prévision commerciale » |
| Ton des messages d'erreur | bref, factuel, français (« admin requis », « URL webhook invalide ») | `index.js:615-618` |
| Terminologie maison | **N° FP, CAS, CAF, RAF, MB, IdC, BU, AM, PM, carnet, atterrissage, TACE, TJM, pondéré** | CLAUDE.md, `types.ts` |
| Abréviations tolérées | FCFA/XOF, Md/M/k, CRA, BC, P&L | usage |

## D.7 Accessibilité, responsive, impression

| Sujet | Règle observée | Source |
|---|---|---|
| Niveau d'a11y | **WCAG AA** visé (contrastes annotés, tests `axe-core`, `a11y.test.tsx`) | `index.css:12`, `design/a11y.test.tsx` |
| Focus visible | outline gold + halo systématique | `index.css:101` |
| Navigation clavier | `role`/`aria-*`/`aria-label`/`aria-expanded` sur boutons, onglets, pagination | `components.tsx:69,303,329` |
| Contraste | `--faint` garanti ≥ 4.5:1 sur fonds | `index.css:12,19` |
| Mobile / tablette | densité mobile (`sm:` breakpoints, `data-label` sur cellules) | `components.tsx:148,314` |
| Impression | non spécifique | — |
| Export PDF | `pdfkit` (back) / rapports ; PPTX CODIR (`pptxgenjs`) | Phase 0 §5 |

---

# E. RÈGLES MÉTIER ET RÉGLEMENTAIRES

| Sujet | Règle observée | Source |
|---|---|---|
| Référentiel comptable (OHADA/SYSCOHADA) | **absent du code** (`ohada` = 3 hits, tous en commentaire/doc ; aucun plan comptable) | agent §8 |
| Rétention documentaire (10 ans OHADA) | non implémentée ; export Firestore hebdo (sauvegarde, pas rétention légale) | `index.js:4046` |
| Exercices comptables | **année civile** ; `currentFy = max(yearPo)` ; itération jan→déc | `ingest.js:135`, `billing.js` |
| TVA | **aucun calcul** ; facturation **en HT** (`Invoice.amountHt` seul champ) ; BC privilégie le total HT | agent §8, `bcPdf.js:80` |
| Retenues à la source | absentes du code | agent §8 |
| Numérotation légale des factures | **aucune génération** ; `Invoice.numero` est **importé** de la source | agent §8 |
| Réglementation BCEAO | non codée ; se manifeste via le peg XOF/EUR fixe | `fx.js` |
| Pays gérés | zone UEMOA/CEMAC ; champ `country` (importé) sur BC ; pas de moteur pays | `types.ts:203` |
| Jours fériés / calendrier ouvré | **aucun référentiel** (`ferie`/`holiday` non exploités) | Phase 0 §5, agent §9 |

---

# F. CONTRADICTIONS RELEVÉES DANS L'EXISTANT

| # | Sujet | École A (où, combien) | École B (où, combien) | Domine | Le module suit | Pourquoi |
|---|---|---|---|---|---|---|
| 1 | Champ d'horodatage d'écriture | **`ts`** (`auditLog`/config) — **106** `ts: serverTimestamp()` | `updatedAt` (**82**, overlays/satellites) + `createdAt` (16, `users`) | `ts` sur l'audit ; `updatedAt` sur les entités mutables | **`ts`** pour l'audit du module, **`updatedAt`** pour l'état d'un doc `mnt_*` | copie l'usage par contexte, ne fusionne pas |
| 2 | Nom du concept « client » | `client` (`Order`, `Invoice`) | `customer` (`BcLine`) | `client` (2 collections vs 1) | **`client`** | source dominante + langue métier fr côté vente |
| 3 | Échelle des taux/proba | IdC en **% 0-100** (décidé #368) | taux internes en **0-1** (`pct` fait ×100) | coexistence normalisée par `p01` | **% 0-100** en surface, `p01` au calcul | décision actée #368 (CLAUDE.md) |
| 4 | Auteur d'une écriture | `uid` dans `auditLog` (systématique) | `createdBy`/`updatedBy`/`actor` (10/8/10, épars) | `uid` via `auditLog` | **`uid` + entrée `auditLog`** | l'audit centralise l'acteur ; pas de `*By` par doc |
| 5 | Arrondi des montants | affichage/conversion **entier** (`Math.round`, 50 occ.) | `toFixed(2)` (10 occ. : `alerts`, `news`, `capacity`, `candidate` — pas le carnet) | entier (montants du carnet) | **entier FCFA** ; `toFixed` réservé aux ratios non monétaires | FCFA sans subdivision |

---

# G. RÈGLES ABSENTES

> Ce que l'ERP ne tranche pas. Le module décide **par ADR**, et sa décision fait précédent.

| # | Sujet sans règle | Ce que le module doit décider | ADR |
|---|---|---|---|
| 1 | **Numérotation d'un objet natif** | comment numéroter un `mnt_contrat` (l'ERP ne génère aucune séquence) : séquence annuelle ? clé adossée au N° FP ? | ADR-001 |
| 2 | **4ᵉ couleur de risque** | Vert/Ambre/Rouge existent (emerald/gold/clay) ; « Critique » n'a pas de teinte — réutiliser `plum`/`steel` ou en poser une | ADR-002 |
| 3 | **Fuseau & calcul SLA à la minute** | aucun fuseau explicite dans le code ; quel fuseau de référence pour un SLA (Abidjan UTC+0 ?) et sur quels jours ouvrés | ADR-003 |
| 4 | **Jours fériés** | aucun référentiel ; où prendre les fériés locaux pour le décompte SLA (les recréer est interdit) | ADR-004 |
| 5 | **Drapeau de fonctionnalité** | aucun feature-flag générique ; le module doit s'éteindre sans redéploiement → overlay `config/mntFeature` ? | ADR-005 |
| 6 | **Langue des identifiants du module** | acter « collections/champs anglais camelCase préfixés `mnt_`, métier fr en libellé » (cohérent A.1) | ADR-006 |
| 7 | **Décimales réellement stockées** | confirmer si des montants décimaux existent en base (imports) → type du champ montant `mnt_*` | ADR-007 |
| 8 | **Source du coût chargé consultant** | quelle donnée fait foi pour la marge d'une intervention (coût vs TJM de vente) | ADR-008 |
| 9 | **State/statuts d'un contrat & couleurs** | valeurs d'énumération (code applicatif, comme `stage`) et leur teinte dans `tokens.ts` | ADR-009 |
| 10 | **before/after d'audit** | `auditLog` ne stocke pas l'état avant/après ; le module suit-il (extrait minimal) ou enrichit-il | ADR-010 |

---

# H. LES DIX RÈGLES QUE LE MODULE NE DOIT JAMAIS ENFREINDRE

| # | Règle | Comment la vérifier mécaniquement |
|---|---|---|
| 1 | **Montants en `number`, arrondi FCFA entier** — jamais `string`, jamais de décimale FCFA affichée | `rg ': *number' web/src/types.ts` sur champs `mnt_*` ; `rg 'toFixed\(2\)' web/src/modules/<mnt>` doit être vide sur les montants |
| 2 | **Date : stockée ISO `AAAA-MM-JJ`, affichée `JJ/MM/AAAA` via `frDate`** | `rg 'toLocaleDateString|AAAA-MM|YYYY-MM' web/src/<mnt>` = 0 ; tout affichage passe par `frDate` |
| 3 | **Séparateur de milliers = espace, formatage via `fmt`/`fmtFull`/`money`** — aucun formateur maison | `rg 'toLocaleString\("en|,\d{3}' <mnt>` = 0 ; imports de `tokens.ts`/`format.ts` présents |
| 4 | **Aucune couleur/taille en dur : tokens `T.*` / CSS-vars uniquement** | `rg '#[0-9a-fA-F]{3,6}|rgb\(\d' web/src/modules/<mnt>` = 0 (hors tokens) |
| 5 | **Icônes lucide-react uniquement** | `rg "from '(react-icons|@heroicons|@mui)" web/src/<mnt>` = 0 |
| 6 | **Boutons à l'infinitif ; « Enregistrer » (pas « Sauvegarder ») ; écritures via `Busy`/`DangerBtn`** | `rg 'Sauvegarder' web/src/modules/<mnt>` = 0 ; actions destructives → `DangerBtn` |
| 7 | **Nommage : collections/champs `mnt_` camelCase anglais, métier fr en libellé** | `rg -o '"mnt_[a-z]' ...` tous camelCase ; aucun snake_case de champ |
| 8 | **Erreurs via `HttpsError(code, messageFR)` ; validation impérative (pas de zod/joi)** | `rg 'throw new HttpsError' functions/<mnt>` présent ; `rg 'zod|joi|yup' functions/<mnt>package` = 0 |
| 9 | **Toute écriture sensible journalisée en `auditLog` au schéma `{uid,action,module,entity,entityId,detail,ts}`** | `rg 'collection\("auditLog"\)' functions/<mnt>` présent avec les 6 champs |
| 10 | **RBAC : `requireWrite/requireRead(req, module)` serveur + gate front ; marge/coût gated `rentabilite`** | `rg 'requireWrite|requireRead' functions/<mnt>` sur chaque callable ; règle `summaryModule` pour tout agrégat marge |

---

### Résumé de fin de phase

**Règles extraites** : A (base de données) 40+ · B (ingénierie) 35+ · C (tokens/design) 30+ ·
D (interface) 45+ · E (métier/réglementaire) 9 · **~160 règles chiffrées**, chacune sourcée.

**Contradictions (F)** : 5 relevées — la plus structurante est le **triple champ d'horodatage**
(`ts`/`updatedAt`/`createdAt`) sans règle unifiée, et les **deux mots pour « client »**.

**Règles absentes (G)** : 10, toutes converties en ADR à ouvrir (numérotation, 4ᵉ couleur de
risque, fuseau/SLA, jours fériés, feature-flag, langue des identifiants, décimales, coût chargé,
énumérations de statut, before/after d'audit).

**Les trois règles qui vont le plus contraindre le module :**
1. **Montants `number` + arrondi FCFA entier** (H1/F5) — tout calcul de facturation/quota/coût du
   module doit s'y plier ; un `toFixed(2)` sur un montant trahirait immédiatement.
2. **Aucune numérotation native + aucun feature-flag générique** (G1/G5) — deux briques que le
   module doit inventer proprement, par ADR, sans casser l'additivité.
3. **Fuseau/SLA implicite + jours fériés absents** (G3/G4/A.6) — le cœur métier du module (SLA à
   la minute) repose sur des données que l'ERP ne fournit pas ; à cadrer avant tout code.

> **Phase 1 terminée. Relisez la section F (contradictions) et H (les dix intouchables) : c'est
> là que se jouera l'intégration. Validez avant `/2-accelerateurs`.**
