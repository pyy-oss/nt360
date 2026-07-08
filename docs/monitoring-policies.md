# Policies de monitoring & alerting — nt360

Alertes GCP à provisionner avant le go-live (cf. `RUNBOOK-GOLIVE.md` §5). Aucune n'est automatisée par
l'app — à créer une fois par un opérateur. Les Cloud Functions gen2 s'exécutent sur **Cloud Run**
(`resource.type="cloud_run_revision"`).

```bash
PROJECT=propulse-business-87f7a
gcloud config set project "$PROJECT"
```

## 1. Canal de notification (email)

```bash
gcloud beta monitoring channels create \
  --display-name="Ops nt360" \
  --type=email \
  --channel-labels=email_address=ops@neurones.example
# Récupérer son id pour les policies :
CHANNEL=$(gcloud beta monitoring channels list --filter='displayName="Ops nt360"' --format='value(name)')
echo "$CHANNEL"
```

## 2. Alerte — toute erreur (severity=ERROR) des Cloud Functions nt360

Couvre les échecs de callables ET de jobs planifiés (recompute 05:00, syncSalesData 06:00, export
dominical, pulls ClickUp) qui, sinon, ne notifient personne (seul `opsLog` en garde trace).

`policy-functions-errors.json` :

Le filtre est **scopé d'emblée aux services nt360** (le projet est PARTAGÉ — un filtre projet-large
capterait aussi l'app sœur et mal-attribuerait les alertes). On vise les fonctions non surveillées (jobs
planifiés + webhook) dont l'échec doit remonter ; les erreurs de callables sont déjà notifiées par le
webhook applicatif (§6). Noms de service Cloud Run = noms de fonction **en minuscules**.

`policy-functions-errors.json` :

```json
{
  "displayName": "nt360 — erreurs Cloud Functions (jobs & webhook)",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Logs severity=ERROR (services nt360 non surveillés)",
      "conditionMatchedLog": {
        "filter": "resource.type=\"cloud_run_revision\" AND severity>=ERROR AND resource.labels.service_name=~\"^(scheduledrecompute|syncsalesdata|scheduledfirestoreexport|scheduledclickuppull|scheduledbcpull|scheduledclickupenrich|curatenews|alertdigest|clickupwebhook)$\""
      }
    }
  ],
  "alertStrategy": {
    "notificationRateLimit": { "period": "300s" }
  },
  "notificationChannels": ["CHANNEL_ID_ICI"]
}
```

```bash
sed "s#CHANNEL_ID_ICI#${CHANNEL}#" policy-functions-errors.json > /tmp/pol1.json
gcloud alpha monitoring policies create --policy-from-file=/tmp/pol1.json
```

> Élargir si besoin : ajouter des `service_name` à la liste. Ne **PAS** passer à un filtre projet-large
> (`severity>=ERROR` sans `service_name`) tant qu'une autre app partage le projet — bruit + mauvaise attribution.

## 3. Alerte — échec spécifique du recompute nocturne (log-based metric ciblée)

Le recompute 05:00 (`scheduledRecompute`) est le cœur : s'il échoue, tous les chiffres du matin sont
périmés. Alerte dédiée sur son log d'échec (l'app journalise `opsLog { action:"scheduledRecompute",
status:"error" }` mais Cloud Logging voit aussi le `logger.error`).

```bash
gcloud logging metrics create nt360_recompute_fail \
  --description="Échecs du recompute planifié nt360" \
  --log-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="scheduledrecompute" AND severity>=ERROR'
# Puis créer une policy « > 0 sur 1 h » sur la métrique logging.googleapis.com/user/nt360_recompute_fail
# (console Monitoring ▸ Alerting, condition « Cloud Run Revision > user/nt360_recompute_fail »).
```

## 4. Alerte — absence de sauvegarde (l'export dominical n'a pas tourné)

L'export Firestore tourne dimanche 03:00. Détecter son ABSENCE (pas seulement son échec) via une métrique
d'absence de log de succès. La fonction journalise à la réussite `logger.info("scheduledFirestoreExport
terminé", …)` → sortie **jsonPayload** (pas `textPayload`) ; on matche donc le champ `jsonPayload.message`
(et NON `status:"ok"`, qui n'existe que dans le doc Firestore `opsLog`, jamais dans Cloud Logging) :

```bash
gcloud logging metrics create nt360_backup_ok \
  --description="Succès de l'export Firestore nt360" \
  --log-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="scheduledfirestoreexport" AND jsonPayload.message="scheduledFirestoreExport terminé"'
# Policy « absence de données pendant 8 j » (metric-absence) sur user/nt360_backup_ok → alerte si aucun
# succès depuis plus d'une semaine.
```

## 5. Alerte budget de facturation

À créer dans **Billing ▸ Budgets & alerts** (hors `gcloud monitoring`) : un budget mensuel avec seuils
50 % / 90 % / 100 %, notifié au même canal. Garde-fou contre une dérive de coût (recompute en boucle,
flood errorLog, etc.).

## 6. Complément applicatif (déjà en place)

Le webhook Slack/Teams applicatif (`setNotificationConfig`, UI Habilitations) pousse **les crashs de
callables** et le **digest d'alertes métier 07:00**. Il ne couvre PAS les jobs planifiés ni les quotas —
d'où les policies GCP ci-dessus. Les deux sont complémentaires.
