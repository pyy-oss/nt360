# CLAUDE.md — nt360

Cockpit de pilotage pour ESN/SSII (zone UEMOA/CEMAC). Ce fichier oriente toute session Claude Code
sur ce dépôt : conventions non négociables, pièges, et comment vérifier une modification.

## Contexte métier

- **Devise pivot : XOF / FCFA** (zone UEMOA/CEMAC) — **jamais** l'euro par défaut. Parité légale fixe
  `EUR = 655,957 XOF` (repli quand `config/fxRates` ne fournit pas de taux). Aligné entre
  `functions/lib/fx.js` (peg) et le front (`FIXED_PEG`).
- Public : direction/CODIR, commerciaux (AM), PM/PMO, achats, data-stewards. Toute l'UI est en **français**.
- Objets clés : Opportunité (pipeline) → Commande (carnet P&L) → Facture ; BC fournisseurs ; Fiches
  affaire ; Consultants/CRA (activité ESN). N° **FP** = clé d'affaire canonique reliant tout.

## Architecture

Monorepo pnpm : `web/` (React + Vite + TS + Tailwind), `functions/` (Firebase Functions **CommonJS**),
`docs/` (ARCHITECTURE.md, BUILD_KIT.md, runbooks). Firestore **base nommée `nt360`** ; projet Firebase
partagé `propulse-business-87f7a` (hosting site `nt360`).

- **`functions/domain/*.js`** : logique métier **PURE** (aucune I/O), testée avec vitest. C'est là que
  vivent les prédicats, agrégats, projections. À privilégier pour toute règle de calcul.
- **`functions/lib/*.js`** : ponts I/O (Firestore, parsing, orchestration). `lib/aggregate.js` est
  l'orchestrateur du recompute (lit collections → `mergeCommandes` → écrit `summaries/*` + chunks).
- **`functions/index.js`** : ~136 callables/triggers HTTP (monolithe ; découpe en cours — Lot Archi).
- **`web/src/modules/*.tsx`** : écrans (lazy-loadés). **`web/src/lib/`** : hooks (`useDocData`/
  `useCollectionData` = temps réel `onSnapshot`), `ids.ts` (**miroir client de `fpKey`**), projection,
  scope/RBAC. **`web/src/design/`** : primitives (Card, Table, Modal, Kpi, DangerBtn, `useConfirm`, …)
  + tokens CSS-var (`T.*`).

### Autorités de calcul (ne pas contourner)
- **`mergeCommandes(orders, opps, sheets, invoices)`** (`domain/commandes.js`) : carnet fusionné, autorité
  fiche > opp gagnée (stage 6) > P&L ; seuls les FP adossés au P&L deviennent commandes.
- **`fpKey(v)`** (`lib/ids.js` + `web/src/lib/ids.ts`) : canonicalise un N° FP (`FP/AAAA/N`, zéros de tête
  normalisés, placeholders `.../0000` rejetés). **Rapprocher DEUX FP se fait TOUJOURS via `fpKey`**, front
  comme back — sinon double-compte / faux orphelins.
- **`plausibleYear(yearPo)`** ([2015 .. année+3], 0 sinon) : **tout filtrage/regroupement par millésime**
  passe par elle (jamais `yearPo` brut) — sinon des millésimes aberrants (1900, 20226) polluent une vue
  et pas l'autre.
- **`projectionWeight(o, tiers)`** (`domain/projection.js` + `web/src/lib/projection.ts`) : pondéré TIÉRÉ
  par palier d'IdC (config `config/projection`). **Source unique du « pondéré »** — ne jamais réintroduire
  le champ linéaire persisté `o.weighted` dans l'affichage.

### Cohérence des chiffres (invariant fort)
Une même métrique calculée à deux endroits (backend summary vs re-dérivation frontend, alertes vs Qualité)
**doit** donner le même nombre. Pièges récurrents à éviter : populations divergentes (annulés exclus d'un
côté seulement, `stale`/aged, déjà-au-carnet), gates de recompute désalignés (`want(...)`), drapeaux
persistés jamais réécrits (`linked`), FP bruts vs `fpKey`. Le recalcul frontend `overviewCalc.ts` **doit
rester le miroir exact** de `chaine.js`/`aggregate.js`. Tests de parité : `functions/test/consistencyAlertsDq.test.js`, `web/src/lib/ids.test.ts`.

