# 07 — Recette & activation du module Contrats de maintenance

> Runbook opérationnel. Le module est **livré, fusionné dans `main`, et éteint par défaut**
> (`config/mntFeature`). Ce document décrit comment le **recetter** puis l'**activer** en production,
> et comment **revenir en arrière** sans redéploiement. À jour au 2026-07-15 (Lots 0→5 + audit).

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
| 8 callables/cron (`upsert/deleteMntContrat`, `upsert/deleteMntTicket`, `upsert/deleteMntIntervention`, `submitMntDecision`, `mntSlaSweep`) | `functions/index.js` + `deployed-functions.txt` | `check-deploy-targets.mjs` |
| Règles `mnt_*` + `summaries/mnt_risque` (double verrou drapeau + droit) | `firestore.rules` | `test:rules` |
| Bloc recompute `summaries/mnt_risque` gaté | `functions/lib/aggregate.js` | `mntRecomputeGate.test.js` |
| Écran lazy `maintenance` | `web/src/modules/maintenance.tsx` + `MODULES[]` | `check-bundle.mjs` |

> **Secret e-mail** : le digest quotidien `mntSlaSweep` (07:30) utilise `GRAPH_CLIENT_SECRET` (déjà
> provisionné pour `alertDigest`/`emailRelancesDigest`). Aucun nouveau secret requis. Sans config
> e-mail (`config/emailNotify`), le cron est un no-op silencieux.

## 2. Recette en bac à sable (drapeau allumé sur un environnement de test)

Allumer `config/mntFeature` puis dérouler ce parcours. **Chaque étape a un critère de succès mécanique.**

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
