# Runbook go-live — nt360 (Neurones Technologies CI)

Projet Firebase **partagé** `propulse-business-87f7a`, base Firestore **nommée** `nt360` (pas `(default)`),
site Hosting dédié `nt360`, bucket `gs://nt360`. Déploiement **scopé par nom** (CI `firebase-deploy.yml`).

Public : CODIR (PDG, COO, CFO, DGA), Directeur Commercial, Commerciaux, Project Managers, Assistantes
Commerciales. Ce document consolide la remédiation de l'audit pré-production et la procédure de mise en
production. Il complète `docs/app-check.md` et `docs/clickup-webhooks.md`.

---

## 1. Rôles & habilitations

7 rôles (`functions/domain/authz.js` = `functions/index.js` = `web/src/lib/rbac.tsx`, matrice par défaut
`seed/permissions.json`) :

| Rôle | Pour qui | Accès notables (matrice par défaut) |
|---|---|---|
| `direction` | **PDG + CFO uniquement** (recommandé) | write partout (court-circuite la matrice) |
| `commercial_dir` | Directeur Commercial | pipeline write, objectifs **read**, facturation read, rentabilité read, import write |
| `commercial` | Commerciaux | pipeline write, clients read ; **pas de marge**, pas de facturation par défaut |
| `pmo` | Project Managers | backlog/BC/P&L projet write, rentabilité **read** |
| `achats` | Acheteur / data steward | fournisseurs/BC write, import write |
| `assistante` | **Assistantes Commerciales** | facturation **write**, BC write, overview/clients read ; **aucune marge** |
| `lecture` | Consultation (membres CODIR non PDG/CFO) | read partout **y compris marge**, zéro write |

**Attribution** = custom claim `nt360Role` (namespacé — projet partagé). Se fait via l'UI Habilitations
(`createUser`/`setUserRole`, direction-only) ou le seed. **Un changement de rôle exige une reconnexion**
(ou le bouton « Actualiser mes droits » de l'écran d'attente). L'écran « Compte en attente d'habilitation »
guide un nouvel utilisateur sans rôle.

### Décisions CODIR à trancher (pas de code — ajuster la matrice via Habilitations)
1. **Marge visible aux Project Managers ?** Par défaut `pmo.rentabilite = read` → chaque PM voit la marge
   de **toute l'entreprise** (pas seulement ses projets — le cloisonnement est par module, pas par
   périmètre). Si non souhaité : passer `pmo.rentabilite → none`.
2. **Commerciaux et facturation ?** Par défaut `commercial.facturation = none` → l'onglet Relances est vide
   pour eux (ils ne peuvent pas relancer leurs clients). Si souhaité : `commercial.facturation → read`.
3. **Rôle `direction`** : à réserver à **PDG + CFO**. Les autres membres du CODIR (COO, DGA) en `lecture`
   (consultation complète, y compris marge, sans write destructif). Évite qu'une consultation déclenche par
   erreur une suppression / un import / une dé-duplication.

---

## 2. Déploiement

- Les fonctions déployées sont la **source unique** `functions/deployed-functions.txt` (lue par le workflow
  ET vérifiée en CI par `functions/scripts/check-deploy-targets.mjs`). **Toute nouvelle fonction doit y être
  ajoutée** — sinon la CI échoue avant le merge (plus de fonction « morte en prod »).
- Exclusions volontaires (triggers env-gated, activés manuellement) : `ingest` (`INGEST_REGION`),
  `onRecomputeRequest` (`RECOMPUTE_REGION`).
- Storage rules : **volontairement hors** du `--only` (403 au déploiement tant que le bucket par défaut +
  le droit SA ne sont pas provisionnés). Le front n'utilise pas le SDK Storage → dette assumée.

