# 03 — Accélérateurs

> **[À REMPLIR — PHASE 2]**
> Rempli par `/2-accelerateurs`. Chaque verdict est arbitré par un humain.
> **Un CRÉER non justifié est un échec de la phase.**

## Synthèse

| Verdict | Nombre |
|---|---|
| RÉUTILISER | |
| ÉTENDRE | |
| CRÉER | |
| ARBITRER | |

## Inventaire

| # | Besoin du module | Existe dans l'ERP ? | Où (chemin) | Verdict | Justification / ce qui manque |
|---|---|---|---|---|---|
| 1 | Référentiel tiers / clients | | | | |
| 2 | Adresses, contacts | | | | |
| 3 | Conditions de paiement | | | | |
| 4 | Factures de vente | | | | |
| 5 | Règlements et lettrage | | | | |
| 6 | Balance âgée / créances | | | | |
| 7 | Commandes / factures d'achat | | | | |
| 8 | Fournisseurs / éditeurs | | | | |
| 9 | Plan comptable | | | | |
| 10 | Axes analytiques (affaire / projet) | | | | |
| 11 | Devises et taux | | | | |
| 12 | Employés, profils, coûts horaires chargés | | | | |
| 13 | Feuilles de temps / temps passé | | | | |
| 14 | Notes de frais / déplacements | | | | |
| 15 | Projets / affaires | | | | |
| 16 | Calendriers, jours ouvrés, jours fériés | | | | |
| 17 | Utilisateurs, rôles, permissions | | | | |
| 18 | Moteur de workflow / validation | | | | |
| 19 | Notifications | | | | |
| 20 | Ordonnanceur / tâches planifiées | | | | |
| 21 | Journal d'audit | | | | |
| 22 | Séquences de numérotation | | | | |
| 23 | Pièces jointes / GED | | | | |
| 24 | Recherche | | | | |
| 25 | Exports | | | | |
| 26 | Reporting / tableaux de bord | | | | |
| 27 | Bibliothèque de graphiques | | | | |
| 28 | Composants d'interface | | | | |
| 29 | Multi-société / multi-pays | | | | |
| 30 | API / intégration | | | | |

## Les trois questions qui décident du coût du projet

### Q1 — Les jours fériés multi-pays existent-ils déjà ?
> Le calcul SLA en heures ouvrées en dépend. Ils sont le plus souvent dans la paie.
> **Trouvé / pas trouvé :**
> **Conséquence si absent :**

### Q2 — Les coûts horaires chargés existent-ils déjà ?
> Le calcul de marge en dépend. Les recréer, c'est créer une deuxième vérité qui divergera.
> **Trouvé / pas trouvé :**
> **Conséquence si absent :**

### Q3 — Existe-t-il un axe analytique « affaire » exploitable comme crochet de rattachement ?
> Si oui, un contrat de maintenance est peut-être une affaire, et tous les coûts s'y rattachent
> déjà. C'est la décision la plus structurante du projet. **→ ADR obligatoire.**
> **Trouvé / pas trouvé :**
> **Conséquence :**

## Ce qu'on crée, et pourquoi on n'avait pas le choix

| Brique créée | Cherché sous les termes | Pourquoi l'existant ne convient pas | Coût estimé |
|---|---|---|---|

## Arbitrages en attente

| # | Question | Option A | Option B | Recommandation | Décidé par |
|---|---|---|---|---|---|
