# Partenariats & Certifications — Guide de mise en service

> Le module est **livré, audité, en production, mais ÉTEINT** (drapeau `config/parFeature` off par défaut).
> Tant qu'il n'est pas activé et alimenté, il ne fait **rien** : l'ERP est strictement celui d'avant.
> Ce guide décrit l'activation, dans l'ordre. Chaque étape est réversible.

## 0. Prérequis

| Élément | Où | Nécessaire pour |
|---|---|---|
| Rôle `direction` (ou droit `habilitations`) | matrice `config/permissions` | activer le drapeau + poser les droits |
| Secret `ANTHROPIC_API_KEY` (Secret Manager) | déjà requis par l'ERP | onglet **IA & QBR** (plan d'action, QBR). Absent ⇒ IA indisponible, le reste marche. |
| Secret `GRAPH_CLIENT_SECRET` + `config/emailNotify` | déjà requis par l'ERP | relances **email** (P1). Absent ⇒ pas d'email, le reste marche. |
| Secret `CLICKUP_TOKEN` + liste ClickUp dédiée | déjà requis par l'ERP | push assignation → tâche ClickUp (P4). Optionnel. |

Rien de nouveau à provisionner : le module réutilise les secrets et l'infra déjà en place.

## 1. Allumer le drapeau + poser les droits

1. **Habilitations → activation Partenariats** : basculer `config/parFeature` sur *activé* (callable `setParFeature`, direction). L'onglet **Partenariats & Certifications** apparaît pour les rôles portant le droit `partenariats`.
2. **Habilitations → matrice des droits** : accorder la clé de module `partenariats` (`read` ou `write`) aux rôles concernés (data-steward, PMO, direction). La `direction` l'a déjà (write partout).
   - **Attention CA** : le chiffre d'affaires constructeur (dérivé des BC) est **confidentiel** — il n'apparaît (KPI + carte + snapshots IA) **que** pour les rôles portant aussi le droit `rentabilite` (ADR-P07). Un steward `partenariats` sans `rentabilite` pilote tout **sauf** les montants.

À ce stade le module est visible mais vide.

## 2. Initialiser le référentiel des constructeurs

Pour chaque constructeur (Dell, Cisco, Fortinet, Huawei…), via le callable `upsertParPartner` (écriture `partenariats`) : niveaux (`tiers`), compétences (`competencies`), catalogue de certifications (`certificationCatalog` avec `validityMonths` — ex. Fortinet 24 mois), et **exigences de quota** (`requirements` : par niveau, cible certif/compétence, minimum d'ingénieurs).

> L'écriture **remplace** le référentiel du partenaire (sémantique « je pose l'état »). Intégrité vérifiée : une exigence pointe un niveau + une cible connus.

## 3. Rattacher le CA aux constructeurs (Paramétrage)

Onglet **Paramétrage** → *Correspondance fournisseur → constructeur* : relier chaque **nom de fournisseur** (tel qu'il figure sur les BC) au **constructeur**. Le CA par constructeur se **dérive automatiquement des BC fournisseurs** (aucune saisie ; même source que le module Fournisseurs — pas de deuxième vérité). Les fournisseurs non rattachés sont listés (avec leur volume, si droit `rentabilite`).

## 4. Certifier les ingénieurs + assigner les objectifs

- **Certifications** (onglet Certifications, `upsertParCertification`) : rattacher une certification à un **consultant existant** (annuaire ESN — jamais un second annuaire). Date d'expiration + statut **dérivés** du catalogue (jamais saisis). Les quotas et alertes s'allument.
- **Assignations** (onglet Assignations, `upsertParAssignment`) : affecter à un ingénieur l'obtention d'une certification à une **échéance cible**. Relances (J-30/14/7) + retards apparaissent au tableau de bord et à l'Actualité.

Après le prochain recompute (05:00, ou immédiat via une action déclenchant `requestRecompute`), les summaries `par_ca` / `par_quotas` / `par_alerts` / `par_relances` / `par_news` / `par_quotasHistory` se remplissent.

## 5. Canaux d'alerte (optionnels)

- **Relances email** (P1) : `config/emailNotify` activé → le digest quotidien `parRelancesSweep` (07:45) envoie aux managers (leurs assignations à relancer) + à la direction (`recipients.codir`). Le trigger `partenariats` est actif par défaut, gaté par le drapeau. Aucun email tant que le module est éteint.
- **ClickUp** (P4) : renseigner **Habilitations → ClickUp → Liste certifications** (`config/clickup.parListId`) avec l'id d'une **liste ClickUp dédiée** (pas celle des commandes). Le bouton « Pousser vers ClickUp » de chaque assignation devient actif. Vide ⇒ inactif.

## 6. Où le module devient visible

| Surface | Condition |
|---|---|
| Onglet **Partenariats & Certifications** (5 sous-onglets) | drapeau + droit `partenariats` |
| Carte **Partenariats** du **Bilan CODIR** | drapeau + droit `partenariats` |
| Volet **Partenariats** du fil **Actualité** | drapeau + droit `partenariats` |
| KPI + carte **CA constructeurs** | en plus, droit `rentabilite` |
| Relances **email** / tâches **ClickUp** | config email / `parListId` renseignés |

## 7. Vérification & retour arrière

- **Vérifier** : après seed + recompute, le tableau de bord affiche des partenaires, la conformité des quotas, les certifs à renouveler ; la tendance se construit jour après jour.
- **Éteindre** : rebasculer `config/parFeature` sur *désactivé* (Habilitations). Le module disparaît instantanément (onglet, CODIR, Actualité, scheduler, callables) — **l'ERP redevient strictement celui d'avant**, sans redéploiement. Les données `par_*` sont conservées (ré-allumables).

## Registre des décisions liées

Voir `00-ANCRAGE.md` : ADR-P01 (drapeau), ADR-P02 (CA dérivé des BC), ADR-P03 (certifs sur consultants existants), ADR-P07 (CA confidentiel), ADR-P08 (relances email), ADR-P09 (Actualité + CODIR), ADR-P10 (ClickUp liste dédiée).