### Variables d'environnement (functions)
| Variable | Statut | Valeur prod | Si absente |
|---|---|---|---|
| `IMPORTS_BUCKET` | opt (déf. `nt360`) | `nt360` | repli codé, OK |
| `FIRESTORE_DATABASE` | opt (déf. `nt360`) | ne pas définir | OK |
| `BACKUP_BUCKET` | **recommandée** | `nt360-backups` | sauvegardes dans le bucket d'imports (blast-radius partagé) |
| `APPCHECK_ENFORCE` | opt-in | `false` → `true` à J+7 | pas d'enforcement |
| `INGEST_REGION` | opt-in | vide (ingestion via importDelta) | pas de trigger Storage |
| `RECOMPUTE_REGION` | opt-in | région de la base `nt360` **si** on veut le recompute différé | recompute **synchrone** (latence des mutations) |

Secrets Secret Manager (`defineSecret`) — **doivent exister au déploiement** : `CLICKUP_TOKEN`,
`ANTHROPIC_API_KEY` (placeholder accepté ; la curation veille no-op proprement si vide).

---

## 3. Jobs planifiés (UTC = heure locale CI)
`scheduledClickupPull` 04:30 · `scheduledBcPull` 04:45 · `scheduledRecompute` 05:00 ·
`scheduledClickupEnrich` 05:00 · `curateNews` 05:30 · `syncSalesData` 06:00 · `alertDigest` 07:00 ·
`scheduledFirestoreExport` dimanche 03:00.

**La feuille LIVE (pipeline) ne s'importe QUE par la synchro Sales_DATA** (`sync/sales_data.xlsx`, job 06:00
+ bouton « Forcer la synchro ») : les canaux delta/ingest/reingest ignorent désormais la feuille LIVE (sinon
une opp sans N° FP dont la « D Prev » bouge se dupliquait). **Alimenter `sync/sales_data.xlsx`** avec le
classeur d'inventaire pour que les opportunités se mettent à jour (staling des fantômes inclus).

---

## 4. Sauvegardes & restauration
- Créer un bucket **dédié** `gs://nt360-backups` (rétention 90 j + versioning), accorder au SA runtime des
  functions `roles/datastore.importExportAdmin` (projet) + `roles/storage.admin` (bucket), poser la variable
  de dépôt `BACKUP_BUCKET=nt360-backups`.
- **Activer PITR** sur la base : `gcloud firestore databases update --database=nt360 --enable-pitr`.
- **Tester la restauration** à blanc (obligatoire avant go-live) :
  `gcloud firestore import gs://nt360-backups/backups/<date> --database=<base-de-test>`.
- Vérifier après un export forcé (Cloud Scheduler « Force run ») que `opsLog` porte `status:ok, dedicated:true`.

---

## 5. Monitoring & alerting
Existant : `opsLog` (recomputes/jobs), `errorLog` (erreurs client, désormais **plafonné à 30/min/compte**),
webhook Slack/Teams sur crash de callable + digest d'alertes 07:00, cartes Admin « Exploitation »/« Erreurs ».
**À ajouter (console GCP)** : policy Cloud Monitoring sur `severity=ERROR` des fonctions (au moins
`scheduledRecompute`, `scheduledFirestoreExport`, `syncSalesData`, `clickupWebhook`) + alerte budget
facturation. Les échecs de **jobs planifiés** ne sont sinon pas notifiés.

---

## 6. App Check (2 temps — cf. `docs/app-check.md`)
J-7 : clé reCAPTCHA v3, enregistrement console, secret GitHub `APPCHECK_SITE_KEY`, redeploy, observation des
métriques. J+7 : variable `APPCHECK_ENFORCE=true` + redeploy + enforcement console (garder la procédure de
rollback sous la main).

---

## 7. Dette technique documentée (correctifs de suivi, non bloquants)
- **`xlsx@0.18.5` (CVE prototype-pollution / ReDoS)** : la version patchée (≥ 0.20.2) n'est pas sur npm
  (plafonné à 0.18.5) mais sur le **CDN SheetJS**. Quand l'environnement de build peut l'atteindre, épingler
  `xlsx` sur `https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz` (drop-in, même API). Exposition atténuée :
  l'import est gated derrière un rôle `write`.
