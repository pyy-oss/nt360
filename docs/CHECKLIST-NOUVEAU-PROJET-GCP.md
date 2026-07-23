# Checklist — nouveau projet GCP (à poser AVANT le premier déploiement)

À dérouler pour tout nouveau projet Firebase/GCP, pour qu'aucune dérive de coût ne soit possible dès le
départ. L'ordre compte : la facturation d'abord (non rétroactive), les barrières ensuite.

## Avant tout déploiement

- [ ] **Export BigQuery de facturation activé** (Billing → Billing export → BigQuery → Enable). Non
      rétroactif : à faire le jour de la création du projet, sinon les premiers jours sont invisibles.
- [ ] **Budget + alertes** posés (50/90/100 %) — `gcloud billing budgets create` (cf. RUNBOOK-COUTS.md).
- [ ] **Quota Cloud Build « concurrent builds »** abaissé (override bas, p. ex. 5) — Console → Quotas.
- [ ] **Alerte Monitoring « builds/heure »** créée (seuil bas) — le filet qui hurle avant l'empilement.

## Dépôt / CI (copier les barrières de ce repo)

- [ ] **Hook local** `.claude/hooks/guard-deploy.py` + `.claude/settings.json` copiés (bloque les
      déploiements non scopés). Testé : la commande interdite sort en exit 2.
- [ ] **Workflow de déploiement** : `concurrency` (group + `cancel-in-progress: false` pour NE PAS
      interrompre un déploiement prod), `branches: [main]`, `paths-ignore` (doc), cibles **nommées**
      (jamais le codebase entier).
- [ ] **Workflow CI** : `concurrency` (`cancel-in-progress: true`), `push:[main]` + `pull_request` (pas de
      double run), pas de `push:["**"]`.
- [ ] **Déploiement sélectif** : `deploy-targets.mjs` (ou équivalent) dérive les cibles du git diff ;
      fail-safe = liste complète.
- [ ] **Source unique des cibles** (`deployed-functions.txt`) + garde CI qui la compare aux exports.

## Fonctions / runtime

- [ ] **Région** déclarée explicitement (`setGlobalOptions({ region })`) et cohérente avec la base Firestore.
- [ ] **`minInstances`** = 0 par défaut (pas d'instance chaude permanente sans besoin chiffré).
- [ ] **Mémoire** dimensionnée par fonction (ne pas tout mettre à 1–2 Go « au cas où » : coût GB‑s).
- [ ] **Cleanup policy Artifact Registry** posée dès le 1er déploiement (sinon les images s'accumulent).

## IA / API tierces payantes

- [ ] Tout appel à une API payante (Anthropic, Vertex…) passe par un **callable serveur** avec `rateLimit`
      et un **cap sur le lot** envoyé.
- [ ] Aucun appel IA dans une **boucle non bornée** ni un trigger fréquent sans plafond.
- [ ] Clé en **Secret Manager** uniquement, jamais en dur, jamais committée.

## Après le premier déploiement

- [ ] `/audit-couts` lancé une fois pour établir la ligne de base, puis chaque semaine (RUNBOOK-COUTS.md).
