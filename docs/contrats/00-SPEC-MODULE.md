# 00 — Le module en un document

> **Ce document est la référence du besoin. Il n'est jamais modifié pendant l'intégration.**
> Il est le condensé de la SFD v2. En cas de conflit entre ce document et l'existant de l'ERP,
> c'est l'existant qui gagne sur la forme, et ce document qui gagne sur le fond.

## Ce que le module doit faire

Piloter le portefeuille de contrats de maintenance client par le **risque**, et non par la date :
anticiper les pertes de contrat, anticiper les ruptures de SLA, connaître la marge réelle, et
ne jamais être engagé sans être couvert par le support éditeur.

## Les trois défaillances à éradiquer

1. **Renouvellement subi** — contrat découvert échu, tacite reconduction d'un contrat déficitaire, client qui part sans signal.
2. **Non-conformité SLA découverte a posteriori** — pénalité réclamée sans que l'ESN puisse contredire les chiffres.
3. **Rupture de couverture back-to-back** — support éditeur expiré ou licence jamais activée alors que le contrat client court.

## Les entités

```
TIERS (existe déjà dans l'ERP) ──< CONTRAT ──< VERSION_CONTRAT
                                      ├──< ENGAGEMENT_SLA
                                      ├──< COUVERTURE_B2B
                                      ├──< QUOTA
                                      ├──< ECHEANCE_FACTURATION ──> FACTURE (existe déjà)
                                      ├──< LIGNE_COUT ──────────> ACHAT / TEMPS (existent déjà ?)
                                      ├──< TICKET ──< INTERVENTION
                                      │        └──< EVENEMENT_SLA
                                      ├──< SCORE_RISQUE
                                      ├──< SIGNAL
                                      └──< DECISION
```

## Les modules

| # | Module | Essentiel |
|---|---|---|
| M1 | Référentiel des contrats | Versionné. Un avenant ne modifie rien, il crée une version. |
| M2 | Échéances et renouvellements | Cadence pilotée par le **score**, pas par la date seule. |
| M3 | SLA, tickets, interventions | Calcul en **heures ouvrées**, calendrier du pays du client. |
| M4 | Rentabilité et marge | Temps × coût horaire chargé + achats back-to-back au prorata. |
| M5 | Facturation et MRR | L'ERP facture. Le module planifie et réconcilie. |
| M6 | Moteur de risques | 4 scores : renouvellement, SLA, couverture, santé client. |
| M7 | Aide à la décision | Bilan de contrat, prix recommandé, matrice valeur × risque. |
| M8 | Conformité et preuve | Rapport opposable, recalcul rétroactif à date. |
| M10 | Qualité de la donnée | Complétude, contrôles, réconciliation. |

## Les règles non négociables

| # | Règle | Pourquoi |
|---|---|---|
| R1 | **Le SLA dérive d'un flux d'événements immuables**, jamais de champs modifiables | Un champ éditable ne prouve rien devant un client qui réclame une pénalité |
| R2 | **Le contrat est versionné.** Rien n'est écrasé | Condition de l'opposabilité : « quel SLA s'appliquait le 12 mars ? » |
| R3 | **Un contrat ne peut être activé sans couverture back-to-back confirmée** | Sinon on s'engage sans être couvert |
| R4 | **Le score est explicable** : il expose ses contributions chiffrées | Un score sans explication n'est pas actionnable et sera rejeté |
| R5 | **Le score ordonne et recommande. Il ne décide pas** | Un humain tranche, et sa décision est tracée |
| R6 | **Un contrat sous 90 % de complétude est exclu du scoring** | Un score sur donnée creuse est un mensonge autoritaire |
| R7 | **Le calcul SLA est en heures ouvrées**, selon la plage contractuelle et les jours fériés du pays | CI, SN, BF, ML, CM, CF, GN n'ont pas le même calendrier |
| R8 | **Le moteur de risques vient en dernier** | Il dépend de tout le reste. Livré tôt, il produit des scores faux et tue l'outil |

## Le score de risque de renouvellement

Somme pondérée, paramétrable, versionnée. Pas de modèle statistique en V1.

| Famille | Poids |
|---|---|
| Qualité de service perçue | 25 % |
| Santé économique du contrat | 15 % |
| Engagement et usage | 15 % |
| Relation commerciale | 15 % |
| Signaux financiers | 15 % |
| Contexte technique et marché | 15 % |

Classes : Vert 0-30 · Ambre 31-55 · Rouge 56-75 · Critique 76-100.
Priorisation = score × facteur d'urgence (0,5 à >18 mois → 1,5 à <90 jours).

## Les formules

```
Revenu reconnu (P) = Σ montant_annuel_version × (mois de P / 12) + interventions refacturées
Coûts (P)          = coût_b2b au prorata + Σ(heures × coût horaire chargé) + frais + sous-traitance + pièces
Marge brute        = Revenu − Coûts
Prix recommandé    = Coûts constatés / (1 − marge cible)
MRR                = Σ montant_annuel des contrats actifs / 12, arrêté mensuel, historisé
```

## Ce qui existe probablement déjà dans l'ERP et ne doit pas être recréé

Tiers · factures · règlements · balance âgée · achats · fournisseurs · plan analytique ·
devises et taux · employés et **coûts horaires chargés** · **feuilles de temps** ·
notes de frais · **calendriers et jours fériés (souvent dans la paie)** · droits ·
workflow de validation · notifications · ordonnanceur · journal d'audit ·
séquences de numérotation · pièces jointes · exports.

**La phase 1 a pour seul objet de vérifier lesquels.**
