# 07 — Recette & activation du module Contrats de maintenance

> Runbook opérationnel. Le module est **livré, fusionné dans `main`, et éteint par défaut**
> (`config/mntFeature`). Ce document décrit comment le **recetter** puis l'**activer** en production,
> et comment **revenir en arrière** sans redéploiement.
>
> **Mis à jour le 2026-07-24** (audit adverse + lot allocation revenu). Le module a été **fortement enrichi**
> depuis les Lots 0→5 : le parcours R1→R12 (§2) couvre le **socle** (contrat, ticket, intervention, SLA,
> échéancier, renouvellement, risque) ; les **surfaces additionnelles** livrées depuis (§2bis) — IA, import,
> calendrier, auto-statut, versions, abonnements, centre de surveillance, MRR, astreintes, reconnaissance du
> revenu — sont listées avec leur intention de recette. La surface réelle est de **~19 callables `mnt`** (voir
> `functions/deployed-functions.txt`), non plus 8.

## 0. Principe

Le module est **derrière un drapeau unique** `config/mntFeature` (ADR-009). Drapeau éteint ⇒ l'ERP est
**strictement celui d'avant** (invariant testé : recompute octet-pour-octet identique ; CRA/TACE/marge
inchangés — cf. `mntRecomputeGate.test.js`, `timesheet.test.js`, ADR-018). L'activation ne se déploie
pas : elle **s'allume**. Le retour arrière **s'éteint**.

Trois interrupteurs, dans cet ordre :

1. **Déploiement** du code (fonctions + rules + index) — inerte tant que 2 et 3 ne sont pas faits.
2. **RBAC** : donner le droit `maintenance` aux rôles concernés (`config/permissions`).
3. **Drapeau** : `config/mntFeature = { enabled: true }`.

## 1. Pré-requis de déploiement

Tout est déjà sur `main`. Vérifier que le déploiement de prod embarque bien :

| Élément | Où | Garde CI |
|---|---|---|
| **~19 callables + cron** `mnt` — socle : `upsert/deleteMntContrat`, `upsert/deleteMntTicket`, `upsert/deleteMntIntervention`, `submitMntDecision`, `mntSlaSweep` ; enrichissements : `importMntContrats`, `aiSuggestMntContrats`, `aiMntLignees`, `applyMntLignee`, `aiMntContratStatut`, `setMntContratStatut`, `revertMntAutoStatut`, `submitAstreinte`, `listAstreintes`, `aiAnalyzeChurn`, `mntContratPnl`, `setMntWatch`, `setMntCalendar`, `setMntFeature` | `functions/index.js` + `deployed-functions.txt` | `check-deploy-targets.mjs` |
| Règles `mnt_*` (double verrou drapeau + droit) sur **toutes** les collections : `mnt_contrats`, `mnt_engagementsSla`, `mnt_tickets`, `mnt_interventions`, `mnt_evenementsSla`, `mnt_contratsVersions`, `mnt_watches` ; `mnt_astreintes` (callable-only lecture ET écriture) ; summaries `mnt_risque`/`mnt_surveillance`/`mnt_mrr` | `firestore.rules` | `test:rules` |
| Bloc recompute gaté écrivant **3** summaries (`mnt_risque`, `mnt_surveillance`, `mnt_mrrSnapshot`) | `functions-shared/lib/aggregate.js` | `mntRecomputeGate.test.js` |
| Écran lazy `maintenance` | `web/src/modules/maintenance.tsx` + `MODULES[]` | `check-bundle.mjs` |

> **NB post-split** : le code serveur du module vit dans le package `@nt360/functions-shared` (`domain/mnt*.js`,
> `handlers/maintenance.js`, `lib/aggregate.js`, `test/`) ; `functions/index.js` (un seul codebase déployé)
> l'importe et déclare les exports. La garde `check-deploy-targets.mjs` vérifie l'ensemble des 5 codebases.

> **Secret e-mail** : le digest quotidien `mntSlaSweep` (07:30) utilise `GRAPH_CLIENT_SECRET` (déjà
> provisionné pour `alertDigest`/`emailRelancesDigest`). Aucun nouveau secret requis. Sans config
> e-mail (`config/emailNotify`), le cron est un no-op silencieux.

## 2. Recette en bac à sable (drapeau allumé sur un environnement de test)

Allumer `config/mntFeature` puis dérouler ce parcours. **Chaque étape a un critère de succès mécanique.**

