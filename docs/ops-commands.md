# Fiche de commandes ops — go-live nt360

Commandes concrètes pour les actions d'infrastructure du `RUNBOOK-GOLIVE.md`. À exécuter par un
opérateur disposant des droits sur le projet GCP. **Rien ici n'est automatisé par l'app** — ce sont des
opérations manuelles, une fois.

**Constantes** (déjà câblées dans le code / la CI) :

```bash
PROJECT=propulse-business-87f7a     # projet Firebase PARTAGÉ
DB=nt360                            # base Firestore NOMMÉE (pas (default))
IMPORTS_BUCKET=gs://nt360           # bucket imports + exports générés
BACKUP_BUCKET_NAME=nt360-backups    # bucket de SAUVEGARDE dédié (à créer)
gcloud config set project "$PROJECT"
```

> Le **compte de service runtime** des Cloud Functions gen2 est, par défaut, le SA Compute :
> `PROJECT_NUMBER-compute@developer.gserviceaccount.com`. Récupère le numéro de projet :
> ```bash
> PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
> RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
> echo "$RUNTIME_SA"
> ```
> Si tu as configuré un SA dédié pour les functions, remplace `RUNTIME_SA` par le sien.

---

## 1. Secrets Secret Manager (prérequis au déploiement)

Le déploiement échoue si `CLICKUP_TOKEN` / `ANTHROPIC_API_KEY` n'existent pas (déclarés via `defineSecret`).

```bash
# Vérifier l'existence
gcloud secrets describe CLICKUP_TOKEN    --project "$PROJECT" >/dev/null 2>&1 && echo "CLICKUP_TOKEN OK"      || echo "MANQUANT: CLICKUP_TOKEN"
gcloud secrets describe ANTHROPIC_API_KEY --project "$PROJECT" >/dev/null 2>&1 && echo "ANTHROPIC_API_KEY OK" || echo "MANQUANT: ANTHROPIC_API_KEY"

# Créer + poser une valeur (placeholder accepté pour Anthropic : la curation veille no-op proprement)
printf 'VOTRE_TOKEN_CLICKUP' | gcloud secrets create CLICKUP_TOKEN    --data-file=- --replication-policy=automatic 2>/dev/null \
  || printf 'VOTRE_TOKEN_CLICKUP' | gcloud secrets versions add CLICKUP_TOKEN --data-file=-
printf 'sk-ant-VOTRE_CLE'       | gcloud secrets create ANTHROPIC_API_KEY --data-file=- --replication-policy=automatic 2>/dev/null \
  || printf 'sk-ant-VOTRE_CLE'   | gcloud secrets versions add ANTHROPIC_API_KEY --data-file=-
```

---

## 2. Bucket de sauvegarde dédié + IAM

```bash
# Créer le bucket (région : aligne sur ta base ; eur ou une région proche des utilisateurs CI)
gcloud storage buckets create "gs://${BACKUP_BUCKET_NAME}" --location=EUR --uniform-bucket-level-access

# Rétention 90 j + versioning (protège des écrasements)
gcloud storage buckets update "gs://${BACKUP_BUCKET_NAME}" --versioning
cat > /tmp/lifecycle.json <<'JSON'
{ "rule": [ { "action": {"type":"Delete"}, "condition": {"age":90} } ] }
JSON
gcloud storage buckets update "gs://${BACKUP_BUCKET_NAME}" --lifecycle-file=/tmp/lifecycle.json

# Droits du SA runtime : export Firestore (projet) + écriture bucket
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/datastore.importExportAdmin"
gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET_NAME}" \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/storage.admin"
```

Puis **poser la variable de dépôt GitHub** `BACKUP_BUCKET=nt360-backups`
(Settings → Secrets and variables → Actions → Variables) et **redéployer** (push sur `main`), pour que
`functions/.env` porte `BACKUP_BUCKET`. Vérifier ensuite via un export forcé (voir §4) que `opsLog`
affiche `dedicated:true`.

---

## 3. PITR (Point-in-Time Recovery, fenêtre 7 j)

```bash
gcloud firestore databases update --database="$DB" --enable-pitr --project "$PROJECT"
gcloud firestore databases describe --database="$DB" --format='value(pointInTimeRecoveryEnablement)'
```

---

## 4. Vérifier la sauvegarde + tester la RESTAURATION (obligatoire avant go-live)

