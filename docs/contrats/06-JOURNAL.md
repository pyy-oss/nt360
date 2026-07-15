# 06 — Journal

> Append-only, plus récent en tête. Rempli par `/journal` à chaque fin de session.
>
> **Les échecs sont la partie utile.** Un journal qui ne contient que des succès n'est pas un
> journal, c'est une plaquette — et la session suivante réessaiera ce qui a déjà échoué.

## Format

```markdown
## AAAA-MM-JJ — <phase ou lot>

**Fait**
- …

**Appris sur l'existant**
- … (toute découverte qui contredit ou complète 01-EXISTANT.md — et corrige le document)

**Échoué / abandonné**
- … (ce qui n'a pas marché, et pourquoi)

**Dette assumée**
- … (ce qu'on a laissé sale sciemment, et la condition de son remboursement)

**Décidé**
- … (renvoi ADR)

**Suivant**
- …
```

---

## 2026-07-15 — Lot 3 (Événements SLA & échéancier)

**Fait**
- Moteur SLA PUR `functions/domain/mntSla.js` : `businessMsBetween`/`addBusinessMs`/`slaState` —
  horloge **jours ouvrés pleins Lun–Ven, UTC** (ADR-002), seuil en heures, état respecté/rompu/en_cours.
- Échéancier PUR `functions/domain/mntEcheancier.js` : `echeancier` (engagé = montant/échéance ×
  échéances dues vs facturé Σ factures par N° FP — ADR-005).
- Miroir front EXACT `web/src/lib/mntSla.ts` (SLA + échéancier), parité testée (mêmes attentes que le
  test back).
- Handler : `upsertMntTicket` pose les horodatages de transition `priseEnCompteLe`/`resoluLe` **une
  fois** au franchissement du statut (SLA à la minute). Aucun nouveau callable, aucune collection.
- UI `maintenance.tsx` : colonne **SLA résolution** (badge live) sur les tickets ; **échéancier**
  (engagé/facturé/écart) dans la fiche contrat, factures lues par `where fp==` (borné).

**Filet / vérif — TOUT VERT**
- `functions` **849** (+`mntSla.test.js`), `web` **85** (+`mntSla.test.ts`, parité), `test:rules`
  **68** (inchangé), build OK, **chunk 115,3 KB ≤ 120**, no-undef (116), deploy-targets (**144**,
  aucun callable ajouté), indexes, lint : verts.

**Points de contact touchés**
- **C11** : `fpKey` pour rapprocher les factures de l'affaire (échéancier).
- **Aucun** contact recompute/rules/deploy nouveau : SLA **dérivé live** (ADR-015), pas de
  matérialisation, pas de callable. Les horodatages de ticket sont écrits en Admin SDK (rules `write:false`).

**Appris sur l'existant**
- `useCollectionData(name, [where(...)], key)` accepte des contraintes → lecture bornée des factures
  d'une affaire (pas de scan global). *(complète 01-EXISTANT §7)*

**Échoué / abandonné**
- Rien.

**Dette assumée**
- **Échéancier** : les factures sont rapprochées par `where fp == fpKey(contrat.fp)` (égalité indexée) —
  suppose la facture stockée en FP **canonique**. Une facture à FP non canonique ne serait pas comptée
  (le recompute gère les alias ailleurs). À robustifier (résolveur d'alias) si l'écart est constaté.
- Lecture des factures nécessite le droit `facturation` (sinon écart neutre) — cohérent RBAC.
- **Historique des ruptures SLA** non persisté (ADR-015) : reporté au Lot 5 (recompte + matérialisation).
- SLA « prise en compte » calculable (`priseEnCompteLe`) mais non affiché en Lot 3 (colonne résolution
  seule) — ajout trivial au besoin.

**Décidé**
- ADR-015 (SLA dérivé live, matérialisation reportée au Lot 5).

**Suivant**
- Validation + fusion, puis `/5-lot 4` (Renouvellements via `approvals`).

---

## 2026-07-15 — Lot 2 (Tickets & interventions)

**Fait**
- Domaine PUR `functions/domain/mntTicket.js` : `validateTicket`/`validateIntervention` + énumérations
  (statuts, 4 priorités) + conversion CRA (`craDaysFromHours`, `monthOf`, `HOURS_PER_DAY=8`).
- Handler `handlers/maintenance.js` étendu : callables `upsert/deleteMntTicket`,
  `upsert/deleteMntIntervention`. Chaque intervention **alimente le CRA** via `refreshCra` (doc
  `timesheets/mnt_<consultant>_<mois>`, source « mnt », additif, sans collision — ADR-013). Double
  garde RBAC + drapeau conservée ; `auditLog` 6 champs.
- `index.js` : +4 exports ; `deployed-functions.txt` : +4 (garde CI verte, 144 fns).
- Front : types `MntTicket`/`MntIntervention`, wrappers `writes.ts`, libellés/tons tickets
  (`lib/mntContrat.ts`, priorité sur palette risque — ADR-014). Écran `maintenance.tsx` : carte
  Tickets (Table) + fiche ticket (Modal) avec éditeur d'interventions (consultant via `listConsultants`,
  date `DateField`, heures, suppression). Contrats inchangés.