> **Contrôle pré-vol (R0) — intégrité du CRA existant.** Le décompte TACE compte désormais les **mois
> calendaires distincts** (audit Lot 5) : sûr pour toute base alimentée par les callables (id `consultant_mois`
> déterministe → 1 doc/mois). Avant recette, confirmer qu'il n'existe **aucun doublon historique** :
> grouper `timesheets` par `(consultantId, month)` **en excluant `source == "mnt"`** et refuser si un groupe
> a `count > 1`. Si le contrôle est vert (garanti hors pollution manuelle directe), aucun chiffre TACE/marge
> existant ne bouge. S'il trouve un doublon legacy, le corriger AVANT d'allumer (fusion/suppression).

| # | Action | Critère de succès |
|---|---|---|
| R1 | Ouvrir l'onglet **« Contrats de maintenance »** (rôle avec droit `maintenance`) | L'onglet apparaît ; un rôle **sans** le droit ne le voit pas |
| R2 | Créer un contrat sur un **N° FP existant** (`FP/2026/x`), statut `actif`, échéance mensuelle, montant engagé, 1 engagement SLA (résolution, 8 h, couverture `ouvre_lun_ven`) | Contrat listé ; montant affiché en FCFA entier ; dates en `JJ/MM/AAAA` |
| R3 | Rouvrir le contrat → bloc **Échéancier** | Engagé = montant × échéances dues ; Facturé = Σ factures de l'affaire (par `fpKey`) ; écart cohérent |
| R4 | Ouvrir un **ticket** sous ce contrat, priorité `haute` | Ticket listé ; colonne **SLA résolution** affiche « En cours » |
| R5 | Passer le ticket `en_cours` puis `resolu` | Horodatages posés ; SLA « Respecté » si dans le seuil, « Rompu » sinon (jours ouvrés ; `h24` = 24/7) |
| R6 | Saisir une **intervention** (consultant, date, heures) | Le **CRA** du consultant intègre les heures (÷ 8 = jours) le mois concerné (module allumé) |
| R7 | Vérifier **TACE** (Activité) du consultant | Le mois avec CRA manuel **et** maintenance compte **une fois** (pas de double-mois) ; TACE reflète l'activité totale |
| R8 | Vérifier **Rentabilité par ressource** + **Pré-facturation** | Les jours de maintenance **n'y apparaissent pas** (forfait, ADR-005 / 2A) — pas de double facturation |
| R9 | Depuis le contrat, **« Demander le renouvellement »** | Une entrée apparaît dans **Approbations** (routée au manager, sinon direction) ; décidable via `decideApproval` |
| R10 | Lancer **Recalculer** (recompute) puis ouvrir la carte **« Risque des contrats »** | Le contrat porte un **score** + palier (Vert/Ambre/Rouge/Critique) ; les KPI par palier somment au total |
| R11 | Forcer un signal (échéance < 60 j, SLA rompu, quota dépassé, sous-facturation) puis recompute | Le contrat monte de palier ; les signaux listés sont exacts |
| R12 | **Éteindre** le drapeau (`enabled:false`) | L'onglet disparaît ; TACE/marge/pré-facturation **redeviennent celles d'avant** ; aucun `summaries/mnt_risque` ; digest cron no-op |

## 2bis. Surfaces additionnelles (livrées depuis les Lots 0→5)

Enrichissements ajoutés après le socle. Chacun reste **gaté par le drapeau + le droit `maintenance`** (donc
inerte à drapeau éteint, invariant tenu) ; à recetter en plus de R1→R12. Intention de recette (le critère
mécanique précis est à figer avec la donnée réelle en bac à sable) :

