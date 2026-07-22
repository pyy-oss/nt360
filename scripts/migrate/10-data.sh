#!/usr/bin/env bash
# Migration des DONNÉES ancien → nouveau projet (Firestore + Storage + Auth). cf. docs/MIGRATION_PROJET.md Phase 3.
# Firestore : format NATIF (LevelDB) — JAMAIS de dump JSON (préserve Timestamp/reference). `--database=nt360`
# EN DUR des deux côtés : importer dans (default) = app vide, on ferme cette porte.
# À exécuter après un déploiement V2 réussi. Idempotent côté export/rsync ; l'import Firestore FUSIONNE
# (importer dans une base fraîche).
#
#   bash scripts/migrate/10-data.sh
set -euo pipefail

OLD="propulse-business-87f7a"
NEW="neurones-360"
DB="nt360"
DATE="$(date +%F-%H%M)"
OLD_EXPORT_BUCKET="gs://${OLD}-fs-export"        # bucket d'export côté ancien projet (créer si absent)
NEW_IMPORT_PREFIX="gs://neurones-360-imports/fs-import/${DATE}"
OLD_STORAGE_BUCKET="gs://nt360"                  # bucket d'imports/sources côté ancien (cf. ops-commands.md)
NEW_STORAGE_BUCKET="gs://neurones-360-imports"

# ------------------------------------------------------------------ 1. Firestore : export → copie → import
echo "== Export Firestore (ancien projet, base ${DB}) =="
gcloud storage buckets describe "$OLD_EXPORT_BUCKET" >/dev/null 2>&1 \
  || gcloud storage buckets create "$OLD_EXPORT_BUCKET" --location=eu --uniform-bucket-level-access --project "$OLD"
# collectionIds vide (défaut) = TOUTES les collections, dont config/* (overlays + secrets HMAC webhooks).
gcloud firestore export "${OLD_EXPORT_BUCKET}/${DATE}" --database="$DB" --project "$OLD"

echo "== Copie inter-projets de l'export =="
gcloud storage cp -r "${OLD_EXPORT_BUCKET}/${DATE}" "${NEW_IMPORT_PREFIX}"

echo "== Import Firestore (nouveau projet, base ${DB}) =="
# NB : la structure d'un export gcloud place le manifeste dans le sous-dossier daté.
gcloud firestore import "${NEW_IMPORT_PREFIX}/${DATE}" --database="$DB" --project "$NEW"

# ------------------------------------------------------------------ 2. Storage (sources d'ingestion)
echo "== Rsync Storage (sources) =="
gcloud storage rsync -r "$OLD_STORAGE_BUCKET" "$NEW_STORAGE_BUCKET" || true
echo "   → vérifier la présence de sync/sales_data.xlsx dans ${NEW_STORAGE_BUCKET}"

# ------------------------------------------------------------------ 3. Auth (UID + hash mots de passe)
echo "== Auth export/import =="
firebase auth:export /tmp/nt360-users.json --project "$OLD"
# ⚠️ L'import des HASH exige les paramètres de hachage du projet SOURCE :
#    console ANCIEN projet → Authentication → ⋮ → « Paramètres de hachage du mot de passe ».
#    Remplacer les 4 valeurs ci-dessous, PUIS décommenter :
# firebase auth:import /tmp/nt360-users.json --project "$NEW" \
#   --hash-algo=SCRYPT --hash-key='CLE_BASE64' --salt-separator='SEP_BASE64' --rounds=8 --mem-cost=14

echo
echo "✅ Données Firestore + Storage migrées."
echo "   Reste : (1) décommenter/compléter l'import Auth ci-dessus,"
echo "           (2) transférer les claims  → GOOGLE_APPLICATION_CREDENTIALS_OLD/_NEW node seed/migrate-claims-cross.js,"
echo "           (3) recompute + parité      → bash scripts/migrate/20-verify.sh (après recompute)."