**Filet / vérif — TOUT VERT**
- `functions` **843** (+`mntTicket.test.js`), `web` **82**, `test:rules` **68** (inchangé — CRA écrit
  en Admin SDK), build OK, **chunk d'entrée 115,3 KB ≤ 120**, no-undef (114), deploy-targets (**144**),
  indexes, lint : verts.

**Points de contact touchés**
- **C4** (déploiement) : +4 callables, `deployed-functions.txt` à jour.
- **C11** : `fpKey` dans la validation ticket/intervention.
- **CRA / TACE (contact avec l'existant)** : l'intervention écrit un doc CRA maintenance DISTINCT
  (`mnt_<consultant>_<mois>`, source « mnt ») qui **s'additionne** dans `computeConstat` sans collision.
  Drapeau éteint ⇒ pas d'intervention ⇒ **TACE strictement inchangée** (garantie « éteint = ERP d'avant »).
- **C9** : aucun index ajouté (requête `where consultantId ==`, index automatique Firestore).
- **C2** : rules inchangées (blocs `mnt_tickets`/`mnt_interventions` déjà posés Lot 0 ; écritures callable).

**Appris sur l'existant**
- `computeConstat` (`domain/timesheet.js:46`) somme `billedDays` **par consultant sur tous les docs**
  du mois (pas par id) → un doc CRA à id distinct s'additionne proprement. C'est ce qui rend l'alimentation
  du CRA sûre et non destructrice. *(complète 01-EXISTANT §5)*
- `consultants` est callable-only (rules read:false) → l'écran charge la liste via `listConsultants`
  (droit `overview`), pas via `useCollectionData`.

**Échoué / abandonné**
- Rien. (TS : `Consultant.id` optionnel → normalisation à la charge de la liste consultants.)

**Dette assumée**
- **Suppression d'un ticket ne cascade pas** ses interventions (elles restent + leur contribution CRA).
  À traiter (cascade ou blocage) si l'usage le réclame. Noté.
- Pas de test E2E du callable d'intervention sous émulateur Functions (`test:rules` ne monte que
  Firestore) : la conversion CRA est couverte par le **domaine** (`craDaysFromHours`) + le chemin
  `computeConstat` existant. Dette identique aux lots précédents.
- Taux **8 h/jour** codé (ADR-013) faute de référentiel d'horaires — paramétrable plus tard.

**Décidé**
- ADR-013 (alimentation CRA, 8 h = 1 j, doc distinct), ADR-014 (4 priorités, palette risque).

**Suivant**
- Validation + fusion, puis `/5-lot 3` (Événements SLA & échéancier).

---

## 2026-07-15 — Lot 1 (Contrat & engagements SLA — données)

**Fait**
- Domaine PUR `functions/domain/mntContrat.js` : `validateMntContrat` / `validateEngagement` +
  énumérations (statuts, échéances, types SLA, couvertures). N° FP canonicalisé par `fpKey` (ADR-001,
  C11), montant `number` arrondi **entier XOF**, dates ISO `AAAA-MM-JJ`, statuts en code applicatif.
- Handler `functions/handlers/maintenance.js` : callables `upsertMntContrat` / `deleteMntContrat`,
  **double garde** `requireWrite('maintenance')` + drapeau `config/mntFeature` allumé (ADR-009), audit
  `auditLog` au schéma 6 champs. Id du doc = `safeId(fp)` (1 contrat = 1 affaire, idempotent).
