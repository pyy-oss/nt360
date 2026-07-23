# Plan de migration — split du monolithe `functions` en codebases Firebase

> **But** : réduire le « blast radius » des déploiements. Aujourd'hui, tout changement de `functions/index.js`
> (5 406 lignes, 202 exports, 1 seul `package.json`) redéploie **les 202 fonctions** → ~16 min de fenêtre
> pendant laquelle les callables peuvent flancher (CORS transitoire pendant la reconciliation Cloud Run —
> cf. incident du 2026-07-23). Un split par domaine ramène cette fenêtre à quelques fonctions par changement.

## ⚠️ Garde-fou de validation (NON négociable)

Un split de codebases se valide **uniquement** par un vrai `firebase deploy`. Le mécanisme est piégeux :
au déploiement, Firebase **réconcilie** chaque codebase et marque pour **SUPPRESSION** toute fonction
présente en prod mais absente de la source du codebase. **Une frontière mal posée = suppression de fonctions
prod.** Donc :

- **Ne jamais merger ce split sur `main` sans l'avoir deploy-validé** sur un projet de **staging** (ou au
  minimum `firebase deploy --only functions:<codebase> --dry-run` par codebase, en vérifiant qu'AUCUNE
  suppression inattendue n'est proposée).
- Rollout **incrémental** : un codebase à la fois, en commençant par le moins couplé.
- **Rollback** : revenir à un `firebase.json` à codebase unique `default` restaure le comportement d'avant
  (les fonctions ne bougent pas si la source les contient toujours).

## Architecture cible (workspace pnpm)

Le repo est déjà un workspace pnpm (`web`, `functions`). On ajoute un package partagé et des codebases :

```
functions-shared/     # package partagé — AUCUNE fonction exportée, que du code réutilisé
  lib/  domain/  parsers/            # déplacés depuis functions/
  infra/                              # EXTRAIT de l'actuel index.js :
    onCallG, onRequestG, RBAC (requireWrite/requireRead/recordAccessOwd…),
    rateLimit, logOps, requestRecompute, init db/admin, définitions de secrets
  package.json  (name: "@nt360/functions-shared")

functions-core/       # codebase "core" — hot path + infra transverse
  index.js            # recompute/aggregate, overview, imports, http (api/webhooks),
                      # clickup, odoo, ai, scheduled — le tronc partagé
functions-mnt/        # codebase "maintenance"  → handlers/maintenance.js
functions-par/        # codebase "partenariats" → handlers/partenariats.js
functions-rh/         # codebase "rh"           → staffing + timesheets + candidates
functions-commerce/   # codebase "commerce"     → opportunities + objectives + fiches
functions-ops/        # codebase "ops"          → reports + outbound + automations + sanitize
```

Chaque `functions-*/index.js` : `const s = require("@nt360/functions-shared");` puis
`const h = createXxx(s.deps); exports.foo = h.foo;` — le **même patron d'injection qu'aujourd'hui**,
simplement réparti. `functions-shared` est une dépendance `workspace:*` de chaque codebase.

### `firebase.json` cible
```json
"functions": [
  { "source": "functions-core",     "codebase": "core",       "runtime": "nodejs20" },
  { "source": "functions-mnt",      "codebase": "maintenance", "runtime": "nodejs20" },
  { "source": "functions-par",      "codebase": "partenariats","runtime": "nodejs20" },
  { "source": "functions-rh",       "codebase": "rh",          "runtime": "nodejs20" },
  { "source": "functions-commerce", "codebase": "commerce",    "runtime": "nodejs20" },
  { "source": "functions-ops",      "codebase": "ops",         "runtime": "nodejs20" }
]
```

## Frontières proposées (dérivées des handlers factory existants)

| Codebase | Fonctions | Source |
|---|---|---|
| **core** | recompute, overview, imports, `api`, `clickupWebhook`, `odooWebhook`, clickup*, odoo*, ai*, curate*, scheduled*, + tout l'inline restant d'`index.js` | index.js (résiduel) |
| **maintenance** | ~21 `*Mnt*`, astreintes | `handlers/maintenance.js` |
| **partenariats** | ~ `par_*` | `handlers/partenariats.js` |
| **rh** | staffing + timesheets + candidates | 3 handlers |
| **commerce** | opportunities + objectives + fiches | 3 handlers |
| **ops** | reports + outbound + automations + sanitize | 4 handlers |

