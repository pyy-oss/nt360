# Runbook — Migration nt360 vers un projet Firebase dédié

> But : sortir nt360 du projet Firebase **partagé** `propulse-business-87f7a` vers un **projet dédié**
> (isolation, quota propre, rayon de panne réduit, sécurité). Opération planifiée avec **fenêtre de
> coupure courte** et **rollback** possible à chaque étape. **Additif jusqu'au cutover** : l'ancien projet
> reste intact et servant tant que le nouveau n'est pas validé.
>
> Statut : **brouillon à valider** avant exécution. Rien n'est exécuté sans un GO explicite par étape.

## 0. Ce que je fais vs ce que tu fais

- **Moi (Claude, dans ce dépôt)** : tous les changements **code/config versionnés** — `firebase.json`,
  `.firebaserc`, workflows GitHub Actions, docs, éventuels scripts de migration. Rien qui touche la prod
  directement.
- **Toi / l'ops (accès GCP + GitHub admin)** : création du projet, Secret Manager, variables/secrets
  Actions, export/import Firestore, Auth, buckets, enregistrement App Check, re-pointage des webhooks
  externes, DNS. Ces actions **ne sont pas faisables depuis cette session** (pas d'accès prod).

---

## 1. Décisions à prendre AVANT de commencer (⚠️ ne rien inventer)

| # | Décision | Défaut actuel (partagé) | À fixer |
|---|----------|-------------------------|---------|
| D1 | **ID du nouveau projet** GCP/Firebase | `propulse-business-87f7a` | `[À DÉCIDER]` (ex. `nt360-prod`) |
| D2 | **Région** des Functions + base Firestore | Functions `us-central1` ; base nommée `nt360` (région à confirmer console) | `[À DÉCIDER]` — Functions et base **co-localisées** (contrainte des triggers Firestore, cf. `RECOMPUTE_REGION`) |
| D3 | **Base Firestore** : garder le nom `nt360` ou passer en `(default)` | base **nommée** `nt360` | recommandé : garder `nt360` (zéro changement de code : `VITE_FIRESTORE_DB`, `firebase.json.firestore.database`) |
| D4 | **Site Hosting** + domaine | site `nt360` → `nt360.web.app` | `[À DÉCIDER]` — nouveau site + éventuel domaine personnalisé |
| D5 | **Fenêtre de coupure** (imports/écritures gelés le temps de l'export→import Firestore) | — | `[À DÉCIDER]` — créneau à faible activité |

> Tant que ces 5 points ne sont pas fixés, on ne lance pas la Phase 2.

---

## 2. Inventaire — l'état à recréer sur le nouveau projet

Ce qui **ne se déploie pas** depuis le dépôt et doit être **recréé/transféré** :

1. **Secrets Secret Manager** : `CLICKUP_TOKEN`, `ANTHROPIC_API_KEY`, `GRAPH_CLIENT_SECRET`,
   `APPCHECK_SITE_KEY` (secret Actions), compte de service `FIREBASE_SERVICE_ACCOUNT`.
2. **Variables/secrets GitHub Actions** (cf. `.github/workflows/firebase-deploy.yml`) :
   `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`,
   `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, `IMPORTS_BUCKET`,
   `BACKUP_BUCKET`, `APPCHECK_ENFORCE`, secrets `APPCHECK_SITE_KEY`, `FIREBASE_SERVICE_ACCOUNT`,
   `RECOMPUTE_REGION` (+ `INGEST_REGION` si utilisé).
3. **Données Firestore** (base `nt360`) : toutes les collections **+ les overlays de config qui
   survivent aux ré-imports** — `config/fpAliases`, `config/dcAliases`, `config/clientAliases`,
   `config/orderCasOverride`, `config/cancelOrders`, `config/cancelInvoices`, `config/clickupLinks`,
   `config/clickupSync`, `config/permissions`, `config/projection`, `config/fxRates`,
   `config/clientsRef`, `config/recomputeLock`, `config/odooWebhook` (**secret HMAC Odoo**),
   `config/clickup` (config + éventuel webhook), `config/emailNotify`, etc. **Ces docs portent des
   secrets et des décisions humaines : leur perte = ré-assainissement complet.**
4. **Firebase Auth** : comptes utilisateurs **+ custom claims `nt360Role`** (RBAC). Sans les claims, tous
   les callables sensibles refusent.
5. **Buckets Cloud Storage** : imports (`IMPORTS_BUCKET`, défaut `nt360`) + sauvegardes
   (`BACKUP_BUCKET`), avec leurs règles de rétention.
6. **App Check** : enregistrement reCAPTCHA v3 (nouvelle clé de site → nouveau secret `APPCHECK_SITE_KEY`).
7. **Webhooks externes entrants** (URLs Cloud Run à re-pointer côté systèmes tiers) :
   - **ClickUp** → `clickupWebhook` (signature HMAC).
   - **Odoo** → `odooWebhook` (signature HMAC-SHA256, secret dans `config/odooWebhook.secret`).
8. **Scheduled functions** (recréées au déploiement, mais vérifier l'**IAM** de
   `scheduledFirestoreExport` — droit d'export Firestore sur le bucket ; cf. incident IAM historique).
9. **IAM / rôles** du compte de service de déploiement sur le nouveau projet.

---

## 3. Séquence de migration (additive, cutover à la fin)

### Phase A — Préparer le nouveau projet (aucune coupure)
1. Créer le projet GCP/Firebase **D1**, activer Firestore (base **D3** en région **D2**), Cloud Functions,
   Hosting, Auth, App Check, Cloud Storage.
2. Créer les **buckets** (imports + backups) et leurs règles de rétention.
3. Poser les **secrets Secret Manager** (valeurs identiques à l'ancien projet, sauf `APPCHECK_SITE_KEY`
   qui dépend de la nouvelle clé reCAPTCHA — étape 5).
4. Créer un **compte de service de déploiement** + clé JSON ; lui donner les rôles nécessaires (Firebase
   Admin, Cloud Functions Admin, Service Account User, Firestore, Storage, Cloud Scheduler, App Engine
   Admin pour l'export). `FIREBASE_SERVICE_ACCOUNT` = cette clé.
5. **App Check** : enregistrer l'app web + reCAPTCHA v3 → nouvelle **clé de site** → secret Actions
   `APPCHECK_SITE_KEY`. Laisser `APPCHECK_ENFORCE=false` jusqu'à validation client complète.

### Phase B — Câblage dépôt (je le fais, PR dédiée)
6. `.firebaserc` / `firebase.json` : nouveau `projectId` (D1), site Hosting (D4), base Firestore (D3).
   Idéalement paramétrer par environnement pour garder l'ancien projet déployable en secours.
7. **Second jeu de variables/secrets GitHub Actions** pointant le nouveau projet (ou un workflow
   `firebase-deploy` paramétré par environnement). On **ne bascule pas** encore le workflow de prod.
8. Vérifs CI habituelles (`check-deploy-targets`, `check-no-undef`, `check-firestore-indexes`,
   `check-bundle`).

### Phase C — Déployer à blanc sur le nouveau projet (aucune coupure)
9. Déployer **rules + indexes + functions + hosting** sur le nouveau projet (workflow paramétré).
   Attendre les index Firestore (peut prendre du temps). Vérifier que les **202 fonctions** déployées
   correspondent à `deployed-functions.txt`.
10. **Smoke** sur l'URL du nouveau projet (`<nouveau>.web.app`) : login, lecture des summaries, un
    callable simple. À ce stade la base est **vide** (données à venir en Phase D).

### Phase D — Données (⚠️ fenêtre de coupure D5)
11. **Geler les écritures** sur l'ancien projet (communiquer aux utilisateurs ; désactiver les imports).
12. **Export Firestore** de la base `nt360` (ancien) → bucket, puis **import** dans la base du nouveau
    projet. Vérifier le **compte de documents** par collection (parité) et les **docs `config/*`** ci-dessus.
13. **Auth** : exporter les utilisateurs (`firebase auth:export`) → importer (`auth:import`) sur le
    nouveau projet, puis **ré-appliquer les custom claims `nt360Role`** (script Admin SDK — les claims ne
    sont pas dans l'export standard). **Vérifier** qu'un compte direction a bien son claim.
14. Lancer un **recompute complet** sur le nouveau projet et comparer quelques KPI (carnet, pipeline,
    couverture client) avec l'ancien → **parité des chiffres** avant cutover.

### Phase E — Webhooks + cutover (fin de coupure)
15. **Re-pointer les webhooks entrants** vers les nouvelles URLs Cloud Run :
    - ClickUp : nouvelle URL `clickupWebhook` (+ vérifier le secret HMAC).
    - Odoo : nouvelle URL `odooWebhook` (+ `config/odooWebhook.secret` bien présent dans les données
      importées, sinon régénérer côté Admin → Intégration et le reposer dans Odoo).
16. **Hosting / DNS** (D4) : basculer le domaine vers le nouveau site (ou communiquer la nouvelle URL).
17. **Dégeler les écritures**. Vérifier la checklist §4.
18. Basculer le **workflow de prod** GitHub Actions sur le nouveau projet (les pushes `main` déploient
    désormais le nouveau projet). Conserver l'ancien projet **en lecture** quelques jours (rollback).

---

## 4. Checklist de validation post-cutover

- [ ] Login OK ; un compte direction voit les modules gouvernés (claim `nt360Role` en place).
- [ ] **Callables répondent** (Centre d'activité `listActivities`, montant opp `syncOrderAmount`, etc.) —
      pas d'erreur CORS/`internal` (⇒ App Check cohérent, functions servantes).
- [ ] Summaries/KPI **identiques** à l'ancien (parité des chiffres) ; un recompute tourne sans erreur.
- [ ] Overlays présents : alias FP/DC/clients, overrides CAS, annulations, liens ClickUp.
- [ ] **Webhook ClickUp** : une modif ClickUp remonte (Admin → Intégration « dernier envoi reçu »).
- [ ] **Webhook Odoo** : un BC/partner Odoo arrive (signature HMAC acceptée).
- [ ] Scheduled functions planifiées ; `scheduledFirestoreExport` a le **droit IAM** d'exporter.
- [ ] App Check : si `APPCHECK_ENFORCE=true`, le client a bien `VITE_APPCHECK_SITE_KEY` (sinon rejets).
- [ ] Emails (Microsoft Graph) : `GRAPH_CLIENT_SECRET` posé ; un digest de test part (ou reste inactif si
      `config/emailNotify` non renseignée — comportement voulu).

## 5. Rollback

Tant que le **DNS/URL** et le **workflow de prod** n'ont pas basculé (étapes 16/18), l'ancien projet reste
la prod : rollback = **ne pas basculer**. Après bascule, rollback = re-pointer DNS + webhooks vers l'ancien
projet (resté servant et en lecture) et re-geler le nouveau. **Ne pas supprimer l'ancien projet avant
plusieurs jours de fonctionnement validé du nouveau.**

## 6. Pièges spécifiques nt360 (déjà rencontrés)

- **App Check enforce sans clé client** → tous les callables rejetés (erreur perçue comme « CORS »). Garder
  `APPCHECK_ENFORCE=false` jusqu'à ce que `APPCHECK_SITE_KEY` soit déployé et validé (cf. garde-fou du
  workflow `firebase-deploy.yml`).
- **Flakiness de déploiement Functions** (`Failed to update function …`) : sur ~202 fonctions, des échecs
  transitoires arrivent — **re-lancer le déploiement** plutôt que de conclure à un bug.
- **Région base ↔ triggers** : `onRecomputeRequest` et les triggers Firestore doivent tourner dans une
  région **compatible** avec la base `nt360` (`RECOMPUTE_REGION`). Mauvaise région = trigger non déployé.
- **Custom claims non exportés** : `firebase auth:export` ne porte pas `nt360Role` → script de ré-application
  obligatoire, sinon RBAC bloqué pour tous.
- **Secrets dans Firestore** : `config/odooWebhook.secret` et la config ClickUp voyagent avec les données ;
  s'ils manquent après import, les webhooks refusent (HMAC) → régénérer via Admin → Intégration.

---

*Ce runbook est un plan, pas une exécution. À valider point par point ; j'exécute la partie versionnée
(Phase B, câblage workflow), tu exécutes la partie GCP/prod.*
