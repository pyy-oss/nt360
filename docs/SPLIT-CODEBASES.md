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
2. **Étape 1** — extraire le **1er** codebase le moins couplé (`ops` ou `partenariats`) dans son dossier +
   entrée, l'ajouter à `firebase.json`, le retirer de `functions`. Deploy-valider (vérifier 0 suppression
   inattendue). Rollback = retirer l'entrée.
3. **Étapes 2..n** — un codebase par PR, même procédure.
4. **Étape finale** — `functions` résiduel devient `functions-core`.

## Définition de terminé

- Chaque codebase déploie indépendamment ; un changement de domaine ne touche que son codebase (vérifié :
  `firebase deploy --only functions:<codebase>` ne propose aucune suppression hors périmètre).
- `check-deploy-targets` vert par codebase ; tests vitest verts ; hook coûts + barrières inchangés.
- Fenêtre de churn au déploiement d'un domaine : quelques fonctions, plus 202.

---

**État** : PLAN validé, exécution NON commencée (nécessite un environnement avec CLI firebase + staging pour
la validation déploiement de chaque étape). Voir le garde-fou ci-dessus avant toute exécution.
