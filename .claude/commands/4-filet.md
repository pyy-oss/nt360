---
description: Phase 4 — Tendre le filet de non-régression avant toute modification
---

# Phase 4 — Filet de non-régression

**Tu n'écris que des tests. Aucune modification de code applicatif, aucune migration.**

Prérequis : phases 0 à 3 validées.

## L'idée

On ne modifie pas un comportement qu'on n'a pas d'abord figé. Le filet est ce qui rend
vérifiable la promesse « aucune régression ». Sans lui, la promesse est un vœu.

## Ce que tu fais

### 1. État des lieux de la couverture
- La suite de tests existante passe-t-elle **avant toute intervention** ? Lance-la. Si elle est
  rouge, **arrête tout et signale-le** : on ne construit pas sur un filet déjà troué. Note dans
  le journal quels tests échouent et depuis quand (`git log` sur les fichiers concernés).
- Quelle est la couverture des zones listées dans le tableau des points de contact de `04-PLAN-INTEGRATION.md` ?

### 2. Tests de caractérisation
Pour **chaque point de contact** du plan, écris un test qui **fige le comportement actuel**,
y compris s'il te semble faux.

> Un test de caractérisation ne dit pas ce que le code *devrait* faire. Il dit ce qu'il *fait*.
> Si le comportement actuel est un bug, le test fige le bug, et tu l'écris dans le journal.
> Corriger un bug pendant une intégration, c'est mélanger deux causes d'échec.

Priorité, dans l'ordre :
1. Les tables et services touchés par le module (tiers, factures, achats, temps, droits)
2. Les batchs et tâches planifiées qui lisent ces tables
3. Les exports et états comptables qui pourraient bouger
4. Les écrans les plus utilisés qui affichent ces données

### 3. Empreinte des données
Si l'ERP a un jeu de données de recette, capture une empreinte avant/après :
comptages par table, sommes de contrôle sur les colonnes financières, totaux de balance.
Un script simple suffit. C'est ce qui détectera une migration qui a mangé une ligne.

### 4. Le harnais de vérification
Écris ce que `/verif` exécutera :
- suite de tests existante (doit rester verte)
- suite de tests de caractérisation (doit rester verte)
- comparaison d'empreinte de données
- linter / analyse statique, **au niveau d'exigence de l'ERP, pas au tien**

## Livrable

- Les tests, dans l'emplacement et le style de l'ERP.
- Une section dans `06-JOURNAL.md` : ce qui est couvert, ce qui ne l'est pas, et **ce qui ne
  peut pas l'être** (le non-testable est un risque à déclarer, pas à cacher).

## Fin de phase

> **Phase 4 terminée. Le filet couvre N points de contact sur M. Les M−N restants sont des
> risques assumés, listés dans le journal. Validez avant `/5-lot 1`.**

Arrête-toi.