## Sécurité

- RBAC : `requireWrite/requireRead(req, module)`. Record-level sous OWD `private` :
  `recordAccessOwd`, `isRecordAdmin`, `assertRecordVisible`, `visibleTo`.
- Claim namespacé `nt360Role` requis sur les callables sensibles. `rateLimit(uid, key, limit, windowMs)`
  (fail-open). App Check off par défaut (`APPCHECK_ENFORCE !== "true"`).
- Overlays (docs config, survivent aux ré-imports) : `fpAliases`, `orderCasOverride`, `cancelOrders`/
  `cancelInvoices`, `clickupSync`, `recomputeLock`/`recomputeRequest`.
- **Dette connue** : `xlsx@0.18` (CVE-2023-30533) — migration vers `exceljs` (déjà en dépendances) à faire
  dans une **session dédiée** (6 parsers, ~65 sites, API sync→async, valider avec des fixtures d'import).

## IA (assistant Centre de correction, scoring)

Utiliser l'SDK `@anthropic-ai/sdk`, le modèle Opus courant retenu dans le code existant, thinking
`{ type: "adaptive" }`, gérer `stop_reason === "refusal"`. Clé dans Secret Manager (`ANTHROPIC_API_KEY`).
Voir la skill `claude-api` pour l'ID de modèle exact et les paramètres à jour.

## Déploiement & CI (garde-fous — ne pas casser)

- **Déploiement par nom** : toute fonction exportée de `index.js` doit figurer dans
  `functions/deployed-functions.txt` (projet Firebase partagé).
- Gardes CI (à faire passer avant de pousser) :
  - `functions/scripts/check-deploy-targets.mjs` — exports ⊆ deployed-functions.txt
  - `functions/scripts/check-no-undef.mjs` — anti-ReferenceError (requires en portée fonction)
  - `functions/scripts/check-firestore-indexes.mjs`
  - `web/scripts/check-bundle.mjs` — **chunk d'entrée ≤ 120 KB** (tout import lourd → `React.lazy`)
- Recompute sérialisé : verrou à bail (`config/recomputeLock`, `RECOMPUTE_LEASE_MS`) + coalescing
  (`lib/aggregate.js`). Différé via `requestRecompute` → `onRecomputeRequest`.

### Coûts GCP — règles de déploiement (ne JAMAIS contourner)
Un empilement de Cloud Builds a déjà coûté cher (~2600 builds). Ces règles rendent la récidive impossible ;
détail et gestes GCP dans `RUNBOOK-COUTS.md`, audit via `/audit-couts`.
- **Ne déploie JAMAIS le codebase entier des fonctions** : toujours des cibles **nommées** (`--only
  functions:<nom>`). Le hook `.claude/hooks/guard-deploy.py` bloque le reste — ne le désactive pas.
- **Un seul déploiement à la fois** : garde les blocs `concurrency` des workflows (deploy = `cancel-in-progress:
  false`, CI/preview = `true`). Ne rétablis pas `push:["**"]` sur le CI (double run).
- **Déploiement sélectif** : `functions/scripts/deploy-targets.mjs` dérive les cibles du git diff — ne
  redéploie pas de fonctions pour un changement doc/web seul.
- **Tout appel IA passe par un callable avec `rateLimit`** (bucket `"ai"`) + cap sur le lot. Jamais dans une
  boucle non bornée ni un cron sans plafond.
- **Aucun `minInstances > 0`** sans besoin chiffré. Nouveau projet ⇒ dérouler `docs/CHECKLIST-NOUVEAU-PROJET-GCP.md`.

## Commandes

```
pnpm test                 # web + socle backend (vitest) — 58 + 763 tests
pnpm --filter @nt360/functions-shared test   # tests domaine/lib/parsers (déplacés dans le socle partagé)
pnpm --filter functions test:rules           # règles Firestore sous émulateur (restées dans functions/)
pnpm --filter web build && node web/scripts/check-bundle.mjs
pnpm emulators            # firebase emulators (nécessaire pour valider imports/règles)
pnpm test:rules           # règles Firestore sous émulateur
```

> **Note split** : le code serveur PARTAGÉ (`lib/`, `domain/`, `parsers/`, `handlers/`, `test/`) vit dans le
> package `@nt360/functions-shared` ; `functions/index.js` (point d'entrée, un seul codebase déployé) l'importe
> via `@nt360/functions-shared/…`. Voir `docs/SPLIT-CODEBASES.md`.

## Workflow Git

Branche de dev unique par tâche ; PR **squash-merge** ; après fusion, repartir de `origin/main`
(même nom de branche). Reconcilier un remote périmé avec `git merge -s ours origin/<branche>`
(**jamais** `-X ours`). Les commits de squash-merge GitHub (`committer noreply@github.com`) sont sur
l'historique fusionné de `main` — **ne pas les amender** (forkerait `main`) ; c'est un faux positif du
stop-hook.

## Style

Écrire du code qui se fond dans l'existant : mêmes idiomes, densité de commentaires (commentaires en
français, orientés « pourquoi »), primitives design réutilisées. Préférer une règle métier PURE dans
`domain/` + test vitest à du code inline non testé.


---

# Module Contrats de Maintenance — règles de travail

Cette section encadre tout travail sur le module de gestion des contrats de maintenance.
Elle s'applique à chaque session, sans rappel.

## Le contexte en une phrase

On ajoute un module de pilotage des contrats de maintenance **à l'intérieur d'un ERP maison
existant, en production, que d'autres personnes utilisent tous les jours**. La réussite ne se
mesure pas à la qualité du module. Elle se mesure à deux choses : **rien d'autre n'a bougé**, et
**le module est indiscernable du reste de l'ERP**.

## Les documents de référence

| Fichier | Rôle | Modifiable ? |
|---|---|---|
| `docs/contrats/00-SPEC-MODULE.md` | Le besoin. Ce qu'on doit produire. | ❌ Jamais |
| `docs/contrats/01-EXISTANT.md` | **Où** sont les choses dans l'ERP. | Phase 0 |
| `docs/contrats/02-REGLES.md` | **Comment** les choses s'écrivent. Base, ingénierie, tokens, UI/UX, métier. | Phase 1 |
| `docs/contrats/03-ACCELERATEURS.md` | Ce qu'on réutilise plutôt que de le recréer. | Phase 2 |
| `docs/contrats/04-PLAN-INTEGRATION.md` | Où et comment le module s'ancre. | Phase 3 |
| `docs/contrats/05-DECISIONS.md` | Registre des décisions (ADR). | Append-only |
| `docs/contrats/06-JOURNAL.md` | Fait, appris, échoué. | Append-only |

**Au début de chaque session : lis `01-EXISTANT.md`, `02-REGLES.md`, `03-ACCELERATEURS.md`,
`04-PLAN-INTEGRATION.md` et `06-JOURNAL.md` avant toute autre action.** S'ils sont vides ou
marqués `[À REMPLIR]`, la phase correspondante n'est pas faite : n'avance pas, dis-le.

## La séquence — non négociable

```
Phase 0  Empreinte     → où sont les choses          → aucun code applicatif
Phase 1  Règles        → comment elles s'écrivent    → aucun code applicatif
Phase 2  Accélérateurs → ce qu'on ne recrée pas      → aucun code applicatif
Phase 3  Plan          → où le module s'ancre        → aucun code applicatif
Phase 4  Filet         → tests de caractérisation    → tests seulement
Phase 5+ Lots          → le module, un lot à la fois → code
```

Chaque phase se termine par une **validation humaine explicite**. Tu ne passes pas à la suivante
de ta propre initiative. Tu produis le livrable, tu résumes, tu signales tes incertitudes, tu
t'arrêtes.

## La règle qui prime sur toutes les autres

> **La règle de l'ERP gagne. Toujours.**
>
> Même laide. Même datée. Même contraire à l'état de l'art. Même contraire à la spécification du
> module. Si l'ERP stocke les montants en flottant, le module aussi. S'il nomme ses tables
> `T_CLI_01`, le module aussi. S'il écrit « Sauvegarder » et pas « Enregistrer », le module aussi.
>
> Tu n'es pas là pour élever le niveau. Tu es là pour être **indiscernable**. Un îlot de code
> exemplaire au milieu d'un ERP qui ne l'est pas ne relève rien : il crée deux façons de faire,
> donc deux façons de se tromper.
>
> Toute exception à cette règle passe par un ADR validé par un humain. Aucune exception.

## Interdits absolus

- ❌ **Ne recrée pas ce qui existe.** Avant de créer une table, un service, un composant, un
  utilitaire : cherche. Si tu ne trouves pas, cherche encore avec un autre vocabulaire (l'ERP
  est en français, ou en anglais, ou en abrégé maison). Si tu ne trouves toujours pas, demande
  confirmation avant de créer.
- ❌ **N'invente aucune convention.** Nommage, types, formats, couleurs, libellés : tout est dans
  `02-REGLES.md`. Si une règle y manque, c'est un ADR, pas une décision silencieuse.
- ❌ **Aucune valeur en dur** — couleur, taille, espacement, police, format de date — si l'ERP a
  une source de tokens.
- ❌ **Ne modifie ni ne supprime jamais une colonne ou une table existante.** Additif uniquement.
- ❌ **Ne touche à aucun fichier hors du périmètre du lot** sans demander.
- ❌ **N'ajoute aucune dépendance** sans ADR validé.
- ❌ **Ne devine pas la pile technique.** Lis-la.
- ❌ **Ne réécris pas du code existant « au passage »** parce qu'il te semble améliorable. Note-le
  dans le journal.
- ❌ **N'invente aucune donnée.** Une hypothèse non signalée est un bug différé.

## Obligations

- ✅ **Additif uniquement** : schéma en *expand / migrate / contract*.
- ✅ **Espace de noms dédié** : préfixe `mnt_` (ou celui défini en `02-REGLES.md` si l'ERP en
  impose un autre), pour que la frontière du module soit visible à l'œil nu.
- ✅ **Drapeau de fonctionnalité** : le module s'éteint sans redéploiement, et à drapeau éteint
  l'ERP est **strictement** celui d'avant.
- ✅ **Test de caractérisation avant modification.**
- ✅ **Un lot = une branche = une revue.**
- ✅ **Chaque décision structurante = un ADR.**
- ✅ **Fin de session = entrée de journal**, échecs compris.

## Les dix règles intouchables

> **[À REMPLIR EN FIN DE PHASE 1]** — recopiées depuis `02-REGLES.md` §H.
> Ce sont les règles dont la violation serait immédiatement visible par un utilisateur ou un
> développeur de l'ERP. Chacune porte son moyen de vérification mécanique, et chacune est
> contrôlée à chaque `/verif`.

| # | Règle | Vérification |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |

## Les pièges connus

| Piège | Règle |
|---|---|
| **Arrondi FCFA** | Le franc CFA n'a pas de subdivision. Fais comme l'ERP, pas comme la norme. |
| **Type des montants** | Si l'ERP est en flottant, le module aussi. ADR pour signaler le risque, pas pour le corriger. |
| **Format de date** | Un module qui affiche `AAAA-MM-JJ` dans un ERP en `JJ/MM/AAAA` saute aux yeux. |
| **Couleurs de statut** | L'ERP a déjà un rouge et un vert qui veulent dire quelque chose. Les 4 couleurs de risque du module doivent-elles s'y aligner ? → ADR. |
| **Fuseau** | Abidjan est à UTC+0. Le SLA se calcule à la minute. Vérifie ce que l'ERP stocke. |
| **Langue des identifiants** | Suis l'ERP, pas la spécification du module. |
| **Jours fériés** | Ils sont dans la paie, pas dans un module « calendrier ». |
| **Coûts horaires chargés** | Ils existent déjà. Les recréer, c'est créer une deuxième vérité. |

## Le vocabulaire du module

`contrat` · `version_contrat` · `engagement_sla` · `couverture_b2b` · `quota` ·
`echeance_facturation` · `ligne_cout` · `ticket` · `intervention` · `evenement_sla` ·
`score_risque` · `signal` · `decision`

**Sauf si l'ERP est en anglais** — auquel cas tu suis l'ERP. La règle est la cohérence, pas la langue.

## Quand tu es bloqué

Dis-le. Explicitement. Avec ce que tu as cherché et ce que tu n'as pas trouvé.
Une question posée coûte deux minutes. Une hypothèse silencieuse coûte un lot.