- Câblage `index.js` (factory injectée) + `deployed-functions.txt` (+2, garde CI verte).
- Front : types `MntContrat`/`MntEngagement` (`types.ts`), wrappers `writes.ts`, libellés/tons
  `web/src/lib/mntContrat.ts` (miroir des valeurs, libellés FR), écran `modules/maintenance.tsx`
  (liste `Table` + fiche `Modal` avec `Select`/`DateField`/`Busy`/`DangerBtn`, RBAC-gated, montant
  FCFA entier via `fmt`, date `JJ/MM/AAAA`, voix « Enregistrer »).
- Engagements SLA **embarqués** dans le contrat (ADR-012), pas de collection séparée.

**Filet / vérif — TOUT VERT**
- `functions` **838** (+ `mntContrat.test.js`), `web` **81** (+ `mntContrat.test.ts`), `test:rules`
  **68** (inchangé), build OK, **chunk d'entrée 115,0 KB ≤ 120** (module = chunk lazy), gardes
  no-undef (113), deploy-targets (**140**), indexes, lint — verts.

**Points de contact touchés**
- **C4** (déploiement) : +2 callables, `deployed-functions.txt` à jour (garde verte).
- **C11** (rattachement) : `fpKey` au cœur de la validation ; test domaine + `mnt-caracterisation`.
- **C2** (rules) : **non retouché** — les blocs `mnt_*` + le flag sont déjà en place (Lot 0). Les
  écritures passent par callable (Admin SDK), `write:false` reste opposable.
- **C9** (index) : **aucun index ajouté** — la liste lit toute la collection et trie côté client
  (petite volumétrie). Un index composite viendra dès qu'une requête `where/orderBy` apparaît.

**Appris sur l'existant**
- `useCollectionData(name=null)` = pas d'abonnement (`web/src/lib/hooks.ts:65`) : on passe `null`
  quand le rôle n'a pas le droit, évitant un `permission-denied` en console. *(complète 01-EXISTANT)*
- `Modal` n'accepte que `size` `"sm"|"md"` (pas `"lg"`). Classe d'input partagée = `field`.