- **Injection de `config/fxRates` dans l'ingestion** (conversion auto USD/GBP des BC) : le parseur logistics
  est pur (sans accès Firestore). À porter au niveau du handler d'ingestion. Non bloquant : la parité EUR
  fixe + la saisie manuelle (désormais **préservée** au ré-import) couvrent le besoin.
- **Isolation des fuites inter-modules `atterrissage_*` (objectif/écart) et `trends` (AR/DSO)** : ces deux
  summaries sont mappés `overview` mais portent des champs d'autres modules (objectifs annuels ; encours/DSO)
  → un `commercial` peut les lire. À isoler dans des docs dédiés (`atterrissageObjectifs_*` → `objectifs`,
  `trendsFacturation` → `facturation`). Sévérité MOYENNE (la **marge**, elle, est correctement cloisonnée).
- **MFA** : disponible (TOTP) mais facultative. La forcer pour `direction`/`achats`/`assistante` est recommandé
  pour un cockpit financier.

---

## 8. Checklist ordonnée

### J-7 — préparer
- [ ] Secret Manager : `CLICKUP_TOKEN` + `ANTHROPIC_API_KEY` présents.
- [ ] Créer `gs://nt360-backups` + IAM SA + variable `BACKUP_BUCKET` ; **activer PITR** sur `nt360`.
- [ ] Pousser sur `main` → deploy vert → **forcer un export** → vérifier `opsLog` (`dedicated:true`).
- [ ] **Test de restauration à blanc** documenté.
- [ ] App Check étape 1 (clé + secret + observation).
- [ ] Console : Email/Password activé, plan Blaze, MFA TOTP activée.
- [ ] Alerting GCP (severity=ERROR des jobs + budget) + destinataire.
- [ ] Migration des claims si comptes préexistants : `GOOGLE_APPLICATION_CREDENTIALS=… node seed/migrate-claims.js`
      (renomme `role` → `nt360Role`).

### J-1 — amorcer
- [ ] Seed base vide (workflow Firebase Setup) → `config/permissions` (7 rôles) + 1er admin `direction`.
- [ ] Charger les données réelles ; vérifier `imports`/`opsLog` + chiffres de recette.
- [ ] Recompute manuel → bandeau « Données à jour ».
- [ ] Créer les utilisateurs (UI Admin) + rôles ; **enrôler la MFA** ; trancher les 3 décisions CODIR (§1).
- [ ] Saisir objectifs, seuils, taux FX, référentiels, alias clients.
- [ ] ClickUp : `clickupHealth` puis activer le temps réel (cf. `docs/clickup-webhooks.md`).
- [ ] Comptes smoke + secrets `SMOKE_*` → `smoke.yml` vert (dont tests de marge).

### Jour J
- [ ] Push final → deploy vert → smoke vert.
- [ ] Vérif croisée 3 rôles (`direction`, `commercial`, `lecture`) : confidentialité marge, 13 modules OK,
      saisie d'une opportunité + recompute visible.
- [ ] Surveiller Admin « Exploitation »/« Erreurs » + Cloud Logging.
- [ ] Communiquer aux utilisateurs (URL, 1re connexion, enrôlement MFA, contact incident).

### J+7 — durcir
- [ ] Vérifier le 1er cycle complet des jobs (pulls, recompute, sync, digest, export dominical).
- [ ] App Check étape 2 : `APPCHECK_ENFORCE=true` + redeploy + enforcement.
- [ ] Purger le bruit `errorLog`/`opsLog` de démarrage ; ajuster les seuils.
- [ ] Planifier la dette du §7 (pin xlsx, fxRates ingestion, isolation objectifs/DSO, MFA forcée, TTL des
      journaux `oppHistory`/`auditLog`/`opsLog`/`errorLog`/`imports`).
