---
description: Phase 3 — Plan d'intégration du module dans l'ERP
---

# Phase 3 — Plan d'intégration

**Aucun code applicatif.** Livrables : `docs/contrats/04-PLAN-INTEGRATION.md` et les ADR dans
`docs/contrats/05-DECISIONS.md`.

Prérequis : phases 0, 1 et 2 validées.

## Ce que tu produis

### 1. L'ancrage
Où le module se pose dans l'architecture existante. En suivant **les couches de l'ERP telles
qu'observées en phase 0**, pas une architecture idéale. Si l'ERP est un monolithe MVC, le
module est un dossier MVC. S'il est modulaire, le module est un module. On ne profite pas de
l'occasion pour introduire une architecture hexagonale.

### 2. Le schéma de données
- Les nouvelles tables, préfixées, avec leurs colonnes et leurs types **dans les conventions
  de l'ERP**.
- Les **clés étrangères vers l'existant** : quel contrat pointe vers quel tiers, avec quel nom
  de colonne, quelle contrainte.
- Ce qui **n'est pas créé** parce que réutilisé (renvoi vers `03-ACCELERATEURS.md`).
- Les extensions additives sur des tables existantes, s'il y en a — chacune avec son ADR.
- **Motif expand / migrate / contract** explicité pour toute évolution.

### 3. Les points de contact
Liste exhaustive de chaque endroit où le module touche l'existant :

| Point de contact | Sens | Mécanisme | Risque de régression | Test de caractérisation à écrire |
|---|---|---|---|---|

C'est le tableau le plus important du document. **Chaque ligne est une occasion de casser
quelque chose.** Si une ligne n'a pas de test de caractérisation associé, elle n'est pas prête.

### 4. Le découpage en lots
Chaque lot :
- Livre une valeur vérifiable par un utilisateur
- Tient dans une revue de code raisonnable
- Est réversible indépendamment
- Précise ses tests, son drapeau de fonctionnalité, sa procédure de retour arrière

Ordre imposé par les dépendances de données, pas par l'envie. Rappel de la SFD : **le moteur de
risques vient en dernier**. Un score calculé sur un référentiel incomplet est un score faux, et
un score faux tue l'outil plus sûrement que l'absence d'outil.

### 5. Le drapeau de fonctionnalité
Comment le module s'éteint. Où le drapeau est déclaré, comment il est lu, ce qui se passe
quand il est à zéro. **En suivant le mécanisme existant de l'ERP s'il y en a un.**

### 6. Les ADR
Un ADR par décision structurante. Format dans `05-DECISIONS.md`. Décisions attendues au minimum :
- Le contrat de maintenance est-il une nouvelle entité, ou une spécialisation d'une entité
  existante (affaire, projet, contrat de vente) ?
- Où vit le calcul SLA : base, application, ou batch ?
- Où vivent les scores : calculés à la volée, ou matérialisés par un batch ?
- Réutilise-t-on le moteur de workflow existant pour la validation des renouvellements ?
- Quelle est la source de vérité du montant du contrat, sachant que l'ERP facture ?

## Règle de rédaction

Chaque proposition est adossée à une observation de les phases 0 à 2. Format :

> « Le module utilise le moteur de workflow existant (`app/Workflow/Engine.php`, observé en
> phase 0 §4.2) pour la validation des renouvellements, plutôt qu'un circuit dédié. »

Une proposition sans référence à l'existant est une proposition hors-sol. Supprime-la.

## Fin de phase

Résume le plan en 15 lignes : ancrage, nombre de tables créées, nombre de points de contact,
nombre de lots, principaux risques. Puis :

> **Phase 3 terminée. Le tableau des points de contact est le cœur du risque : relisez-le ligne
> à ligne. Validez le plan et le découpage avant `/4-filet`.**

Arrête-toi.
