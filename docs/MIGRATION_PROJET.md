# Runbook — Migration nt360 vers un projet Google Cloud dédié

Migration de nt360 du projet **partagé** `propulse-business-87f7a` vers un **nouveau projet Firebase/GCP
dédié** sur un autre compte Google. Décisions actées : la base Firestore reste **nommée `nt360`** (zéro
changement de code), les **données de production sont migrées** (Firestore + Storage + Auth).

## Valeurs concrètes de cette migration

| Élément | Valeur |
|---|---|
| Projet cible | **`neurones-360`** (n° `165643317476`) |
| Base Firestore nommée | **`nt360`** en région **`europe-west1`** |
| `RECOMPUTE_REGION` / `INGEST_REGION` | **`europe-west1`** (région simple co-localisée à la base) |
| Buckets (imports + sauvegardes) | Europe (`europe-west1` ou multi-région `eu`) |
| apiKey web | `AIzaSyA80fBp3QlqrJMXi5sCruapazuLvj5pju8` |
| authDomain | `neurones-360.firebaseapp.com` |
| storageBucket (Firebase) | `neurones-360.firebasestorage.app` |
| messagingSenderId / appId | `165643317476` / `1:165643317476:web:228e6c75b34e5c8e37fcf1` |

> `<NEW_PROJECT_ID>` = `neurones-360`, `<NEW_REGION>` = `europe-west1` dans tout ce qui suit.

### Bascule pilotée par variables GitHub (aucune bascule au merge)

Le dépôt est *project-agnostic* : le workflow `firebase-deploy.yml` lit `vars.FIREBASE_PROJECT_ID` (**repli
sur `propulse-business-87f7a`**) et injecte les `VITE_FIREBASE_*` depuis les variables de dépôt (repli sur
l'ancien projet via l'opérateur `||` de `web/src/lib/firebase.ts`). **Tant que les variables ci-dessous ne
sont pas posées, tout push — y compris le merge de la PR migration — déploie sur l'ANCIEN projet.** La
bascule ne se produit qu'en posant ces **variables de dépôt** (Settings → Variables) ET les secrets :

| Variable GitHub (Settings → Variables) | Valeur à la bascule |
|---|---|
| `FIREBASE_PROJECT_ID` | `neurones-360` |
| `FIREBASE_API_KEY` | `AIzaSyA80fBp3QlqrJMXi5sCruapazuLvj5pju8` |
| `FIREBASE_AUTH_DOMAIN` | `neurones-360.firebaseapp.com` |
| `FIREBASE_STORAGE_BUCKET` | `neurones-360.firebasestorage.app` |
| `FIREBASE_MESSAGING_SENDER_ID` | `165643317476` |
| `FIREBASE_APP_ID` | `1:165643317476:web:228e6c75b34e5c8e37fcf1` |
| `FIREBASE_HOSTING_SITE` | nom du site hosting neurones-360 (garder `nt360` si créé ainsi) |
| `IMPORTS_BUCKET` | nom du bucket d'imports du nouveau projet |
| `BACKUP_BUCKET` | `neurones-360-backups` |

| Secret GitHub (Settings → Secrets) | Valeur |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | clé JSON du SA de déploiement de `neurones-360` |
| `RECOMPUTE_REGION` | `europe-west1` |
| `APPCHECK_SITE_KEY` | clé reCAPTCHA v3 du domaine `neurones-360` |

---

## Phase 0 — Provisionnement du nouveau projet (console / gcloud)

1. **Créer le projet** `<NEW_PROJECT_ID>`, activer la **facturation Blaze** (requis pour Functions).
2. **Firestore** : créer une base **nommée `nt360`** (PAS `(default)`), mode **Native**, région `<NEW_REGION>`.
   Activer **PITR** : `gcloud firestore databases update --database=nt360 --enable-pitr --project=<NEW_PROJECT_ID>`.