**Échoué / abandonné**
- Rien. (Un `size="lg"` initial a été corrigé en `"md"` — primitive existante, pas d'extension.)

**Dette assumée**
- Écran Habilitations n'expose toujours pas la clé `maintenance` (Lot 0) : en pratique seule la
  direction peut créer/lire un contrat une fois le drapeau allumé. Remboursé au lot d'activation.
- Pas de test end-to-end du callable `upsertMntContrat` sous émulateur Functions (le harnais
  `test:rules` ne monte que Firestore) : couvert par le test unitaire du **domaine** + la garde RBAC
  au niveau règles. À compléter si un lot ajoute une logique serveur non triviale.

**Décidé**
- ADR-012 (engagements SLA embarqués). ADR-001/005/009/010 appliqués.

**Suivant**
- Validation humaine + fusion, puis `/5-lot 2` (Tickets & interventions).

---

## 2026-07-15 — Lot 0 (Socle éteint)

**Fait**
- Drapeau de fonctionnalité `config/mntFeature` (ADR-009) : lecture PURE `isMntEnabled` côté back
  (`functions/domain/mntFeature.js`) + miroir front (`web/src/lib/mntFeature.ts`). Défaut = éteint
  par ABSENCE du doc (aucune donnée à créer).
- Clé RBAC `maintenance` : le module est enregistré dans `MODULES[]` (`web/src/modules/index.tsx`)
  avec `key: "maintenance"` (absente de la matrice → `none` par défaut) ET `flag: "mntFeature"`.
  Double verrou : RBAC + drapeau.
- Coquille de module `web/src/modules/maintenance.tsx` (lazy) — masquée par App tant que le drapeau
  est éteint (`App.tsx` : `moduleFlagOn(m.flag, mntFeature)` dans le filtre `visible`).
- `firestore.rules` : helper `mntEnabled()` (fail-closed) + blocs `mnt_contrats/…/mnt_evenementsSla`
  (lecture = drapeau ALLUMÉ **et** `canRead('maintenance')`, écriture `if false` = callables) +
  lecture de `config/mntFeature` (isNt360).
- **C10 prouvé** : test:rules (émulateur) — drapeau éteint ⇒ même la direction ne lit pas `mnt_*` ;
  allumé + droit ⇒ lecture ; allumé sans droit ⇒ refus ; écriture toujours refusée.

**Filet / vérif — TOUT VERT**
- `functions` : **84 fichiers / 828 tests** (+ `mntFeature.test.js`).
- `web` : **14 fichiers / 78 tests** (+ `mntFeature.test.ts`).
- `test:rules` : **68 tests** (+ 5 cas « double verrou »).
- Build web OK ; **chunk d'entrée 114,9 KB ≤ 120 KB** (le module est un chunk lazy à part → C5 OK).
- Gardes : `check-no-undef` (111 fichiers), `check-deploy-targets` (138 fns, **inchangé** — aucun
  callable ajouté), `check-firestore-indexes`, lint react-hooks : verts.

**Points de contact touchés** : C1 (RBAC — clé additionnelle, matrice inchangée), C4 (aucun export
serveur ⇒ deployed-functions.txt inchangé), C5 (nav lazy, budget respecté), **C10** (drapeau — figé
et testé). C2 (rules) étendu additivement (blocs `mnt_*` + `config/mntFeature`), sans toucher aux
règles existantes (68 tests dont les anciens toujours verts).

**Appris sur l'existant**
- `config/{id}` (`firestore.rules`) est une **allowlist fail-closed** : un nouveau doc `config/*`
  n'est PAS lisible par défaut → il a fallu une règle dédiée `config/mntFeature` (cohérent avec la
  sécurité de l'ERP, pas un contournement). *(complète `01-EXISTANT.md §5`)*
- La visibilité d'un module front = `MODULES.filter(can(key) !== "none")` (`App.tsx:43`) : une clé
  RBAC absente de la matrice suffit déjà à masquer un module. Le drapeau ajoute le maître-interrupteur.

**Échoué / abandonné**
- Rien.

**Dette assumée**
- L'éditeur de matrice RBAC (Habilitations) n'expose pas encore la clé `maintenance` : impossible
  d'accorder le droit depuis l'UI. **Volontaire** en Lot 0 (module éteint) ; remboursé au lot où l'on
  active le module (ajout de `maintenance` à la liste des modules de l'écran Habilitations). En
  attendant, seule la direction (write partout) peut lire `mnt_*` une fois le drapeau allumé.
- `summaryModule('mnt_risque')→'maintenance'` (`firestore.rules`) non ajouté : le summary n'existe
  qu'au Lot 5 ; mapping ajouté à ce moment (C3).

**Décidé**
- Aucun nouvel ADR. Application d'ADR-009 (drapeau `config/mntFeature`) et ADR-010 (nommage `mnt_`).

**Suivant**
- Validation humaine, puis `/5-lot 1` (Contrat & engagements SLA — données : `mnt_contrats` +
  `mnt_engagementsSla`, CRUD callables, liste + fiche, adossé au N° FP).

---

## 2026-07-15 — Phase 4 (Filet de non-régression)

**Fait**
- Suite existante **verte AVANT toute intervention** : `functions` = 82 fichiers / **815 tests** OK
  (12 s). On construit sur un filet intact.
- Ajout de `functions/test/mnt-caracterisation.test.js` (**10 tests**, verts) : fige le comportement
  ACTUEL de l'ERP aux points de contact PURS du plan (§3), AVANT que le module n'y touche —
  C1 (RBAC), C6 (approbations), C11 (rattachement fpKey).

**Carte de couverture des 11 points de contact** (`04-PLAN-INTEGRATION.md §3)

| Point | Couvert par | État |
|---|---|---|
| **C1** RBAC matrice (`authz`) | `authz.test.js` (module inconnu→none) **+ `mnt-caracterisation.test.js`** (clé 'maintenance' = none avant ajout, additivité) | ✅ figé |
| **C2** règles Firestore `mnt_*` | `functions/test-rules/rules.test.js` (émulateur, `pnpm test:rules`) | ✅ existant — pin `mnt_*` à écrire **au Lot 1** (règle inexistante aujourd'hui) |
| **C3** recompute `aggregate.js` | `consistencyAlertsDq.test.js` + `test-rules/recomputeLock.integration.test.js` | ✅ parité existante — **pin d'identité octet-pour-octet à écrire au Lot 5** (quand `want("maintenance")` existe) |
| **C4** gardes déploiement | `check-deploy-targets.mjs` / `check-no-undef.mjs` (CI) | ✅ se testent elles-mêmes |
| **C5** budget bundle | `check-bundle.mjs` (CI, ≤120 KB) | ✅ garde active |
| **C6** approbations (`approval`) | `approval.test.js` **+ `mnt-caracterisation.test.js`** (renouvellement rejeté aujourd'hui, kinds existants OK) | ✅ figé |
| **C7** notifications (`emailNotify`) | `emailNotify.test.js` | ✅ existant — pin du type « SLA » au Lot 5 |
| **C8** cron `mntSlaSweep` | — | ⚠️ **risque assumé** : fonction inexistante ; test unitaire du balayage à écrire au Lot 5 |
| **C9** index Firestore | `check-firestore-indexes.mjs` (CI) | ✅ garde active |
| **C10** drapeau `config/mntFeature` | — | ⚠️ **risque assumé** : mécanisme NEUF, aucun comportement actuel à figer ; testé au Lot 0 (off ⇒ 0 surface) |
| **C11** rattachement `fpKey`/`plausibleYear` | `ids.test.js` (functions + web) **+ `mnt-caracterisation.test.js`** (équivalence canonique, placeholder rejeté, millésime borné) | ✅ figé |

**Bilan : 9 points sur 11 couverts par le filet** (existant + caractérisation ajoutée). 2 restants
(C8 cron, C10 drapeau) sont des mécanismes NEUFS sans comportement actuel à figer → testés dans leur
lot d'introduction (C10 au Lot 0, C8 au Lot 5).

**Appris sur l'existant**
- L'ERP a **déjà un filet dense** aux points de contact : `authz.test.js:18` fige exactement
  « module absent → none » (le cas du futur module). On n'a donc PAS recréé de tests existants ;
  le nouveau fichier ajoute uniquement des assertions *nommant explicitement* le module (`maintenance`,
  `renouvellement_contrat`, `mnt_contrat`) pour tracer la frontière.
- `APPROVAL_KINDS`/`APPROVAL_ENTITIES` (`domain/approval.js:10-11`) sont des **listes fermées** : le
  Lot 4 devra les étendre additivement — le test C6 rougira alors DÉLIBÉRÉMENT (signal de frontière).
- **Empreinte de données (§3 du kit) NON capturée** : pas de jeu de recette chargé dans ce contexte
  (émulateur non démarré). L'empreinte avant/après (comptages par collection, sommes de contrôle sur
  `cas`/`amountHt`) est **décrite** comme étape `/verif` sous émulateur, pas exécutée ici.

**Ce que le harnais `/verif` exécutera**
1. `pnpm --filter functions test` (815 + 10 = **825 tests**) — doit rester vert.
2. `pnpm --filter web test` — doit rester vert.
3. `pnpm test:rules` (émulateur) — règles existantes + `mnt_*` (dès le Lot 1).
4. Gardes CI : `check-deploy-targets.mjs`, `check-no-undef.mjs`, `check-firestore-indexes.mjs`,
   `check-bundle.mjs` (≤120 KB), lint react-hooks.
5. Empreinte de données sous émulateur (comptages/sommes de contrôle) — comparaison avant/après lot.
   *Au niveau d'exigence de l'ERP (couverture functions ≥ 80 %), pas au-delà.*

**Échoué / abandonné**
- Rien. (Les points C8/C10 ne sont pas des échecs mais des mécanismes neufs, testés à l'introduction.)

**Dette assumée**
- **C8 (cron SLA)** et **C10 (drapeau)** non figés en Phase 4 — inexistants aujourd'hui. Remboursée
  à leur lot d'introduction (Lot 0 pour C10, Lot 5 pour C8), avec test à drapeau éteint pour C10.
- **Empreinte de données non exécutée** (émulateur) — à jouer au premier `/verif` post-Lot 1.

**Décidé**
- ADR-001..011 (`05-DECISIONS.md`), tous Acceptés. Aucun nouvel ADR en Phase 4.

**Suivant**
- Validation humaine du filet, puis `/5-lot 0` (socle éteint : drapeau + clé RBAC + coquille masquée,
  ERP strictement d'avant) — **première phase à écrire du code applicatif**.

---

## AAAA-MM-JJ — Phase 0

**Fait**
- [à remplir]
