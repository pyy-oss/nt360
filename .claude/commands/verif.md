---
description: Vérifier qu'aucune régression n'a été introduite et que les règles de l'existant sont respectées
---

# Vérification

Deux questions, également bloquantes :
**1. Est-ce que quelque chose qui marchait risque de ne plus marcher ?**
**2. Est-ce que ce code est indiscernable du reste de l'ERP ?**

Exécute tout, dans l'ordre, **avant** d'interpréter quoi que ce soit.

## Partie 1 — Non-régression

1. **Suite de tests existante** — commande observée en phase 0. Verte, et elle l'était déjà avant le lot.
2. **Tests de caractérisation** (phase 4). Verts sur tous les points de contact touchés.
3. **Empreinte de données** — comparaison avant/après sur le jeu de recette.
4. **Migrations additives** — cherche `DROP`, `RENAME`, `ALTER ... TYPE`, `NOT NULL` ajouté sans
   valeur par défaut. Chacun est un blocage.
5. **Périmètre tenu** — `git diff --name-only <base>..HEAD` confronté au périmètre déclaré du lot.
6. **Drapeau éteint = existant strictement identique.**

## Partie 2 — Conformité aux règles

Confronte le diff à `docs/contrats/02-REGLES.md`, section par section :

| # | Contrôle | Référence |
|---|---|---|
| 7 | **Les dix règles intouchables** — chacune, avec sa vérification mécanique | 02-REGLES §H |
| 8 | Nommage des tables, colonnes, clés, index | §A.1 |
| 9 | Types, notamment **montants et dates** | §A.2 |
| 10 | Colonnes techniques présentes et nommées comme ailleurs | §A.3 |
| 11 | Migrations : outil, nommage, réversibilité | §A.5 |
| 12 | **Arrondi et affichage FCFA** | §A.6, §D.5 |
| 13 | Couches respectées : rien n'appelle ce qu'il n'a pas le droit d'appeler | §B.1 |
| 14 | Linter et formateur : **zéro écart**, avec la config de l'ERP | §B.2 |
| 15 | Erreurs, journalisation, validation : mécanismes maison utilisés | §B.3 |
| 16 | Tests : emplacement, nommage, type, couverture attendue | §B.4 |
| 17 | Permissions déclarées et vérifiées **par le moteur existant** | §B.5 |
| 18 | **Aucune valeur de couleur, taille, espacement ou police en dur** si des tokens existent | §C |
| 19 | Composants d'interface : ceux de l'ERP, pas des nouveaux | §D.2, §D.3 |
| 20 | **Formats d'affichage** : date, nombre, montant, pourcentage, valeur vide, négatif | §D.5 |
| 21 | Voix de l'interface : libellés, casse, vouvoiement, glossaire maison | §D.6 |
| 22 | Aucune duplication d'une brique listée RÉUTILISER | 03-ACCELERATEURS |
| 23 | Aucune dépendance nouvelle sans ADR validé | 05-DECISIONS |
| 24 | Aucune donnée sensible dans le code, les tests, les fixtures, les logs | §B.5 |
| 25 | Journal à jour, échecs compris | 06-JOURNAL |

## Le test de l'inconnu

> Dernier contrôle, à faire mentalement : **si on retirait le préfixe `mnt_` et qu'on montrait
> ce code à un développeur de l'ERP en lui demandant qui l'a écrit et quand — pourrait-il dire
> que c'est nouveau ?** S'il le peut, en s'appuyant sur autre chose que le sujet métier, c'est
> rouge.

## Rapport

| # | Contrôle | Résultat | Détail |
|---|---|---|---|

Verdict unique : **VERT** (fusionnable) ou **ROUGE** (bloqué), avec la liste des blocages, chacun
avec son fichier, sa ligne, et la règle enfreinte.

Pas de « vert avec réserves ». Une réserve est un rouge qui n'ose pas dire son nom.

Si rouge : n'entreprends pas la correction sans le dire. Explique d'abord ce qui casse, ou ce
qui dépasse.