```bash
# Forcer l'export planifié (au lieu d'attendre dimanche 03:00)
gcloud scheduler jobs list --location=us-central1 | grep -i firestoreExport   # trouver le nom exact
gcloud scheduler jobs run <NOM_DU_JOB_EXPORT> --location=us-central1
# → puis contrôler dans l'app (Admin ▸ Exploitation) ou Firestore: opsLog le dernier { action:"backup", status:"ok", dedicated:true }

# Test de restauration À BLANC vers une base JETABLE (ne jamais restaurer sur nt360 en prod)
gcloud firestore databases create --database=nt360-restore-test --location=eur3 --type=firestore-native
gcloud firestore import "gs://${BACKUP_BUCKET_NAME}/backups/<DATE_DOSSIER>" --database=nt360-restore-test
# Vérifier quelques collections, puis supprimer la base de test :
gcloud firestore databases delete --database=nt360-restore-test
```

---

## 5. Migration des claims (si des comptes existent déjà)

Renomme le custom claim `role` → `nt360Role` (namespacé — projet partagé). À lancer avec un compte de
service Admin. Sur une base fraîche (seed au go-live), inutile : le seed pose déjà `nt360Role`.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/sa.json
node seed/migrate-claims.js --dry-run     # aperçu
node seed/migrate-claims.js               # applique
```

---

## 6. App Check (2 temps — détail dans docs/app-check.md)

1. **J-7** : créer une clé **reCAPTCHA v3**, enregistrer l'app Web dans la console Firebase (App Check),
   poser le secret GitHub `APPCHECK_SITE_KEY`, redéployer, puis **observer** les métriques « vérifié /
   non vérifié » quelques jours. `APPCHECK_ENFORCE` reste `false`.
2. **J+7** : quand la majorité du trafic est « vérifié », poser la variable de dépôt `APPCHECK_ENFORCE=true`,
   redéployer, activer l'enforcement en console. Garder la procédure de rollback (repasser la variable à
   `false` + redeploy) sous la main.

---

## 7. Alerting sur l'échec des jobs planifiés

Les jobs (`scheduledRecompute` 05:00, `syncSalesData` 06:00, `scheduledFirestoreExport` dim. 03:00,
pulls ClickUp) ne notifient personne en cas d'échec — seul `opsLog` en garde trace. Créer une **log-based
alert** GCP :

```bash
# Canal de notification (email) — récupère/crée-le une fois
gcloud beta monitoring channels create --display-name="Ops nt360" \
  --type=email --channel-labels=email_address=ops@neurones.example

# Politique : erreurs des Cloud Functions nt360 (filtre à ajuster à tes noms de fonctions)
# Le plus simple en console : Monitoring ▸ Alerting ▸ Create policy ▸ Log-based, filtre :
#   resource.type="cloud_run_revision" severity>=ERROR
#   (les functions gen2 tournent sur Cloud Run)
# + un filtre budget facturation (Billing ▸ Budgets & alerts).
```

Complément applicatif déjà en place : configurer le **webhook Slack/Teams** dans l'UI Habilitations
(`setNotificationConfig`, `enabled:true`) — il pousse les crashs de callables et le digest d'alertes 07:00.

---

## 8. Smoke tests post-deploy (comptes de test)

`smoke.yml` teste chargement + login + confidentialité de la marge, mais **saute** les tests d'auth sans
les secrets. Créer **2 comptes de test** (un avec droit Rentabilité, un sans — **sans MFA**) et poser les
secrets GitHub `SMOKE_MARGIN_EMAIL/PASSWORD` et `SMOKE_NOMARGIN_EMAIL/PASSWORD`, puis lancer le workflow
`smoke.yml` manuellement sur https://nt360.web.app.

---

## 9. Attribution des rôles aux utilisateurs

Se fait **dans l'app** (Admin ▸ Habilitations, direction-only) : `Créer un compte` (email + mot de passe
+ rôle) ou `Rattacher` un compte Firebase existant. Rappels :
- Rôle = custom claim `nt360Role` → **reconnexion requise** après changement (ou bouton « Actualiser mes
  droits » de l'écran d'attente).
- Grille recommandée : PDG + CFO → `direction` ; COO/DGA → `lecture` ; Directeur Commercial →
  `commercial_dir` ; Commerciaux → `commercial` ; PM → `pmo` ; Assistantes → `assistante` ; acheteur →
  `achats`. Ajuster ensuite la matrice via Habilitations selon les 3 décisions CODIR du runbook.
- Enrôler la **MFA (TOTP)** au moins pour `direction` / `achats` / `assistante`.