3. **Hosting** : créer un site (garder le nom `nt360` s'il est disponible).
4. **Cloud Storage** : créer le bucket d'imports/exports (région alignée sur `<NEW_REGION>`) et un bucket de
   sauvegarde dédié `<NEW_PROJECT_ID>-backups` (rétention 90 j + versioning). Voir `docs/ops-commands.md`.
5. **Auth** : activer **Email/Password**, **MFA TOTP**, et ajouter le(s) domaine(s) hosting aux **domaines
   autorisés** (sinon login bloqué).
6. **App Check / reCAPTCHA v3** : créer une nouvelle clé de site liée au **nouveau domaine hosting**,
   enregistrer l'app Web dans App Check. Voir `docs/app-check.md` (procédure en 2 temps).
7. **Secret Manager** : créer `CLICKUP_TOKEN`, `ANTHROPIC_API_KEY`, `GRAPH_CLIENT_SECRET` (placeholder
   `UNSET` accepté pour les deux derniers, l'intégration reste inerte tant qu'ils ne sont pas renseignés).
8. **Comptes de service / IAM** :
   - **SA de déploiement** (nouvelle clé JSON pour `FIREBASE_SERVICE_ACCOUNT`) : rôles Firebase Hosting Admin,
     Cloud Datastore/Firestore (rules+indexes), Cloud Functions Admin, Service Account User, Secret Manager
     Secret Accessor, `roles/datastore.importExportAdmin`.
   - **SA runtime des functions** (`<projectNumber>-compute@…`) : `roles/datastore.importExportAdmin` (projet)
     + `roles/storage.admin` sur le bucket de sauvegarde (pour `scheduledFirestoreExport`).

## Phase 1 — Rendre le dépôt project-agnostic (branche + PR)

Références EN DUR à mettre à jour (tableau exhaustif) :

| Fichier | Occurrence | Nouvelle valeur |
|---|---|---|
| `.firebaserc` | `default: propulse-business-87f7a` | `<NEW_PROJECT_ID>` (garder aussi un alias vers l'ancien pour rollback) |
| `firebase.json` | `hosting.site: "nt360"` | site du nouveau projet |
| `firebase.json` | `firestore.database: "nt360"` | **inchangé** |
| `web/src/lib/firebase.ts:15-21` | 6 valeurs (apiKey, authDomain, projectId, storageBucket, senderId, appId) | valeurs de l'app Web du nouveau projet (ce sont les fallbacks actifs en prod) |
| `web/.env.example` | mêmes 6 valeurs | idem (doc) |
| `functions/lib/config.js:5` | `IMPORTS_BUCKET \|\| "nt360"` | nom du nouveau bucket |
| `functions/lib/config.js:9` | `FIRESTORE_DATABASE \|\| "nt360"` | **inchangé** |
| `functions/index.js` (fallback projectId de `scheduledFirestoreExport`) | `propulse-business-87f7a` | `<NEW_PROJECT_ID>` |
| `functions/scripts/reingest.js`, `seed/seed.js`, `seed/loadData.js` | fallback `propulse-business-87f7a` | `<NEW_PROJECT_ID>` |
| `web/src/modules/admin.tsx` (`CLICKUP_WEBHOOK_ENDPOINT` défaut) | URL `…propulse-business-87f7a…/clickupWebhook` | URL du nouveau projet |
| `.github/workflows/firebase-deploy.yml` (l.90 `PROJECT=`, l.136 `--project`) | `propulse-business-87f7a` | `<NEW_PROJECT_ID>` (ou `${{ vars.FIREBASE_PROJECT_ID }}`) |
| `.github/workflows/firebase-preview.yml`, `firebase-setup.yml`, `reingest.yml` | `--project` / `GCLOUD_PROJECT` | `<NEW_PROJECT_ID>` |
| `.github/workflows/smoke.yml` | `https://nt360.web.app` | nouvelle URL hosting |
| `docs/*` (README, ARCHITECTURE, RUNBOOK-GOLIVE, DISASTER-RECOVERY, ops-commands, app-check, ODOO_WEBHOOK, contrats/01-EXISTANT) | `propulse-business-87f7a`, `nt360.web.app`, URL Odoo | mise à jour documentaire |

`firestore.rules`, `storage.rules`, `firestore.indexes.json` : **portables tels quels** (aucune référence
projet). Recommandé : lire le projectId du workflow depuis `vars.FIREBASE_PROJECT_ID` (défaut = ancien) pour
une bascule/rollback par simple variable GitHub.

## Phase 2 — Secrets & variables GitHub

**Secrets** : `FIREBASE_SERVICE_ACCOUNT` (nouvelle clé JSON — **bloquant**), `APPCHECK_SITE_KEY` (nouvelle clé
reCAPTCHA), `RECOMPUTE_REGION=<NEW_REGION-compatible>` (sinon recompute synchrone — cf. audit #2),
`SEED_ADMIN_PASSWORD`, `SMOKE_*`.
**Variables** : `APPCHECK_ENFORCE` (laisser `false` jusqu'à ce que la clé reCAPTCHA soit déployée au client,
sinon tous les callables rejetés), `BACKUP_BUCKET=<NEW_PROJECT_ID>-backups`.
**Env functions** (`functions/.env`, écrit par le workflow) : `IMPORTS_BUCKET` = nouveau bucket,
`FIRESTORE_DATABASE` = inchangé (`nt360`), `INGEST_REGION`/`RECOMPUTE_REGION` = `<NEW_REGION>`.

## Phase 3 — Migration des données

1. **Firestore** (format LevelDB natif — préserve types Timestamp/reference ; **ne jamais** passer par un
   dump JSON intermédiaire) :
   ```
   gcloud firestore export gs://<ancien-bucket-export> --database=nt360 --project=propulse-business-87f7a
   gcloud firestore import gs://<nouveau-bucket-export> --database=nt360 --project=<NEW_PROJECT_ID>
   ```
   Importer dans une base **vierge** (l'import fusionne, ne remplace pas). Exporter **toutes** les collections
   (`collectionIds: []`) — en particulier `config/*` (voir risque 2 ci-dessous). Valider les comptages post-import.
2. **Storage** : `gcloud storage rsync -r gs://<ancien-bucket-imports> gs://<nouveau-bucket-imports>`.
   Vérifier la présence de `sync/sales_data.xlsx` (la feuille LIVE pipeline n'entre que par `syncSalesData`).
3. **Auth** : `firebase auth:export users.json --project=propulse-business-87f7a` puis
   `firebase auth:import users.json --project=<NEW_PROJECT_ID>` (**préserve les UID** + hash de mots de passe).
   **Les custom claims ne sont PAS exportés** → avant bascule, dumper `{uid → nt360Role}` depuis l'ancien
   projet (Admin SDK), puis re-poser via `seed/migrate-claims.js` sur le nouveau. Sans claim, chaque compte
   tombe sur « Compte en attente d'habilitation ».
4. **Recompute** : après import, purger `config/recomputeLock` (bail fantôme), puis lancer un `recompute`
   complet et comparer les chiffres de recette (invariant fort : parité summary backend ↔ re-dérivation front).

### Risques d'intégrité & parades

1. **Base nommée vs `(default)`** — importer/exporter **toujours** avec `--database=nt360` des deux côtés.
   Un import dans `(default)` = app vide (le code cible `nt360` en dur).
2. **Overlays `config/*` qui survivent aux ré-imports** — `fpAliases`, `orderCasOverride`,
   `cancelOrders`/`cancelInvoices`, `clickupSync`/`clickupLinks`, `clickupWebhook`/`odooWebhook` (secrets HMAC),
   `permissions`, `mntFeature`, `emailNotify`, `fxRates`, `projection`, seuils. **Non régénérés** par
   ré-ingestion → migrer intégralement la collection `config`, vérifier chaque doc critique.
3. **Auth UID + claims** — voir Phase 3.3. Les UID sont référencés partout (`permissions`, `visibleTo`,
   ownership OWD). Ne pas ré-enrôler (régénérerait les UID).
4. **Timestamps/references** — export/import natif uniquement.
5. **Import = fusion** — importer dans une base vierge ; valider d'abord sur une base `nt360-restore-test`.
6. **Sources d'ingestion** — recopier le bucket, puis `recompute` complet et comparer.
7. **Secrets non exportés** — `CLICKUP_TOKEN`, `ANTHROPIC_API_KEY`, `GRAPH_CLIENT_SECRET` : re-provisionner
   manuellement (Phase 0.7).
8. **Ordre App Check** — ne pas mettre `APPCHECK_ENFORCE=true` avant que la clé reCAPTCHA soit déployée au
   client (garde-fou CI présent, mais ne pas forcer).

## Phase 4 — Bascule

1. Poser les variables/secrets GitHub (Phase 2) sur les valeurs du nouveau projet.
2. Merger la PR de Phase 1 sur `main` → le workflow `firebase-deploy` déploie sur `<NEW_PROJECT_ID>`.
3. Vérifier : indexes composites déployés (`firestore.indexes.json`), `storage.rules` (déployable sur projet
   dédié si le bucket par défaut existe et le SA a le droit), schedulers recréés, App Check.

## Phase 5 — Couplages externes (post-déploiement — nouvelles URLs)

- **Webhook Odoo** : nouvelle URL Cloud Run de `odooWebhook` → mettre à jour l'Automated Action côté Odoo
  (`docs/ODOO_WEBHOOK.md`). Secret HMAC dans `config/odooWebhook` (migré avec les données).
- **Webhooks ClickUp** : ré-enregistrer le webhook (UI Habilitations → Intégration ClickUp → « Ré-enregistrer »)
  — recrée le webhook côté ClickUp + régénère le secret HMAC (`config/clickupWebhook`).
- **Microsoft Graph** : app registration Azure indépendante du projet GCP (flux client_credentials, pas de
  redirect URI) — seul le secret `GRAPH_CLIENT_SECRET` est à re-provisionner (fait en Phase 0.7).
- **API publique + clés API** : URL de l'endpoint change ; prévenir les consommateurs externes éventuels.
- **Cloud Monitoring** : recréer les policies d'alerting (`docs/monitoring-policies.md`) — non migrables.

## Phase 6 — Rollback

Repointer `vars.FIREBASE_PROJECT_ID` (et les secrets) sur `propulse-business-87f7a`, redéployer. Tant que
l'ancien projet n'est pas désactivé, le rollback est un simple changement de variables + push.
