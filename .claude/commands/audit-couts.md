---
description: Rejoue la cartographie de coûts GCP et compare au dernier rapport (.audit/RAPPORT.md)
---

# /audit-couts — audit de dérive de coûts GCP (réutilisable sur tout projet)

Objectif : mesurer où part l'argent GCP, vérifier que les barrières anti-dérive **mordent encore**, et
comparer au dernier passage. Réutilisable sur n'importe quel dépôt (adapte les noms de projet/région).

## 1. Source de vérité — facturation (si accessible)

Si `gcloud`/`bq` sont disponibles ET l'export BigQuery de facturation est actif :
```bash
bq query --use_legacy_sql=false '
SELECT service.description AS service, sku.description AS sku,
       FORMAT_DATE("%Y-%m", usage_start_time) AS mois, ROUND(SUM(cost),2) AS cout
FROM `PROJECT.billing_export.gcp_billing_export_v1_*`
GROUP BY service, sku, mois ORDER BY mois DESC, cout DESC LIMIT 50'
```
Compare le mois courant au mois précédent, par service (Cloud Build, Cloud Run, Artifact Registry…).
**Si l'export n'est pas actif ou gcloud absent : dis-le explicitement, étiquette tout chiffre « ESTIMÉ »,
et rappelle que l'export est le prérequis (cf. RUNBOOK-COUTS.md § Étape 0).**

## 2. Cartographie repo (toujours faisable)

Écris les données volumineuses dans `.audit/` (gitignoré), n'analyse que les agrégats :
- **Fonctions** : `node functions/scripts/deploy-targets.mjs --all | tr ',' '\n' | grep -c .` (nombre déployé).
- **Crons** : `grep -rn "onSchedule" functions/ | wc -l` + leurs fréquences.
- **Sites IA** : `grep -rn "messages.create" functions/lib | wc -l` + vérifie que chacun a un `rateLimit`.
- **Workflows** : lister `.github/workflows/*.yml`, vérifier `concurrency:` + `paths` sur les déploiements.

## 3. Les barrières mordent-elles encore ? (contrôle mécanique)

| Barrière | Vérification | Attendu |
|---|---|---|
| Hook déploiement | `echo '{"tool_name":"Bash","tool_input":{"command":"firebase deploy --only functions"}}' \| python3 .claude/hooks/guard-deploy.py; echo $?` | exit **2** (bloqué) |
| Concurrency CI | `grep -A2 "^concurrency" .github/workflows/ci.yml` | `cancel-in-progress: true` présent |
| Deploy scopé | `grep -c "paths-ignore" .github/workflows/firebase-deploy.yml` + `grep deploy-targets.mjs .github/workflows/firebase-deploy.yml` | présents |
| Cap IA | `grep -c 'rateLimit(req.auth.uid, "ai"' functions/index.js` + les callables IA des handlers | tous les appels IA capés |
| Cleanup Artifact Registry | `gcloud artifacts repositories describe gcf-artifacts --location=us-central1 --format='value(cleanupPolicies)'` (si gcloud) | non vide |
| minInstances | `grep -rn "minInstances" functions/` | aucun `> 0` non voulu |

## 4. Comparaison

Lis le dernier `.audit/RAPPORT.md`. Produis un delta : nombre de fonctions, crons, sites IA, coût par
service (réel si dispo, sinon estimé) — **avant / maintenant**. Signale toute barrière absente ou
contournée, tout nouveau cron/trigger automatique, tout appel IA sans cap. Réécris `.audit/RAPPORT.md`.

## 5. Verdict

En 5 lignes : ça monte / ça descend / stable, la cause dominante, et la prochaine action.
Si la baisse attendue depuis l'installation des barrières n'apparaît PAS dans la facturation, dis-le et
cherche pourquoi (barrière contournée ? nouveau vecteur ? export pas encore rempli ?).