> Le gros du gain vient d'isoler **maintenance / partenariats / rh / commerce / ops** (déjà en handlers DI,
> couplage faible) : un changement dans l'un ne redéploie plus `core`. **Nuance** : un changement dans
> `functions-shared` (lib/domain partagés) redéploie TOUS les codebases — inévitable, mais c'est la minorité
> des changements de feature.

## Impacts outillage (à adapter dans le même lot)

- **`deployed-functions.txt`** → un manifeste **par codebase** (`functions-*/deployed-functions.txt`), et
  `check-deploy-targets.mjs` compare les exports de chaque codebase à son manifeste.
- **`firebase-deploy.yml`** : `deploy-targets.mjs` doit émettre les cibles **par codebase** (`--only
  functions:core:foo,functions:maintenance:bar`) à partir du git diff (un fichier `functions-mnt/**` changé
  ⇒ ne déployer que le codebase `maintenance`). Le fail-safe reste : au doute, déployer tous les codebases.
- **`check-no-undef.mjs`** : le scanner tourne par codebase.
- **Tests vitest** : restent au niveau `functions-shared` (domaine PUR) — inchangés en logique.

## Séquence de rollout (incrémental, une PR par étape, chacune deploy-validée)

1. **Étape 0** — créer `functions-shared` (déplacer lib/domain/parsers + extraire l'infra d'index.js).
   `functions` continue de tout exporter en important `functions-shared`. **Aucun changement de topologie
   de déploiement** → deploy identique, risque quasi nul, valide la mécanique du package partagé.
   **Sous-étape faite (socle infra, `functions/lib/runtime.js`)** : le premier pas — extraire l'infra
   transverse d'`index.js` dans un module partagé injecté (`createRuntime(deps)`) — est réalisé et
   vérifié EN L'ÉTAT (sans changement de topologie), en 4 incréments deploy-neutres :
   - inc 1 : `logOps`, `assertPlainId`, `rateLimit` ;
   - inc 2 : `requireWrite`, `requireRead` (matrice opposable) ;
   - inc 3 : `onCallG` / `guarded` / `EXPECTED_ERR` / `SLOW_CALLABLE_MS` + `postWebhook` (colonne
     vertébrale des callables) ;
   - inc 4 : `isRecordAdmin`, `recordAccessOwd`, `assertRecordVisible`, `requireStrongAuth` (RBAC
     record-level + MFA).

   Chaque incrément vérifié : **203 exports** (identiques à la découverte Firebase), `check-no-undef`
   vert, `check-deploy-targets` vert, **1386 tests** verts, et — pour les helpers à `require`
   paresseux (`../domain/authz`) — un **appel forcé** confirmant que le chemin résout (le piège qui
   passe le harness de chargement ET les tests mais casserait en prod). `createRuntime` est un simple
   déplacement de code (corps extraits tels quels) : comportement runtime STRICTEMENT inchangé.

   **Sous-étape 0b FAITE (package `@nt360/functions-shared`)** : `lib/`, `domain/`, `parsers/`, `handlers/`
   et `test/` sont physiquement déplacés (git mv, layout interne préservé → tous les `require` internes du
   socle restent valides) dans le package workspace `functions-shared` (`@nt360/functions-shared`).
   `functions/` ne garde que `index.js` + `scripts/` + les tests de règles, et déclare
   `"@nt360/functions-shared": "workspace:*"` ; ses 246 `require("./lib|domain|handlers|parsers/…")`
   pointent désormais sur `@nt360/functions-shared/…`. **Toujours un seul codebase** (`firebase.json`
   inchangé, `source: "functions"`, `codebase: "default"`) → **deploy-neutre, aucun changement de
   topologie**. Outillage adapté dans le même lot : `check-no-undef` (lint des DEUX arbres depuis la racine),
   `deploy-targets` (un changement sous `functions-shared/` déclenche le déploiement), tests vitest au
   niveau du socle, scripts racine + CI.

   Vérifié EN SANDBOX : `pnpm install` relie le `workspace:*` ; `functions/index.js` charge = **203 exports**
   en résolvant `@nt360/functions-shared` via le symlink pnpm (résolution Node réelle du package partagé,
   le piège n°1 d'un split workspace) ; `check-no-undef` (171 fichiers) + `check-deploy-targets` (202) verts ;
   **1386 tests** verts.

   ⚠️ **Résidu deploy (non vérifiable sans un vrai `firebase deploy`)** : au déploiement du codebase
   `functions`, firebase-tools doit **empaqueter** la dépendance workspace `@nt360/functions-shared` (dont la
   source est HORS du dossier `functions/` uploadé). firebase-tools ≥ 13 gère les workspaces pnpm, mais ce
   n'est validable qu'à un déploiement réel. Si la résolution échoue au deploy (échec NON destructif : le
   déploiement n'aboutit pas, les fonctions en place ne bougent pas), repli : `predeploy` avec
   `pnpm --filter functions deploy <dir>` (isole functions/ + ses deps workspace dans un dossier autonome),
   puis pointer `source` sur ce dossier.

   `requestRecompute` / `refreshNowBestEffort` NE sont volontairement PAS extraits dans le socle : ils
   dépendent de `recomputeSummaries` (orchestrateur du recompute), qui appartient à `core`, pas à l'infra
   partagée. C'est la frontière où l'Étape 0 (socle) s'arrête et l'Étape 1 (topologie) prend le relais.
2. **Étape 1 FAITE (code) — codebase `partenariats` (`functions-par/`)** : les 21 callables
   `createPartenariats` sont désormais déclarés dans `functions-par/index.js` (même patron d'injection,
   handler partagé `@nt360/functions-shared/handlers/partenariats`), retirés de `functions/index.js`,
   `firebase.json` gagne `{ source: "functions-par", codebase: "partenariats" }`. `parRelancesSweep`
   (scheduler couplé aux helpers email) RESTE dans `default`. **Recompute DIFFÉRÉ** imposé (le codebase ne
   porte pas `recomputeSummaries`) : `recomputeNow: undefined` → `requestRecompute` écrit
   `config/recomputeRequest`. Outillage rendu multi-codebases : `deployed-functions.txt` par codebase,
   `check-deploy-targets` (par codebase + invariant **disjoint** + total), `deploy-targets` (union des
   manifestes), `check-no-undef` (lint aussi `functions-par/index.js`).

   Vérifié EN SANDBOX : `default` charge 182 exports, `partenariats` 21 (total inchangé) ; `check-deploy-targets`
   = **default 181 + partenariats 21 = 202, ensembles disjoints** (invariant : rien perdu, rien dupliqué) ;
   `check-no-undef` (172 fichiers) + **1386 tests** verts.

   ⚠️ **DEUX préalables au déploiement (ne PAS merger sans)** :
   - **(a) Canal recompute différé VIVANT en prod** : déployer le trigger `onRecomputeRequest` (codebase
     `default`) + poser `RECOMPUTE_REGION` (alignée sur la base nommée). Sinon les mutations partenariats
     déposent des demandes JAMAIS traitées → **KPI partenariats périmés**. Vérifier end-to-end : muter un
     partenaire → une demande apparaît dans `config/recomputeRequest` → les `summaries` se rafraîchissent.
   - **(b) Déploiement de TRANSFERT (les 21 changent de codebase `default` → `partenariats`)** : à faire en
     **une commande couvrant les DEUX codebases** — `firebase deploy --only functions:default,functions:partenariats`
     — pour que Firebase transfère la propriété sans fenêtre où les fonctions seraient supprimées d'un côté
     avant d'être créées de l'autre. NE PAS déployer `partenariats` seul en premier. Faire d'abord un
     `--dry-run` et **vérifier qu'AUCUNE suppression inattendue** n'est proposée (seul le transfert des 21).
   Rollback = retirer l'entrée `functions-par` de `firebase.json` + restaurer le bloc dans `functions/index.js`.
2bis. **Étape 2 FAITE (code) — codebase `rh` (`functions-rh/`)** : démarre avec les CANDIDATS
   (`upsertCandidate` / `deleteCandidate` / `listCandidates`), retirés de `functions/index.js`.
   `createCandidates` est le handler **le MOINS couplé** du dépôt (aucun recompute, aucun secret, aucun
   helper d'index.js — uniquement le socle) → **pas de préalable « recompute différé »**, seul le
   déploiement de transfert s'applique (les 3 fonctions passent `default` → `rh`, même procédure §pt 2b).
   staffing / timesheets rejoindront `rh` PLUS TARD en **ajout additif** (mêmes codebase → pas un transfert),
   une fois le canal différé validé (ils écrivent des summaries).
   Vérifié EN SANDBOX : `default` 179 + `partenariats` 21 + `rh` 3 = 203 exports (inchangé) ;
   `check-deploy-targets` **178 + 21 + 3 = 202, disjoints** ; `check-no-undef` 173 fichiers ; 1386 tests verts.
2ter. **Étape 3 FAITE (code) — codebase `commerce` (`functions-commerce/`)** : OBJECTIFS (R/O CODIR) +
   FICHES AFFAIRE (8 callables), retirés de `functions/index.js`. Seul couplage = recompute → **différé**
   (même préalable que partenariats : canal différé vivant en prod). Les OPPORTUNITÉS rejoindront `commerce`
   plus tard (après remontée au socle des helpers d'index.js : `visibleToFor`, `oppScope`, `fireOutbound`…).
   Vérifié EN SANDBOX : `default` 171 + `partenariats` 21 + `rh` 3 + `commerce` 8 = 203 (inchangé) ;
   `check-deploy-targets` **170 + 21 + 3 + 8 = 202, disjoints** ; `check-no-undef` 174 fichiers ; 1386 tests verts.
3. **Étapes 4..n** — un codebase (ou une remontée de helpers au socle) par extraction, même procédure.
   Restent couplés (helpers d'index.js à remonter au socle d'abord) : `opportunities` (visibleToFor,
   oppScope, fireOutbound), `reports` (scopedOpps, loadUsersMap), `automations` (loadUsersMap, nowISO10),
   `maintenance` (loadUsersMap, anyDirectionUid). Extractibles avec préalable différé seul : `sanitize`,
   `staffing`+`timesheets` (→ `rh`, additif).
4. **Étape finale** — `functions` résiduel devient `functions-core`.

## Définition de terminé

- Chaque codebase déploie indépendamment ; un changement de domaine ne touche que son codebase (vérifié :
  `firebase deploy --only functions:<codebase>` ne propose aucune suppression hors périmètre).
- `check-deploy-targets` vert par codebase ; tests vitest verts ; hook coûts + barrières inchangés.
- Fenêtre de churn au déploiement d'un domaine : quelques fonctions, plus 202.

---

**État** : PLAN validé. **Étape 0 EXÉCUTÉE, MERGÉE (#597)** (deploy-neutre) + **Étape 1 (codebase
`partenariats`) FAITE côté code, en attente de déploiement** (topologie — voir les DEUX préalables §Séquence
pt 2 : canal différé vivant + déploiement de transfert des deux codebases). Étape 0 =
socle infra `lib/runtime.js` (4 incréments) **puis** package partagé `@nt360/functions-shared` (déplacement
lib/domain/parsers/handlers/test, `functions/` consommateur `workspace:*`). 203 exports inchangés,
`firebase.json` inchangé, guards + 1386 tests verts. **Reste à faire** : les Étapes 1+ (changement de
topologie — extraire un codebase à la fois), qui nécessitent un environnement avec CLI firebase +
**staging** (ou au minimum un `firebase deploy … --dry-run`) pour la validation déploiement de chaque
étape, ET le préalable « canal de recompute différé réellement vivant en prod » (cf. §blocage recompute).
Voir le garde-fou ci-dessus avant toute exécution des étapes de topologie. Résidu deploy de l'Étape 0
(empaquetage de la dépendance workspace) : cf. §Séquence pt 1.
