# RUNBOOK — Coûts GCP (nt360)

Projet prod : **`propulse-business-87f7a`** (partagé). Région fonctions : **us-central1**.
Cause historique de dérive : empilement de Cloud Builds au déploiement (~2600 builds une fois).
Les barrières en place sont listées § « Barrières installées » ; ce runbook sert à **vérifier chaque
semaine** que rien ne redérive, et regroupe les gestes GCP à poser une fois (§ Appendice).

## Vérification hebdomadaire (5 lignes)

1. **Facturation** : Console → Billing → Reports, filtrer par service, comparer à S-1. Pic sur **Cloud
   Build** ou **Artifact Registry** = alerte. (Ou `bq` sur l'export, cf. `/audit-couts`.)
2. **Builds** : Console → Cloud Build → History. Un déploiement normal = **1 build par fonction _modifiée_**
   (pas ~200). Beaucoup de builds d'un coup = un workflow s'empile → vérifier `concurrency`.
3. **Actions** : `/audit-couts` (rejoue la carto + teste que les barrières mordent) une fois/semaine.
4. **IA (Anthropic, facture séparée)** : vérifier qu'aucun callable IA n'a perdu son `rateLimit`.
5. **Nouveau cron/trigger ?** `grep -rn onSchedule functions/` — tout ajout automatique est un coût récurrent.

## Barrières installées (et comment vérifier qu'elles mordent)

| # | Barrière | Fichier | Vérif « ça mord » |
|---|---|---|---|
| 1 | Hook local anti-déploiement coûteux | `.claude/hooks/guard-deploy.py` + `settings.json` | lancer la commande interdite → exit 2 (cf. `/audit-couts` §3) |
| 2 | Concurrency + fin du double-run CI | `.github/workflows/ci.yml` | `concurrency:` présent, `push:[main]` |
| 3 | Deploy scopé (paths-ignore) + preview sérialisée | `firebase-deploy.yml`, `firebase-preview.yml` | merge doc-only ⇒ pas de déploiement |
| 5 | Déploiement sélectif des fonctions (git diff) | `functions/scripts/deploy-targets.mjs` | diff hors functions/ ⇒ 0 fonction déployée |
| 7 | Cap de débit sur `curateNewsNow` | `functions/index.js` | `rateLimit(uid,"ai",…)` présent |
| 6, 8 | Cleanup Artifact Registry, quota, budgets, alertes | **GCP (voir Appendice)** | `gcloud … describe`, budgets visibles en console |

## Barrière 4 — split en codebases (faisabilité, NON exécuté)

`firebase.json` accepte plusieurs codebases (`functions[]` est un tableau) : c'est **faisable**. MAIS le code
est un monolithe `functions/index.js` (~205 exports, un seul `package.json`). Un vrai split impose de découper
physiquement le source en plusieurs dossiers, chacun avec son `package.json` — **refactor majeur** (le « Lot
Archi » déjà noté dans CLAUDE.md), à mener dans une session dédiée avec tests. La barrière 5 (déploiement
sélectif) capte l'essentiel du gain de coût **sans** ce risque ; le split reste un objectif d'architecture, pas
une urgence coût.

---

## Appendice — gestes GCP à poser une fois (console / `gcloud`)

> Ces gestes ne peuvent pas être exécutés depuis le dépôt/CI. **Aucune suppression sans revue de la liste
> exacte** (utiliser `--dry-run` d'abord). Ne jamais committer de valeur de secret/clé.

### Étape 0 — Activer l'export BigQuery de facturation (PRÉREQUIS, non rétroactif)
Console → **Billing → Billing export → BigQuery export → « Standard usage cost » → Enable** (dataset
`billing_export`, région EU). **Ne remplit que les jours à partir de l'activation — chaque jour d'attente
est perdu.** Sans lui, tout chiffrage de coût reste une estimation.

### Barrière 6a — Cleanup policy Artifact Registry (`gcf-artifacts`)
Purge les vieilles images de fonctions (accumulation non bornée aujourd'hui). Fichier `cleanup-policy.json` :
```json
[
  { "name": "supprimer-anciennes", "action": {"type": "Delete"},
    "condition": {"olderThan": "30d", "tagState": "any"} },
  { "name": "garder-recentes", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 5} }
]
```
```bash
# 1) DRY-RUN — montre ce qui SERAIT supprimé, ne supprime rien :
gcloud artifacts repositories set-cleanup-policies gcf-artifacts \
  --location=us-central1 --project=propulse-business-87f7a \
  --policy=cleanup-policy.json --dry-run
# 2) Après revue de la liste, RE-lancer sans --dry-run pour APPLIQUER.
```

### Barrière 6b — Quota de builds concurrents + machine type
- Quota : Console → **IAM & Admin → Quotas** → filtrer « Cloud Build » → *Concurrent builds* → poser un
  override BAS (p. ex. 5) : même un workflow qui s'emballe ne peut plus lancer 200 builds en parallèle.
- Machine type : Console → **Cloud Build → Settings** (ou vérifier tout pool custom). Défaut = `e2-medium`.
  Si un type coûteux a été posé, revenir au défaut. Pour un déploiement Cloud Run manuel, toujours
  `--machine-type` (le hook barrière 1 le rappelle).

### Barrière 8 — Budgets + alertes
```bash
# Budget mensuel avec alertes 50/90/100 % (remplacer BILLING_ACCOUNT_ID) :
gcloud billing budgets create --billing-account=BILLING_ACCOUNT_ID \
  --display-name="nt360 budget mensuel" \
  --budget-amount=200000XOF \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```
- Alerte « builds/heure » : Console → **Monitoring → Alerting → Create policy** → métrique
  `cloudbuild.googleapis.com/build/count` (ou métrique log-based sur les démarrages de build) → seuil p. ex.
  > 50 builds/heure → notifie par e-mail. C'est le filet qui hurle AVANT qu'un empilement coûte cher.

### Sécurité ops (rappel, projet gelé `neurones-360`)
Couper la facturation de `neurones-360` (compte compromis) ; supprimer le secret GitHub
`FIREBASE_SERVICE_ACCOUNT_V2`. Hors périmètre code, mais lié aux coûts.
