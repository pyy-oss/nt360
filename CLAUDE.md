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

## Commandes

```
pnpm test                 # web + functions (vitest) — 58 + 763 tests
pnpm --filter functions test
pnpm --filter web build && node web/scripts/check-bundle.mjs
pnpm emulators            # firebase emulators (nécessaire pour valider imports/règles)
pnpm test:rules           # règles Firestore sous émulateur
```

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
