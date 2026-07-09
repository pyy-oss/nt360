# nt360 — Reprise après sinistre (Disaster Recovery)

> Runbook DR (R8, axe #48). Procédure de sauvegarde, objectifs RTO/RPO, restauration pas-à-pas et
> vérification. À relire et **tester à blanc** au moins une fois par trimestre. Voir aussi
> `ARCHITECTURE.md`, `RUNBOOK-GOLIVE.md`, `ops-commands.md`.

## 1. Objectifs

| Indicateur | Cible | Justification |
|---|---|---|
| **RPO** (perte de données max) | ≤ 7 jours | Export Firestore hebdomadaire ; les sources d'ingestion (classeurs) restent dans `gs://nt360` et sont **ré-ingérables** (idempotent) → RPO effectif souvent bien meilleur. |
| **RTO** (temps de remise en service) | ≤ 4 h | Import d'un export Firestore + re-déploiement fonctions/hosting. |

> Renforcer le RPO à ≤ 24 h : passer `scheduledFirestoreExport` de `every sunday 03:00` à `every day 03:00`.

## 2. Périmètre à protéger

1. **Firestore** (base nommée `nt360`, projet **partagé** `propulse-business-87f7a`) — la donnée métier.
2. **Sources d'ingestion** — classeurs déposés dans `gs://nt360` (ré-ingérables via `reingest`).
3. **Code** — dépôt Git (`main`) : frontend, fonctions, règles, config. C'est la source de vérité du
   déploiement.
4. **Secrets** — Secret Manager (`CLICKUP_TOKEN`, `ANTHROPIC_API_KEY`) — **non** inclus dans les
   exports ; à re-provisionner séparément (voir §5.4).

## 3. Mécanisme de sauvegarde

- **`scheduledFirestoreExport`** (`functions/index.js`) — fonction planifiée **hebdomadaire**
  (`every sunday 03:00`) : `client.exportDocuments()` vers `gs://<BACKUP_BUCKET>/backups/<timestamp>`.
  Chaque succès laisse une trace **queryable** dans `opsLog` (`action=scheduledFirestoreExport`,
  `status=ok`, `uri`).
- **Bucket dédié** — `BACKUP_BUCKET` (voir `functions/lib/config.js`). Prérequis ops : bucket créé avec
  **règle de rétention/versioning** et IAM permettant à la fonction d'exporter (rôle
  `Cloud Datastore Import Export Admin` sur le service account des fonctions).

### Vérifier que les sauvegardes tournent
```bash
# Dernier export réussi (trace opsLog)
#   Console Firestore → collection opsLog → filtrer action == "scheduledFirestoreExport", status == "ok"
# Contenu du bucket
gcloud storage ls gs://<BACKUP_BUCKET>/backups/
```
Si aucune trace récente (> 8 jours) : voir §6 (alerte de fraîcheur).

## 4. Scénarios & décision

| Scénario | Action |
|---|---|
| Corruption/suppression partielle de données | Restauration **sélective** (§5) sur une base de travail, puis ré-écriture ciblée. |
| Perte totale de la base `nt360` | Restauration **complète** (§5) depuis le dernier export. |
| Régression de code / déploiement raté | `git revert` + re-déploiement (`RUNBOOK-GOLIVE.md`). Pas un cas DR data. |
| Indisponibilité d'un SI tiers (ClickUp/webhook) | Aucune perte : ClickUp re-synchronisé au prochain pull ; webhooks sortants rejoués via `outboundQueue`/`retryOutbound`. |

## 5. Procédure de restauration

> ⚠️ Projet **partagé** : n'importer QUE dans la base nommée `nt360`. Ne jamais écraser la base par
> défaut ni celle de l'app sœur.

### 5.1 Choisir l'export
```bash
gcloud storage ls gs://<BACKUP_BUCKET>/backups/          # lister les timestamps
export SRC=gs://<BACKUP_BUCKET>/backups/<timestamp>
```

### 5.2 (Recommandé) Restaurer d'abord sur une base de TEST
```bash
# Créer une base de travail pour valider avant tout import en prod
gcloud firestore databases create --database=nt360-restore-test --location=<region>
gcloud firestore import "$SRC" --database=nt360-restore-test
# Inspecter la cohérence (comptages, quelques docs clés) avant de toucher la prod.
```

### 5.3 Restaurer la base de production `nt360`
```bash
gcloud firestore import "$SRC" --database=nt360
```
`import` **fusionne** (ne supprime pas les docs absents de l'export). Pour un état strictement identique
à l'export, restaurer sur une base neuve puis basculer `FIRESTORE_DB`.

### 5.4 Re-provisionner secrets & déploiement
```bash
# Secrets (si le projet a été recréé)
printf '%s' "$CLICKUP_TOKEN"    | gcloud secrets versions add CLICKUP_TOKEN --data-file=-
printf '%s' "$ANTHROPIC_API_KEY"| gcloud secrets versions add ANTHROPIC_API_KEY --data-file=-
# Déploiement PAR NOM (projet partagé) — voir RUNBOOK-GOLIVE.md
pnpm --filter web build && firebase deploy --only hosting
# fonctions : déployer la liste de functions/deployed-functions.txt (jamais --only functions global)
```

### 5.5 Re-synchroniser les intégrations
- ClickUp : le prochain `scheduledClickupPull` (04:30) réaligne ; ou déclencher manuellement.
- Recompute : lancer `recompute` pour régénérer les `summaries/*`.

## 6. Vérification post-restauration

1. Connexion + `smoke` E2E (`smoke.yml`, `workflow_dispatch`) → chargement, confidentialité de marge,
   navigation de tous les écrans.
2. Comptages Firestore cohérents vs. l'export (opportunités, comptes, factures).
3. `opsLog` sans pic d'erreurs ; `errorLog` client sans afflux.
4. Un recompute complet réussit et les dashboards affichent des chiffres plausibles.

## 7. Amélioration continue (backlog ops)
- **Alerte de fraîcheur des sauvegardes** : étendre `alertDigest` pour signaler l'absence de trace
  `opsLog` `scheduledFirestoreExport` `ok` depuis > 8 jours.
- **Test de restauration trimestriel** documenté (base `nt360-restore-test`).
- Passage à un export **quotidien** si le RPO doit descendre sous 24 h.