| # | Surface | Callable / collection | Intention de recette |
|---|---|---|---|
| R13 | **Calendrier SLA** (ADR-P23) | `setMntCalendar` / `config/mntCalendar` | Régler fuseau/fériés/fenêtre B2B → l'horloge SLA des tickets change en conséquence ; **absent** = horloge historique (UTC, Lun–Ven). Édition refusée drapeau éteint (garde ajoutée, audit 24/07). |
| R14 | **Import de contrats** | `importMntContrats` | Import d'un lot de contrats (aperçu → validation) ; rapproché par `fpKey` ; rate-limit « heavy ». |
| R15 | **Suggestions IA** (contrats sans FP, lignées) | `aiSuggestMntContrats`, `aiMntLignees`, `applyMntLignee` | L'IA propose des affaires récurrentes / des lignées ; création **sur validation** (jamais auto) ; cap `CAP_AI`, rate-limit « ai ». |
| R16 | **Statut automatique** | `aiMntContratStatut`, `setMntContratStatut`, `revertMntAutoStatut` | Proposition/application de statut ; **révocable** ; sortie IA re-validée (énum, fp connus). |
| R17 | **Versions de contrat** (opposabilité SLA) | `mnt_contratsVersions` | Toute modification versionne ; les engagements opposables à un ticket sont ceux figés à son ouverture (snapshot). |
| R18 | **Abonnements** | `setMntWatch` / `mnt_watches` | « Suivre » un contrat / le parc ; « Mes abonnements » filtre le centre de surveillance ; isolé par utilisateur (rules `uid`). |
| R19 | **Centre de surveillance** | `summaries/mnt_surveillance` | Après recompute, flux d'événements (SLA/échéance/quota/sous-facturation) trié par gravité, en direct. |
| R20 | **MRR/ARR** (snapshot + tendance) | `summaries/mnt_mrrSnapshot` | Le recompute produit un snapshot quotidien ; la tendance MRR s'affiche ; le MRR live vient de `recurringRevenue`. |
| R21 | **Astreintes** (ADR-035) | `submitAstreinte`, `listAstreintes` / `mnt_astreintes` | Demande d'astreinte (montant = **charge confidentielle**) → workflow d'approbation ; **montant masqué** sans droit `rentabilite` (y compris webhook sortant, audit 24/07) ; comptabilisée en coût à la validation. |
| R22 | **Rentabilité contrat** (ADR-033/034/081) | `mntContratPnl`, `aiAnalyzeChurn` | Marge = revenu engagé − (interventions + P&L affaire + astreintes) ; coûts **masqués** sans `rentabilite` ; le palier de marge (jamais le montant) entre dans le score de risque. |
| R23 | **Reconnaissance du revenu (consolidée)** (lot 24/07) | dérivé `summaries/mnt_risque` | Onglet pilotage : reconnu (engagé) vs facturé **plafonné à l'engagé** par FP vs à facturer ; cohérent avec la table de risque (même source). |

## 3. Activation en production

Une fois la recette validée :

1. **Déployer** `main` (fonctions + rules + index) par le pipeline habituel.
2. **RBAC** — via l'écran **Habilitations** (direction) ou le callable `setPermissions` : ajouter la clé
   `maintenance` aux rôles voulus. Défaut recommandé (à arbitrer par la direction) :
   - `direction` : `write` (déjà superviseur partout) ;
   - `pmo` : `write` (pilotage opérationnel des contrats/tickets) ;
   - `commercial_dir` / `commercial` : `read` (visibilité risque/renouvellement de leurs affaires) ;
   - autres rôles : `none` (défaut).
   > Ajouter la clé `maintenance` **ne modifie aucun autre droit** (additivité testée, `mnt-caracterisation.test.js`).
3. **Allumer le drapeau** — écrire le document `config/mntFeature` :
   ```
   config/mntFeature  =  { enabled: true }
   ```
   Il n'existe pas encore de bascule dans l'UI : l'écriture se fait via la **console Firestore** (base
   nommée `nt360`) ou l'Admin SDK, par un administrateur. *(Amélioration optionnelle future : un toggle
   en Habilitations — non requis pour l'activation.)*
4. **Vérifier** R1 + R12 en production (allumé puis, si besoin de prudence, éteint/rallumé).

## 4. Retour arrière (rollback)

**Immédiat, sans redéploiement** : écrire `config/mntFeature = { enabled: false }`.
- Onglet masqué, callables refusés, `summaries/mnt_risque` illisible, recompute no-op, digest no-op,
  contribution CRA maintenance écartée de TACE/marge/pré-facturation → **ERP strictement d'avant**.
- Les données `mnt_*` déjà saisies **restent** (non détruites) et **redeviennent inertes** ; elles
  réapparaissent à la prochaine activation. Aucune migration, aucun nettoyage requis.

Rollback plus profond (retirer la surface) : retirer la clé `maintenance` de `config/permissions` et
l'entrée de nav — additif, réversible (cf. `04-PLAN-INTEGRATION.md` §5).

## 5. Limites connues (v1, tracées par ADR)

- **Jours fériés** ignorés dans le SLA (ADR-006) ; `h24` = 24/7 strict (ADR-017).
- **Marge nette maintenance** (coût réel des interventions) non suivie : le module valorise le forfait
  (`montantEngage`, ADR-005), pas le TJM des jours d'intervention (ADR-018). P&L maintenance dédié = évolution.
- **Historique fin des ruptures SLA** non matérialisé (seul l'état courant + le score le sont, ADR-015/003).
- **Toggle de drapeau in-app** absent (activation par écriture Firestore, cf. §3.3).

> **Le module est prêt pour la recette.** Rien ne se passe tant que le drapeau n'est pas allumé.
