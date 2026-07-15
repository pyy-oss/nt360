# 04 — Plan d'intégration

> Rempli par `/3-plan`. Chaque proposition est adossée à une observation des phases 0 à 2.
> Décisions structurantes : ADR-001..010 (`05-DECISIONS.md`), toutes **Acceptées**.

## 1. Ancrage

> Le module se pose **dans les couches de l'ERP telles qu'observées en phase 0 §3**, pas dans une
> architecture idéale. nt360 est un monorepo Firebase serverless : le module est un ensemble de
> fichiers `domain/` purs + `handlers/` I/O + un écran `web/src/modules`, exactement comme les
> lots existants (Consultant, Fiche affaire…).

| Élément du module | Emplacement dans l'ERP | Convention suivie |
|---|---|---|
| Règles SLA / risque (PURES) | `functions/domain/mntSla.js`, `mntRisque.js` | `domain/*` pur + test vitest (règle B.1/B.4) |
| I/O & callables | `functions/handlers/maintenance.js` (patron d'injection `{db,logger,FieldValue,onSchedule}`) | comme `handlers/outbound.js:16` |
| Exports de callables | `functions/index.js` (require + ré-export) + `functions/deployed-functions.txt` | déploiement par nom (CLAUDE.md) |
| Écran(s) | `web/src/modules/maintenance.tsx` (lazy) enregistré dans `MODULES[]`/`GROUPS[]` | `web/src/modules/index.tsx:60,100` |
| Hooks lecture | `useDocData`/`useCollectionData` (temps réel) | `web/src/lib/hooks.ts` |
| Miroirs de calcul front | `web/src/lib/mntSla.ts` (miroir exact de `domain/mntSla.js`) | comme `ids.ts`/`projection.ts` |
| Agrégats | `summaries/mnt_risque` via `lib/aggregate.js` (gate `want("maintenance")`) | ADR-003 |
| Config / overlays | `config/mntFeature` (drapeau), `config/mntFeries` (différé) | overlays `config/*` (Phase 0 §4.4) |
| RBAC | module `maintenance` dans `config/permissions` ; `requireWrite/Read(req,"maintenance")` | `firestore.rules`, `index.js:574` |
| Design | primitives `web/src/design/*` + tokens `T.*` (aucune valeur en dur) | règle C / H4 |

## 2. Schéma de données

### 2.1 Tables créées (préfixe `mnt_`)

> Conventions ERP : collections camelCase, montants `number` (arrondi FCFA entier), dates métier
> string ISO `AAAA-MM-JJ`, horodatage `updatedAt`/`ts` (Timestamp), statuts en **code applicatif**
> (comme `stage`), clé d'affaire = **N° FP** rapproché par `fpKey`. Nommage `mnt_` (ADR-010).

| Table | Rôle | Clé (id) | Colonnes structurantes | FK vers l'existant |
|---|---|---|---|---|
| `mnt_contrats` | Le contrat de maintenance | `safeId(fp)` (1 contrat = 1 affaire, ADR-001) | `fp` (canon), `client` (canon), `bu`, `am`, `statut` (brouillon/actif/suspendu/echu/resilie), `dateDebut`/`dateFin` (ISO), `montantEngage` (number XOF), `deviseEngage`, `echeanceType` (mensuel/trimestriel/annuel), `visibleTo` (record-level), `updatedAt`, `uid` | `fp`→`orders`/`fiches` (via `fpKey`) ; `client`→`accounts` (via `clientKey`) |
| `mnt_engagementsSla` | Engagements SLA d'un contrat (couverture, quota) | auto | `contratId`, `fp`, `type` (prise_en_compte/resolution), `seuilHeures` (number, ouvrées), `couverture` (ouvre_lun_ven/h24), `quota` (number) | `contratId`→`mnt_contrats` |
| `mnt_tickets` | Demande / incident sous contrat | auto | `contratId`, `fp`, `client`, `ouvertLe` (ts), `statut` (ouvert/en_cours/resolu/clos), `priorite`, `titre` | `contratId`→`mnt_contrats` |
| `mnt_interventions` | Travail réalisé sur un ticket | auto | `ticketId`, `contratId`, `consultantId`, `date` (ISO), `tempsPasse` (number) | `ticketId`→`mnt_tickets` ; `consultantId`→`consultants` |
| `mnt_evenementsSla` | Événement SLA (échéance/respect/rupture) | auto | `ticketId`, `engagementId`, `type`, `dueAt` (ISO), `metAt` (ISO\|null), `respecte` (bool) | `ticketId`→`mnt_tickets` |
| `summaries/mnt_risque` | Scores de risque **matérialisés** (ADR-003) | doc unique | `items[]` (par contrat : score, niveau vert/ambre/rouge/critique, signaux), `...stamp` | dérivé, recalculé par `aggregate.js` |
| `config/mntFeature` | Drapeau de fonctionnalité (ADR-009) | doc unique | `enabled` (bool) | — |
| `config/mntFeries` | Jours fériés (ADR-006, **différé v1**) | doc unique | `dates[]` (ISO) | — |

> **Montant du contrat (ADR-005)** : `mnt_contrats.montantEngage` = engagement propre ; la
> **facturation réelle reste l'ERP** (`invoices` rattachées par `fp`). L'échéancier compare engagé
> vs facturé — aucune double facturation, aucune 2ᵉ vérité de facture.

### 2.2 Tables NON créées, car réutilisées

| Besoin | Table/brique existante | Comment on s'y branche |
|---|---|---|
| Client / tiers | `accounts`/`contacts`, `config/clientAliases` | rattachement par nom canonique (`clientKey`), miroir serveur |
| Affaire (axe analytique) | `orders`/`fiches` + `fp` | **crochet** : `mnt_contrats.fp` rapproché par `fpKey` (ADR-001) |
| Facturation | `invoices` (HT) | échéancier lit les factures de l'affaire par `fp` (ADR-005) |
| Consultant / coût | `consultants` (TJM) | `mnt_interventions.consultantId` ; marge sur TJM de vente (ADR-007) |
| Temps passé | `timesheets`/CRA | effort réel ; pas de re-saisie du temps |
| Approbations | `approvals`, `domain/approval.js` | renouvellement = objet soumis (ADR-004) |
| Devises | `lib/fx.js`, `config/fxRates` | `toXof` + peg pour `montantEngage` en devise |
| Audit / RBAC / notif / cron / exports / UI | `auditLog`, matrice, `graphMail`, `onSchedule`, `exceljs`, `design/*` | cf. `03-ACCELERATEURS.md` (21 RÉUTILISER) |

### 2.3 Extensions additives sur l'existant

| Table/brique existante | Ajout | Motif | ADR | Réversible ? |
|---|---|---|---|---|
| `config/permissions` (matrice) | clé de module **`maintenance`** (défaut `none` pour tous les rôles) | RBAC du module | ADR-010 | Oui (retrait de la clé) |
| `firestore.rules` | bloc `match /mnt_*` + `summaryModule('mnt_risque')→'maintenance'` | cloisonnement | — | Oui (retrait du bloc) |
| `lib/aggregate.js` | calcul `summaries/mnt_risque` **gaté** `want("maintenance")` + drapeau | scores matérialisés | ADR-003 | Oui (gate → no-op) |
| `config/emailNotify`/digests | type de déclencheur « SLA à échéance/rompu » | notifications SLA | — | Oui (type additif) |
| `MODULES[]`/`GROUPS[]` | entrée `maintenance` (lazy) | nav front | — | Oui (retrait de l'entrée) |
| `firestore.indexes.json` | index composites `mnt_*` (par `fp`, `statut`+`dateFin`, `contratId`) | requêtes du module | — | Oui |
| `functions/deployed-functions.txt` | noms des callables `mnt*` + cron | déploiement par nom | — | Oui |

> **Aucune colonne ajoutée, aucun renommage, aucun changement de type sur une table existante.**
> Toutes les tables existantes sont lues, jamais modifiées structurellement (additif strict,
> motif **expand** seul ; pas de migrate/contract nécessaire car aucune donnée existante n'est
> retypée). Le rattachement se fait par lecture inverse sur `fp`, sans champ ajouté à `orders`.

## 3. Points de contact — le cœur du risque

> **Le tableau le plus important.** Chaque ligne est une occasion de casser quelque chose.

| # | Point de contact | Sens | Mécanisme | Risque de régression | Test de caractérisation | Couvert ? |
|---|---|---|---|---|---|---|
| C1 | `config/permissions` matrice RBAC | module→RBAC | ajout clé `maintenance` ; `level(m)` en rules | Une clé absente pour un rôle → `matrix()[role][m]` `undefined` ; ne doit **pas** casser `canRead` des autres modules | `test:rules` : chaque rôle existant conserve exactement ses accès actuels **après** ajout de la clé ; `maintenance` = `none` par défaut | ⬜ |
| C2 | `firestore.rules` blocs `mnt_*` | module→rules | nouveau `match` + `summaryModule` | Rule malformée → échec de déploiement des règles OU fuite ; `summaryModule` mal ordonné → mauvais gating | `test:rules` : lecture/écriture `mnt_*` refusée sans droit `maintenance` ET **drapeau off** ; les collections existantes gardent leur gating (caractérisation avant/après) | ⬜ |
| C3 | `lib/aggregate.js` (recompute) | module→recompute | ajout `summaries/mnt_risque` gaté `want("maintenance")` | **Risque majeur** : casser un summary existant ou le verrou sérialisé | test : recompute avec drapeau OFF → `summaries/*` existants **octet pour octet identiques** ; parité `consistencyAlertsDq.test.js` inchangée | ⬜ |
| C4 | `functions/index.js` exports + `deployed-functions.txt` | module→deploy | require handler + ré-export | `check-deploy-targets.mjs`/`check-no-undef.mjs` rouges → déploiement bloqué | les gardes CI elles-mêmes (exports ⊆ liste ; pas de ReferenceError) | ⬜ |
| C5 | `MODULES[]`/`GROUPS[]` (front) | module→nav | entrée lazy + `React.lazy` | Import non-lazy → dépasse le **budget bundle ≤120 KB** (chunk d'entrée) | `check-bundle.mjs` : chunk d'entrée reste ≤120 KB avec le module chargé | ⬜ |
| C6 | `approvals` (renouvellements) | module→workflow | soumission d'un type d'objet `mnt_renouvellement` | Un nouveau type casse le listing/la décision des approbations existantes | test : les approbations existantes (types actuels) listées/décidées à l'identique après ajout du type | ⬜ |
| C7 | `config/emailNotify` + digests (`graphMail`) | module→notif | type de déclencheur SLA additif | Toucher le digest → casser `alertDigest`/`emailRelancesDigest` existants | test : digests existants inchangés quand aucun contrat n'existe / drapeau off | ⬜ |
| C8 | Ordonnanceur (`onSchedule`) | module→cron | nouveau cron `mntSlaSweep` | Cron non déclaré dans `deployed-functions.txt` → déploiement ; charge Firestore | unit test du balayage (pur) + garde de déploiement | ⬜ |
| C9 | `firestore.indexes.json` | module→index | index composites `mnt_*` | `check-firestore-indexes.mjs` (pas d'index mono-champ) rouge | la garde CI elle-même | ⬜ |
| C10 | `config/mntFeature` (drapeau) | module→config | lecture serveur + gate front | Drapeau mal lu → module visible/actif alors qu'éteint | test : drapeau off ⇒ 0 surface `mnt_*` (front masqué, callables refusés, recompute no-op) — **ERP strictement d'avant** | ⬜ |
| C11 | `fpKey`/`plausibleYear` (autorités) | module→calcul | rapprochement contrat↔affaire | Contourner `fpKey` → double-compte / faux orphelins | test : rapprochement `mnt_contrats.fp`↔`orders.fp` passe par `fpKey` (jamais FP brut) | ⬜ |

**11 points de contact. C3 (recompute) et C10 (drapeau) portent le risque le plus élevé** : le
premier peut altérer des chiffres existants, le second est la garantie « éteint = ERP d'avant ».

## 4. Découpage en lots

> **Ordre imposé par les dépendances de données.** Le moteur de risque est le **dernier** lot :
> un score calculé sur un référentiel incomplet est un score faux (SFD).

| Lot | Livre (valeur vérifiable) | Touche | Ne touche pas | Drapeau | Retour arrière | Dépend de |
|---|---|---|---|---|---|---|
| **0 — Socle éteint** | Drapeau `config/mntFeature` (off) + clé RBAC `maintenance` (none) + coquille de module masquée. **ERP strictement identique.** | C1, C4, C5, C10 | données, recompute | créé, **off** | retirer clé + entrée nav | — |
| **1 — Contrat & SLA (données)** | Créer/éditer un `mnt_contrat` adossé au N° FP + ses `mnt_engagementsSla` ; liste + fiche (lazy). | C2, C4, C9, C11 | recompute, notif, risque | off | drapeau off + drop collections | 0 |
| **2 — Tickets & interventions** | Ouvrir un ticket sous contrat, saisir une intervention (consultant/temps). | C2, C4, C9 | recompute, risque | off | idem | 1 |
| **3 — Événements SLA & échéancier** | Calcul SLA jours ouvrés (`domain/mntSla.js` PUR) → `mnt_evenementsSla` ; échéancier engagé vs facturé (lecture `invoices` par `fp`). | C2, C11 | recompute risque | off | idem | 2 |
| **4 — Renouvellements** | Soumettre un renouvellement/résiliation via `approvals` (ADR-004). | C6 | recompute risque | off | retrait du type | 1 |
| **5 — Moteur de risque (DERNIER)** | Score matérialisé `summaries/mnt_risque` + signaux + notifications SLA. | **C3**, C7, C8 | — | off | gate `want` → no-op + drop summary | 1,2,3 |

Chaque lot = **une branche = une revue**, réversible indépendamment, drapeau `off` jusqu'à la
recette. Tests exigés : règle PURE + vitest (règle B.4), `test:rules` pour tout point de contact
RBAC/rules, gardes CI vertes.

## 5. Drapeau de fonctionnalité

| | |
|---|---|
| Mécanisme existant réutilisé ? | **Oui** — overlay `config/*` (patron des `config/cancelOrders`, `clickupSync`… Phase 0 §4.4) |
| Où le drapeau est déclaré | `config/mntFeature` `{ enabled: boolean }` (édité en Habilitations, direction) |
| Comment il est lu | **Serveur** : chaque callable `mnt*` et le gate `want("maintenance")` de `aggregate.js` lisent `enabled` ; refus/no-op si `false`. **Rules** : `match /mnt_*` exige `enabled==true`. **Front** : entrée `MODULES[]` masquée si off |
| Comportement à drapeau éteint | **strictement identique à avant** : aucune collection `mnt_*` lisible/écrite, aucun `summaries/mnt_*` calculé, aucune entrée de nav, aucun cron actif utile, aucune notification |
| Granularité | **module entier** (un seul drapeau). Les lots s'activent par déploiement successif ; le drapeau reste le maître-interrupteur |

## 6. Ce que le plan ne couvre pas

- **Jours fériés** (ADR-006) : v1 sans ; `config/mntFeries` créé seulement si réclamé.
- **Coût chargé / marge nette** (ADR-007) : v1 sur TJM de vente ; marge nette = ADR ultérieur.
- **Pièces jointes** (A2, ADR non requis) : pas de PJ en v1 ; Storage `mnt_docs/` si besoin confirmé.
- **Lettrage / encaissement** (A1) : le contrat lit le statut `paid` des factures ; pas de suivi
  d'encaissement propre.
- **Multi-entité juridique** : hors périmètre (l'ERP n'a pas de multi-société ; axe = BU).
- **Contrat multi-affaires** : exclu par ADR-001 (1 contrat = 1 N° FP) ; nouvel ADR si nécessaire.

---

### Résumé du plan (≤ 15 lignes)

**Ancrage** : le module se pose dans les couches existantes — `domain/` pur (SLA/risque testés),
`handlers/maintenance.js` (I/O injecté), `modules/maintenance.tsx` (lazy), overlays `config/*`,
RBAC matriciel. Aucune architecture nouvelle. **Tables créées : 5** (`mnt_contrats`,
`mnt_engagementsSla`, `mnt_tickets`, `mnt_interventions`, `mnt_evenementsSla`) + 1 summary + 2
docs config ; **0 table existante modifiée** (rattachement par `fp`/`fpKey`, lecture inverse).
**Points de contact : 11** (C1..C11) — les deux critiques sont **C3** (recompute `aggregate.js`,
peut altérer des chiffres existants) et **C10** (drapeau `config/mntFeature`, garantit « éteint =
ERP d'avant »). **Lots : 6** (0 socle éteint → 1 contrat/SLA → 2 tickets/interventions → 3
événements SLA/échéancier → 4 renouvellements via `approvals` → **5 moteur de risque en dernier**).
**Risques principaux** : régression de summary via C3 (mitigé par gate `want` + test d'identité
octet-pour-octet), fuite/blocage RBAC via C1/C2 (mitigé par `test:rules` de caractérisation),
dépassement du budget bundle via C5 (mitigé par `React.lazy` + `check-bundle`). Drapeau unique
`config/mntFeature`, off par défaut → l'ERP reste strictement celui d'avant.

> **Phase 3 terminée. Le tableau des points de contact est le cœur du risque : relisez-le ligne
> à ligne. Validez le plan et le découpage avant `/4-filet`.**
