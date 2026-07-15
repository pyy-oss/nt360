# 04 — Plan d'intégration

> **[À REMPLIR — PHASE 3]**
> Rempli par `/3-plan`. Chaque proposition est adossée à une observation des phases 0 à 2.

## 1. Ancrage

> Où le module se pose, **dans les couches de l'ERP telles qu'observées**, pas dans une
> architecture idéale.

| Élément du module | Emplacement dans l'ERP | Convention suivie |
|---|---|---|

## 2. Schéma de données

### 2.1 Tables créées (préfixe `mnt_`)

| Table | Rôle | Clé | Colonnes | FK vers l'existant |
|---|---|---|---|---|

### 2.2 Tables NON créées, car réutilisées

| Besoin | Table existante utilisée | Comment on s'y branche |
|---|---|---|

### 2.3 Extensions additives sur l'existant

| Table existante | Ajout | Motif | ADR | Réversible ? |
|---|---|---|---|---|

> Chaque ligne suit le motif **expand / migrate / contract**. Aucune suppression, aucun
> renommage, aucun changement de type dans la même livraison qu'une lecture.

## 3. Points de contact — le cœur du risque

> **Le tableau le plus important du document.** Chaque ligne est une occasion de casser
> quelque chose. Une ligne sans test de caractérisation n'est pas prête.

| # | Point de contact | Sens | Mécanisme | Risque de régression | Test de caractérisation | Couvert ? |
|---|---|---|---|---|---|---|

## 4. Découpage en lots

| Lot | Livre | Touche | Ne touche pas | Drapeau | Retour arrière | Dépend de |
|---|---|---|---|---|---|---|
| 1 | | | | | | — |
| 2 | | | | | | 1 |

> **Ordre imposé par les dépendances de données.** Le moteur de risques est le dernier lot :
> il dépend du référentiel complet, du delivery et de la finance. Livré tôt, il produit des
> scores faux — et un score faux tue l'outil plus sûrement que l'absence d'outil.

## 5. Drapeau de fonctionnalité

| | |
|---|---|
| Mécanisme existant réutilisé ? | |
| Où le drapeau est déclaré | |
| Comment il est lu | |
| Comportement à drapeau éteint | **strictement identique à avant** |
| Granularité (module entier / par lot) | |

## 6. Ce que le plan ne couvre pas

> Les renoncements assumés, et à quelle condition on y reviendra.
