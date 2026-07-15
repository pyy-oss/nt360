---
description: Phase 2 — Inventorier ce que l'ERP fournit déjà et qu'on ne doit pas recréer
---

# Phase 2 — Accélérateurs

**Aucun code applicatif dans cette phase.** Livrable unique : `docs/contrats/03-ACCELERATEURS.md`.

Prérequis : `01-EXISTANT.md` et `02-REGLES.md` remplis et validés. S'il ne l'est pas, arrête-toi et dis-le.

## L'idée

Le module de contrats a besoin d'une trentaine de briques. L'ERP en fournit probablement vingt.
Chaque brique recréée est une brique de trop : elle divergera, elle devra être maintenue deux
fois, et elle produira un jour deux chiffres différents pour la même question.

**Ta mission : pour chaque besoin du module, dire si l'ERP le fournit déjà.**

## Les besoins à confronter à l'existant

Prends `docs/contrats/00-SPEC-MODULE.md` et traite chaque ligne du tableau ci-dessous. Pour
chacune, cherche activement dans l'ERP avec **au moins trois vocabulaires différents**
(français, anglais, abrégé maison) avant de conclure à l'absence.

| # | Besoin du module | Où chercher dans un ERP |
|---|---|---|
| 1 | Référentiel tiers / clients | module ventes, comptabilité auxiliaire |
| 2 | Adresses, contacts | idem |
| 3 | Conditions de paiement | comptabilité client |
| 4 | Factures de vente | facturation |
| 5 | Règlements et lettrage | trésorerie, comptabilité |
| 6 | Balance âgée / créances | comptabilité client |
| 7 | Commandes et factures d'achat | achats |
| 8 | Fournisseurs / éditeurs | achats |
| 9 | Plan comptable et **analytique** | comptabilité |
| 10 | **Axes analytiques** (affaire, projet, contrat ?) | comptabilité analytique |
| 11 | Devises et taux de change | comptabilité |
| 12 | Employés, profils, **coûts horaires chargés** | **paie / RH** |
| 13 | **Feuilles de temps / temps passé** | **module projet ou paie** |
| 14 | Notes de frais / déplacements | **paie / achats** |
| 15 | Projets / affaires | module projet |
| 16 | **Calendriers, jours ouvrés, jours fériés** | **paie** (le plus souvent) |
| 17 | Utilisateurs, rôles, permissions | socle |
| 18 | **Moteur de workflow / validation** | socle |
| 19 | Notifications (mail, SMS) | socle |
| 20 | Ordonnanceur / tâches planifiées | socle |
| 21 | **Journal d'audit** | socle |
| 22 | **Séquences de numérotation** | socle |
| 23 | Gestion documentaire / pièces jointes | socle |
| 24 | Recherche | socle |
| 25 | Exports (CSV, PDF, Excel) | socle |
| 26 | Reporting / tableaux de bord | décisionnel |
| 27 | Bibliothèque de graphiques | interface |
| 28 | Composants d'interface (tableaux, formulaires) | interface |
| 29 | Multi-société / multi-pays | socle |
| 30 | API / intégration externe | socle |

Ajoute toute brique que tu découvres et qui n'est pas dans cette liste.

## Le verdict

Pour chaque ligne, un et un seul verdict :

| Verdict | Signification | Condition |
|---|---|---|
| **RÉUTILISER** | On s'y branche tel quel | La brique existe et couvre le besoin |
| **ÉTENDRE** | La brique existe, il lui manque quelque chose | L'extension est additive et ne casse pas l'usage actuel |
| **CRÉER** | Rien d'équivalent | **Justification obligatoire** : dire ce qui a été cherché, avec quels termes, et pourquoi ça ne convient pas |
| **ARBITRER** | Deux options défendables | Poser la question, ne pas trancher seul |

**Un verdict CRÉER non justifié est un échec de la phase.** Le biais par défaut d'un assistant
est de créer : c'est plus simple que de comprendre. Résiste.

## Les trois pièges connus

1. **Les calendriers de jours fériés sont dans la paie**, pas dans un module « calendrier ».
   Le module SLA en a besoin pour calculer les heures ouvrées. Cherche là.
2. **Les coûts horaires chargés existent déjà** quelque part — paie, ou compta analytique, ou
   une table de taux de facturation. Le module marge en dépend. Ne crée pas une deuxième vérité.
3. **L'axe analytique « affaire » ou « projet » est peut-être le crochet** pour rattacher les
   coûts au contrat. S'il existe, un contrat de maintenance est peut-être une affaire. C'est
   une décision structurante : ouvre un ADR.

## Livrable

Remplis `docs/contrats/03-ACCELERATEURS.md`. Puis mets à jour `docs/contrats/02-REGLES.md`
avec les conventions réellement observées dans l'ERP (nommage, structure, tests, migrations).

## Fin de phase

Résume : combien de RÉUTILISER, d'ÉTENDRE, de CRÉER, d'ARBITRER. Liste les ARBITRER en
questions ouvertes. Puis :

> **Phase 2 terminée. Chaque verdict est à arbitrer par vous, en particulier les CRÉER : ce
> sont eux qui coûtent. Validez avant `/3-plan`.**

Arrête-toi.
