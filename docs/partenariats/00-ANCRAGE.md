# Partenariats & Certifications — Plan d'ancrage dans nt360

> Module « plug-and-play » (kit `kit-neurones-partenariats`) intégré **à l'intérieur** de nt360, ERP en
> production. La réussite se mesure à deux choses : **rien d'autre n'a bougé** et le module est
> **indiscernable** du reste de l'ERP. Ce document est le livrable des phases 0→3 (empreinte du kit,
> résolution des collisions, plan d'ancrage). Il précède tout code applicatif de données.

## 1. Le kit en une phrase

Suivi des partenariats constructeurs (Dell, Cisco, Fortinet, Huawei) et des certifications des
ingénieurs, avec trois liens métier : **RH** (statut de certification → quotas partenaires), **CA**
(chiffre d'affaires par partenaire dérivé des BC fournisseurs), **assignations** (affectation de
certifications, échéances, relances). Plus IA (plan d'action business + synthèse QBR) et export
PowerPoint QBR.

## 2. Cartographie du kit (source : agents de Phase 0)

- **Collections proposées par le kit** : `partners` (+ sous-collections `tiers`/`competencies`/
  `certificationCatalog`/`requirements`), `partnershipStatus` (dérivé), `certEngineers`
  (+ `certifications`), `purchaseOrders` (BC), `partnerAlerts` (dérivé), `certificationCounts`
  (dérivé), `certificationAssignments`.
- **Logique pure** : `compliance.js` (statut certif, couverture quota, statut partenariat),
  `revenue.js` (agrégation CA depuis BC), `aiActionPlan.js`/`aiQbr.js` (prompts + parsing IA).
- **6 Cloud Functions** : `onCertificationWrite`, `onPurchaseOrderWrite`, `dailyLifecycleJob` (06:00),
  `assignmentReminderJob` (06:30), `generateActionPlan` (IA), `generateQbr` (IA).
- **Défauts connus du kit** (à NE PAS reporter) : clé de `certificationCounts` incohérente
  (écriture 3 segments vs lecture 2), `expiryDate` jamais persistée par une CF, contrat de
  `computeCoverage` incohérent avec la forme réelle des données, `businessPlans` annoncé mais non
  implémenté, clé API exposée côté client en mode démo.

## 3. Écarts structurants kit ↔ nt360

| Point | Kit | nt360 (règle qui gagne) |
|---|---|---|
| Base Firestore | `getFirestore()` = `(default)` | base **nommée** `nt360` (`FIRESTORE_DB`) — **obligatoire** sur triggers |
| Devise | EUR en dur (`M€`/`k€`) | pivot **XOF/FCFA**, entier sans subdivision (`fmt`, `T.*`) |
| Modèle IA | `claude-sonnet-4-6`, `fetch` brut, secret `ANTHROPIC_KEY` | `@anthropic-ai/sdk`, `claude-opus-4-8`, `thinking:{type:"adaptive"}`, gestion `refusal`, secret `ANTHROPIC_API_KEY` (patron `lib/aiChurn.js`) |
| Dépendances | réintroduit `xlsx@0.18` (CVE-2023-30533) + `pptxgenjs` | `xlsx` **interdit** (déjà migré vers `exceljs`) ; `pptxgenjs@4.0.1` déjà présent (web, lazy) |
| Design | thème sombre HUD autoportant (`--nx-*`) | tokens `T.*` + primitives `web/src/design/` |
| Rôles | `commercial` / `rh` / `tech_lead` (`request.auth.token.role`) | claim `nt360Role`, 7 rôles fixes + **clés de module** (matrice `config/permissions`) |
| Espace de noms | aucun préfixe | préfixe de module **obligatoire** (le module maintenance impose `mnt_`) |

## 4. Résolution des collisions (Phase 0 — vérifiée par recherche exhaustive du code)

Les six noms du kit (`partners`, `certEngineers`, `purchaseOrders`, `partnerAlerts`,
`partnershipStatus`, `certificationCounts`) sont **tous libres** dans la base de code nt360. Aucune
collision. Mais deux d'entre eux **recréeraient une vérité existante** → interdit absolu
(« ne recrée pas ce qui existe » / piège « deuxième vérité ») :

- **`purchaseOrders` = les BC fournisseurs.** nt360 stocke déjà tous les BC fournisseurs dans la
  collection **`bcLines`** (`supplier`, `amountXof`, `fp`, `status`), avec une autorité d'agrégation
  `functions/domain/fournisseurs.js` (`suppliers()`). → **ADR-P02** : le CA partenaire dérive de
  `bcLines`, PAS d'une collection parallèle.
- **`certEngineers` = les ingénieurs.** nt360 a déjà la collection **`consultants`** (annuaire des
  ressources ESN : `name`, `grade`, `bu`, `tjmTarget`, `cjm` confidentiel, `skills[]`, `status`). →
  **ADR-P03** : les certifications s'attachent aux consultants existants, PAS à un second annuaire.

## 5. Espace de noms retenu : préfixe `par_`

Toutes les collections/summaries/callables spécifiques au module portent le préfixe **`par_`** (ou
`par`+Capitale pour les callables camelCase). Même intention que `mnt_` : la frontière du module est
visible à l'œil nu. Les deux collections « collapsées » (§4) ne créent PAS de nouvelle collection —
elles réutilisent `bcLines` et `consultants` via des overlays/sous-collections préfixés `par_`.

Collections/artefacts du module (additifs uniquement) :

| Artefact nt360 | Rôle | Origine kit |
|---|---|---|
| `par_partners/{id}` (+ sous-coll. `tiers`/`competencies`/`certificationCatalog`/`requirements`) | référentiel partenaires + catalogue de certifs | `partners` |
| `par_certifications/{id}` | certifications d'un ingénieur (top-level, RÉFÉRENCE `consultantId` ; NOM/BU/grade dénormalisés, jamais le CJM) | `certEngineers/.../certifications` |
| `par_assignments/{id}` | assignations de certification (échéances, relances) | `certificationAssignments` |
| `config/parPartnerMap` | overlay `supplier → partnerId` (patron `config/clientAliases`) | `PARTNER_MAP` (script) |
| `summaries/par_status`, `summaries/par_quotas`, `summaries/par_alerts` | agrégats **dérivés** (statut partenariat, quotas/couverture, alertes cycle de vie) via recompute | `partnershipStatus` / `certificationCounts` / `partnerAlerts` |
| `config/parFeature` | drapeau de fonctionnalité (Lot 0) | — |

Note : les états **dérivés** (statut partenariat, quotas, alertes) deviennent des **summaries**
recalculés par l'orchestrateur (`lib/aggregate.js`), comme `summaries/mnt_risque` — pas des
collections écrites par trigger. Cela réutilise l'autorité de recompute sérialisée existante et évite
le bug de clé `certificationCounts` du kit.

## 6. Rôles / RBAC

Pas de nouveau rôle (`rh`/`tech_lead` n'existent pas et créer un rôle touche le socle RBAC partagé →
hors périmètre additif). On ajoute une **clé de module** `partenariats` à la matrice `config/permissions`
(donnée, pas code), mappée sur les 7 rôles existants. `direction` court-circuite (write partout). Les
montants confidentiels (CA achat, marge, CJM) restent gardés par le droit `rentabilite` /
`direction`, comme les astreintes.

## 7. Séquence des lots (un lot = une branche = une revue = un PR)

0. **Drapeau + socle** (CE PR) : `config/parFeature`, `domain/parFeature.js` + miroir front,
   `moduleFlagOn` généralisé, `setParFeature` (direction), toggle Habilitations, règle de lecture du
   drapeau. Aucune surface visible tant qu'éteint. **ERP strictement inchangé.**
1. **Données référentiel** : `par_partners` + catalogue (pur `domain/parPartners.js` + validation +
   callables gatés + rules + seed XOF + tests).
2. **Certifications sur consultants** : sous-coll. `par_certifications` + logique de conformité pure
   (`domain/parCompliance.js`, adaptée à la forme réelle des données) + callables RH + tests.
3. **Lien CA** : overlay `config/parPartnerMap` + dérivation du CA partenaire depuis `bcLines`
   (`domain/parRevenue.js`) + summary `par_status` via recompute + tests de parité.
4. **Quotas & alertes cycle de vie** : couverture quota (summary `par_quotas`), alertes
   J-90/60/30/7/0 (summary `par_alerts`) via le sweep planifié gaté drapeau.
5. **Assignations & relances** : `par_assignments` + relances J-30/14/7 (réutilise le patron
   `approvals`/surveillance) + tests.
6. **Front** : module lazy `web/src/modules/partenariats.tsx` (tokens `T.*`, primitives), onglet gaté,
   câblage temps réel `useCollectionData`.
7. **IA + QBR** : `generateParActionPlan` / `generateParQbr` (patron `lib/aiChurn.js`, Opus, refusal) +
   export QBR PPTX (patron `codirPptx.ts`, lazy, XOF).

Puis **audit** utilisateur + technique (agents `gardien`/`conformiste`).

---

## Registre des décisions (ADR)

### ADR-P01 — Drapeau de fonctionnalité `config/parFeature`
**Contexte** : le module doit s'éteindre sans redéploiement, et à drapeau éteint l'ERP doit être
strictement celui d'avant. **Décision** : reproduire à l'identique le patron `mntFeature`
(overlay `config/parFeature {enabled}`, prédicat pur `isParEnabled` back+front, callable `setParFeature`
direction-only, écriture Admin SDK avec `write:false` en rules, toggle Habilitations). Généraliser
`moduleFlagOn(flag, enabledByFlag)` pour qu'il ne code plus `"mntFeature"` en dur mais résolve chaque
drapeau via une table indexée par nom (contribuée dans `App.tsx`). **Conséquence** : chaque futur
module gaté ajoute une entrée à la table, sans toucher le résolveur. **Séquencement** : Lot 0 pose le
socle (overlay, prédicat pur back+front, callable, toggle, rule) SANS toucher `App.tsx`/`moduleFlagOn`
— tant qu'aucun onglet ne porte `flag:"parFeature"`, le front reste byte-for-byte identique. La
généralisation de `moduleFlagOn` + le câblage `App.tsx` accompagnent l'enregistrement de l'onglet
(Lot 6). Statut : **socle acté (Lot 0)** ; front gaté **à câbler (Lot 6)**.

### ADR-P02 — Le CA partenaire dérive des BC fournisseurs existants (`bcLines`), pas d'une collection `purchaseOrders`
**Contexte** : le kit crée `purchaseOrders` pour porter les BC constructeur ; or nt360 stocke déjà
tous les BC fournisseurs dans `bcLines`, avec une autorité d'agrégation (`domain/fournisseurs.js`).
Créer `purchaseOrders` serait une **deuxième vérité** des achats fournisseurs (interdit absolu).
**Décision** : dériver le CA par partenaire de `bcLines`, en résolvant `supplier → partnerId` via un
overlay `config/parPartnerMap` (patron `config/clientAliases`/`config/fpAliases`). **Conséquence** :
zéro double saisie, cohérence garantie avec le module Fournisseurs. Le CA du kit devient un agrégat
dérivé (summary), recalculé par l'orchestrateur. Statut : **acté (Lot 3)**.

### ADR-P03 — Les certifications s'attachent aux consultants existants, pas à un annuaire `certEngineers`
**Contexte** : le kit crée `certEngineers` (annuaire d'ingénieurs) ; or nt360 a déjà `consultants`
(annuaire des ressources ESN, avec `skills[]`). Créer `certEngineers` serait un **second annuaire des
personnes** (deuxième vérité). **Décision** : les certifications RÉFÉRENCENT un consultant existant par
`consultantId`. **Raffinement de stockage (Lot 2)** : elles vivent en collection **top-level
`par_certifications`** (et non en sous-collection de `consultants`, callable-only + CJM confidentiel) —
la donnée de certif n'est pas confidentielle et se lit sous le seul droit `partenariats`. L'écriture
`upsertParCertification` VALIDE l'existence du consultant (sinon on créerait une personne fantôme) et
dénormalise NOM/BU/GRADE — **jamais le CJM**. Le statut RH et l'alimentation des quotas partent des
consultants. **Conséquence** : un « ingénieur certifié » est un consultant ; s'il manque à l'annuaire,
c'est une lacune de données à corriger honnêtement, pas un motif de second annuaire. Statut : **acté
(Lot 2)**.

### ADR-P04 — États dérivés en summaries recompute, pas en collections écrites par trigger
**Contexte** : le kit matérialise `partnershipStatus`/`certificationCounts`/`partnerAlerts` via des
triggers (`onCertificationWrite`/`onPurchaseOrderWrite`), avec un bug de clé de quota. **Décision** :
ces états **dérivés** deviennent des summaries (`summaries/par_*`) recalculés par `lib/aggregate.js`
sous le verrou de recompute existant, comme `summaries/mnt_risque`. **Conséquence** : réutilise
l'autorité de recompute sérialisée, évite le bug de clé, et respecte l'invariant « même métrique = même
nombre » (le front re-dérive du même summary). Statut : **acté ; par_ca en Lot 3, par_quotas/par_alerts en Lot 4)**.

### ADR-P06 — Référentiel partenaire EMBARQUÉ (par_partners), exigences aplaties
**Contexte** : le kit éclate le référentiel partenaire en sous-collections (`tiers`, `competencies`,
`certificationCatalog`, `requirements`) et imbrique les exigences par niveau (objet keyé par tierId).
**Décision** : `par_partners/{id}` porte le référentiel COMPLET en structures **embarquées** (arrays
`tiers`/`competencies`/`certificationCatalog`/`requirements`), sur le même idiome que les engagements
SLA embarqués du module maintenance (ADR-012). Les exigences sont **aplaties** en tableau (`tierId`
embarqué). **Conséquence** : lecture en un doc (temps réel `onSnapshot`), validation PURE d'un seul
objet avec **intégrité référentielle** vérifiée (une exigence pointe un niveau + une cible connus ;
une certif pointe une compétence connue) — corrige au passage l'incohérence de contrat `computeCoverage`
du kit. L'écriture REMPLACE le référentiel (sémantique « je pose l'état »), adaptée à une donnée de
référence pilotée par la direction/steward. Statut : **acté (Lot 1)**.

### ADR-P05 — Convention IA nt360 imposée
**Décision** : les appels IA du module (`generateParActionPlan`, `generateParQbr`) suivent le pont
`lib/aiChurn.js` : `@anthropic-ai/sdk`, modèle `claude-opus-4-8`, `thinking:{type:"adaptive"}`, gestion
`stop_reason==="refusal"`, secret `ANTHROPIC_API_KEY`, sortie re-validée par un domaine pur, `logOps`
sur l'usage seul (jamais le contenu). Le `fetch` brut + `sonnet-4-6` + `ANTHROPIC_KEY` du kit sont
abandonnés. Statut : **acté (à implémenter Lot 7)**.
