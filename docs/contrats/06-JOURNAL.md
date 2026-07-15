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
