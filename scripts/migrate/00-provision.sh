#!/usr/bin/env bash
# Provisionnement du projet dédié neurones-360 (migration, cf. docs/MIGRATION_PROJET.md).
# IDEMPOTENT : relançable sans risque (les bindings IAM et les secrets existants sont des no-op).
# À exécuter par un opérateur OWNER du projet (gcloud auth login). Ne touche PAS l'ancien projet.
#
#   bash scripts/migrate/00-provision.sh
#
# Renseigne DEPLOY_SA (email du SA de FIREBASE_SERVICE_ACCOUNT_V2) et BILLING_ACCOUNT_ID ci-dessous.
set -euo pipefail

# ------------------------------------------------------------------ constantes (adapter les 2 REMPLACE)
PROJECT="neurones-360"
REGION="europe-west1"
DB="nt360"
PROJECT_NUMBER="165643317476"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
DEPLOY_SA="firebase-adminsdk-fbsvc@neurones-360.iam.gserviceaccount.com"   # SA de déploiement (FIREBASE_SERVICE_ACCOUNT_V2)
BILLING_ACCOUNT_ID="018171-3E5BE8-C81AFD"                       # `gcloud billing accounts list`
IMPORTS_BUCKET="neurones-360-imports"
BACKUP_BUCKET="neurones-360-backups"

gcloud config set project "$PROJECT"

# ------------------------------------------------------------------ 0. facturation + APIs
echo "== Facturation Blaze =="
gcloud billing projects link "$PROJECT" --billing-account="$BILLING_ACCOUNT_ID" || true

echo "== APIs (functions gen2 = run + eventarc + build + artifactregistry + pubsub) =="
gcloud services enable \
  cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com eventarc.googleapis.com pubsub.googleapis.com \
  firestore.googleapis.com firebasehosting.googleapis.com firebaserules.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com storage.googleapis.com \
  --project "$PROJECT"

# ------------------------------------------------------------------ 1. Firestore PITR (base déjà créée)
echo "== PITR =="
gcloud firestore databases update --database="$DB" --enable-pitr --project "$PROJECT" || true

# ------------------------------------------------------------------ 2. buckets
echo "== Buckets =="
gcloud storage buckets describe "gs://${IMPORTS_BUCKET}" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://${IMPORTS_BUCKET}" --location="$REGION" --uniform-bucket-level-access --project "$PROJECT"
gcloud storage buckets describe "gs://${BACKUP_BUCKET}" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://${BACKUP_BUCKET}" --location="$REGION" --uniform-bucket-level-access --project "$PROJECT"
gcloud storage buckets update "gs://${BACKUP_BUCKET}" --versioning
printf '{ "rule": [ { "action": {"type":"Delete"}, "condition": {"age":90} } ] }' > /tmp/nt360-lifecycle.json
gcloud storage buckets update "gs://${BACKUP_BUCKET}" --lifecycle-file=/tmp/nt360-lifecycle.json

# ------------------------------------------------------------------ 3. Secret Manager (placeholders OK)
echo "== Secrets (placeholders inertes ; poser les vraies valeurs ensuite) =="
for S in CLICKUP_TOKEN ANTHROPIC_API_KEY GRAPH_CLIENT_SECRET; do
  if ! gcloud secrets describe "$S" --project "$PROJECT" >/dev/null 2>&1; then
    printf 'UNSET' | gcloud secrets create "$S" --data-file=- --replication-policy=automatic --project "$PROJECT"
  fi
done

# ------------------------------------------------------------------ 4A. IAM — SA de déploiement
echo "== IAM SA de déploiement =="
for ROLE in \
  roles/firebase.admin roles/cloudfunctions.admin roles/run.admin \
  roles/cloudbuild.builds.editor roles/artifactregistry.admin roles/eventarc.admin \
  roles/pubsub.admin roles/cloudscheduler.admin roles/secretmanager.admin \
  roles/iam.serviceAccountUser roles/datastore.importExportAdmin roles/serviceusage.serviceUsageConsumer ; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${DEPLOY_SA}" --role="$ROLE" --condition=None >/dev/null
done

# ------------------------------------------------------------------ 4B. IAM — SA Compute (runtime + build gen2)
# PIÈGE des projets récents : le SA Compute ne reçoit PLUS Editor par défaut → sans ces rôles, les functions
# ne se buildent pas, ne lisent pas Firestore, ni les secrets. On corrige d'entrée (évite les allers-retours).
echo "== IAM SA Compute (runtime + build) =="
for ROLE in \
  roles/datastore.user roles/secretmanager.secretAccessor \
  roles/cloudbuild.builds.builder roles/artifactregistry.writer \
  roles/storage.objectAdmin roles/logging.logWriter \
  roles/eventarc.eventReceiver roles/datastore.importExportAdmin ; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${RUNTIME_SA}" --role="$ROLE" --condition=None >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://${BACKUP_BUCKET}" --member="serviceAccount:${RUNTIME_SA}" --role="roles/storage.admin" >/dev/null

# ------------------------------------------------------------------ 4C. Agents de service (Eventarc/Pub-Sub)
echo "== Agents de service =="
gcloud beta services identity create --service=eventarc.googleapis.com --project "$PROJECT" || true
gcloud beta services identity create --service=pubsub.googleapis.com   --project "$PROJECT" || true
PUBSUB_AGENT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${PUBSUB_AGENT}" --role="roles/iam.serviceAccountTokenCreator" --condition=None >/dev/null || true

echo
echo "✅ Provisionnement terminé. Vérif des rôles :"
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" --filter="bindings.members:${DEPLOY_SA}" --format="value(bindings.role)" | sort
echo "--- runtime ---"
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" --filter="bindings.members:${RUNTIME_SA}" --format="value(bindings.role)" | sort
echo
echo "Prochaine étape : lancer le workflow « Firebase Deploy V2 » (Actions → Run workflow), input imports_bucket=${IMPORTS_BUCKET}."
