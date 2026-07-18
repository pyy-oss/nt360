# Journal — Partenariats & Certifications

> Append-only. Fait / appris / échoué. Le plus récent en tête (après ce bloc de format).

---

## Lot 7 (final) — IA (plan d'action + QBR) + export PPTX

**Fait**
- Domaine PUR `functions/domain/parAi.js` : `actionPlanSnapshot`/`qbrSnapshot` (dérivés des summaries,
  montants FCFA), `buildActionPlanPrompt`/`buildQbrPrompt` (prompts FR, XOF), `normalizeActionPlan`/
  `normalizeQbr` (**re-validation stricte** de la sortie IA — l'IA propose, on ne fait pas confiance).
  Tests (6 cas).
- Pont `functions/lib/parAi.js` (patron `lib/aiChurn.js`) : `@anthropic-ai/sdk`, `claude-opus-4-8`,
  `thinking:{type:"adaptive"}`, gestion `stop_reason==="refusal"`, sortie re-validée par le domaine.
- Callables `generateParActionPlan` / `generateParQbr` : `requireRead` + drapeau + rate-limit +
  clé `ANTHROPIC_API_KEY` (Secret Manager) ; snapshot construit CÔTÉ SERVEUR à partir des summaries ;
  `logOps` sur l'usage seul (jamais le contenu). Exports + `deployed-functions.txt`.
- Front : onglet « IA & QBR » dans `partenariats.tsx` (plan d'action en cartes + QBR par partenaire) ;
  export PowerPoint via `web/src/lib/parQbrPptx.ts` (**pptxgenjs en import dynamique** — zéro impact
  chunk d'entrée ; montants FCFA, charte des tokens de l'ERP).

**Appris**
- La convention IA du kit (`sonnet-4-6`, `fetch` brut, `ANTHROPIC_KEY`, sortie non validée) est
  abandonnée au profit du patron nt360 (ADR-P05) : Opus, SDK, refusal, re-validation, secret
  `ANTHROPIC_API_KEY`, `logOps` usage-seul.
- L'export PPTX du kit (charte propre, euros codés en dur) est refait sur `codirPptx.ts` (pptxgenjs déjà
  présent, lazy) en FCFA et aux tokens de l'ERP.

**Échoué / en attente**
- Rien. **Le module est complet** : référentiel, certifs, CA dérivé, quotas, alertes, assignations,
  front, IA + QBR PPTX. Prochaine étape : audit utilisateur + technique (gardien / conformiste).
- Bundle : chunk d'entrée **118,1 KB** (marge 1,9 KB) — pptxgenjs et le module restent hors chunk d'entrée.

---

## Lot 6 — Front gaté (onglet + UI temps réel)

**Fait**
- Généralisation de `moduleFlagOn(flag, enabledByFlag)` (différée du Lot 0) + table de drapeaux dans
  `App.tsx` (mntFeature + parFeature). Enregistrement de l'onglet dans `modules/index.tsx` (lazy, clé RBAC
  `partenariats`, drapeau `parFeature`, groupe « Partenariats »). Miroir front de moduleFlagOn testé.
- Module LAZY `web/src/modules/partenariats.tsx` (chunk séparé 13,7 KB) : 4 onglets (Tableau de bord,
  Certifications, Assignations, Paramétrage) — KPIs + tables lues en TEMPS RÉEL des summaries
  (`par_ca`/`par_quotas`/`par_alerts`/`par_relances`) et des collections (`par_partners`/
  `par_certifications`/`par_assignments`), formulaires câblés sur les callables (certif, assignation,
  mapping fournisseur→constructeur). Primitives design réutilisées, formats FCFA/JJ-MM-AAAA, tons via
  `lib/parLabels.ts`. Écritures gatées `canWrite`.
- Consultants (callable-only) chargés via `listConsultants` pour les sélecteurs.

**Appris / budget bundle**
- L'enregistrement d'un 7ᵉ onglet gaté (nav + 2ᵉ abonnement drapeau) poussait le chunk d'entrée à
  120,9 KB (> 120). Reclamés : réutilisation d'une icône déjà importée (au lieu d'un nouvel import lucide)
  + inline de la table de drapeaux (−0,5 KB), puis **Login passé en LAZY** (écran pré-auth autoportant,
  patron sanctionné « import → React.lazy », App-local) → **chunk d'entrée 118,1 KB** (marge 1,9 KB).
- Le module n'entre PAS dans le chunk d'entrée (lazy) : à drapeau éteint, l'onglet est masqué et aucun
  code par_* n'est chargé — l'ERP reste celui d'avant.

**Échoué / en attente**
- Édition du référentiel partenaire (tiers/catalogue imbriqués) non exposée au front en Lot 6 : le
  référentiel s'initialise côté direction via `upsertParPartner` (seed fourni). Un éditeur guidé pourra
  venir plus tard.

---

## Lot 5 — Assignations de certification + relances (ADR-P03/P04)

**Fait**
- Domaine PUR `functions/domain/parAssignment.js` : `validateAssignment` (targetDate plausible, offsets
  triés/dédoublonnés, défaut [30,14,7]), `effectiveStatus` (en_retard DÉRIVÉ, pas réécrit), `assignmentWatch`
  (liste de relance : en retard OU dans une fenêtre d'offset, palier le plus serré), `watchCounts`.
  Tests (5 cas).
- Collection `par_assignments` + callables `upsertParAssignment` / `setParAssignmentStatus` /
  `deleteParAssignment` : valident l'existence du consultant + de l'entrée de catalogue ; dénormalisent
  NOM/BU du consultant + son manager (destinataire des relances) + libellé de certif — jamais le CJM.
  Idempotent (id = `<consultantId>_<catalogId>`). Exports + `deployed-functions.txt`.
- Rules : `match /par_assignments` (read gaté drapeau+droit, write:false). Summary `summaries/par_relances`
  (watchlist J-30/14/7 + retards) poussé par le bloc recompute `partenariats`. Recompute déclenché par
  les callables. `test:rules` 70/70 (émulateur).

**Appris**
- Comme le kit relançait via un cron écrivant des `partnerAlerts`, on préfère une liste MATÉRIALISÉE
  (summary recomputé) : pas de nouveau planificateur, cohérent avec par_alerts, et le statut « en retard »
  reste DÉRIVÉ (aucun effet de bord sur le doc). L'envoi effectif (email) n'était pas implémenté par le
  kit non plus — à brancher plus tard sur l'infra email existante si souhaité.

**Échoué / en attente**
- Envoi effectif des relances (email/notification) : non branché (comme le kit) — la liste `par_relances`
  est prête à alimenter un digest via l'infra email existante (`sendEmail`/`loadEmailCfg`), lot ultérieur.

---

## Lot 4 — Quotas de couverture + alertes cycle de vie (ADR-P04)

**Fait**
- Domaine PUR `functions/domain/parQuota.js` : `coverageForPartner` (croise exigences × certifs ACTIVES,
  détenteurs DISTINCTS, cible = certif précise OU compétence), `partnershipQuotaStatus`
  (on_track/at_risk/non_compliant/non_evalue), `coverageAll`. Tests (5 cas).
- Domaine PUR `functions/domain/parAlert.js` : `alertBucket` (J-90/60/30/7/0 + expired), `certRenewalWatch`
  (liste de renouvellement ≤ 90 j triée par urgence, todayIso injecté), `watchCounts`. Tests (5 cas).
- Bloc recompute `partenariats` étendu : lit aussi `par_certifications`, pousse `summaries/par_quotas`
  (couverture + statut par partenaire) et `summaries/par_alerts` (watchlist + compteurs par palier).
- `upsertParCertification` déclenche désormais `requestRecompute(["partenariats"])` (certifs → quotas +
  alertes). Rules inchangées (par_quotas/par_alerts couverts par `par_.*` → partenariats + verrou drapeau).

**Appris**
- Correction du bug kit `computeCoverage` (contrat `{cert}` vs données réelles) : le matching se fait sur
  `certificationCatalogId` OU `competencyId`, sur des certifs dont l'intégrité a été garantie au Lot 1.
- Correction du bug kit de clé `certificationCounts` (écriture 3-seg vs lecture 2-seg) : ici PAS de
  collection de compteurs — la couverture est recalculée en un summary, pas matérialisée par trigger.

**Échoué / en attente**
- Statut de partenariat = **quota-only** en Lot 4 : le volet « revenu vs objectif » du kit exige un
  `revenueTarget` par partenaire, non stocké (n'invente aucune donnée). À ajouter (champ optionnel sur
  par_partners + combinaison quota∧revenu) quand les objectifs réels seront fournis.
- `requiredRole` (« SE ») non filtrant : les rôles ESN (grade) ne mappent pas 1-1 ; conservé pour
  l'affichage, à raffiner si l'ERP introduit ce mapping.

---

## Lot 3 — Lien CA : dérivation depuis les BC fournisseurs (ADR-P02/P04)

**Fait**
- Domaine PUR `functions/domain/parRevenue.js` : `resolvePartner` (fournisseur normalisé → partnerId via
  overlay), `revenueByPartner` (somme XOF entier par constructeur + fournisseurs NON mappés remontés à
  part) , `revenueProgress`. Tests (5 cas).
- Overlay `config/parPartnerMap` + callable `setParPartnerMap` (clés MAJUSCULES, valeurs slug ; audit ;
  `requestRecompute(["partenariats"])`). Recompute aussi déclenché par upsert/delete partenaire.
- Bloc recompute `want("partenariats")` dans `lib/aggregate.js` (ADR-P04) : doublement gaté
  (scope + drapeau), lit `par_partners` + `config/parPartnerMap` + `bcLines` (déjà en mémoire ;
  `partenariats` ajouté à `needBc`), pousse `summaries/par_ca` `{asOf, byPartner[], unmapped[], totalXof}`.
  À drapeau éteint : zéro lecture par_*, zéro écriture → recompute strictement identique à avant.
- Rules : `summaryModule` `par_.*` → `partenariats` + double-verrou drapeau `parEnabled()` sur
  `/summaries`, lecture `config/parPartnerMap` gatée. Exports + `deployed-functions.txt`.

**Appris**
- Le CA « dérivé des BC » du kit EST le module Fournisseurs de nt360 (`bcLines`) : la dérivation réutilise
  cette source unique (autorité `domain/fournisseurs.js`), aucune collection `purchaseOrders`. Le montant
  est en XOF entier (FCFA sans subdivision), pas en euros comme le kit.
- `want`/`need` de l'agrégat ne sont que des filtres `only.includes(...)` — un nouveau scope
  `partenariats` est accepté sans allowlist (crainte de la cartographie levée).
- Les fournisseurs non mappés sont remontés (jamais ignorés) → la table `parPartnerMap` se complète à vue.

**Échoué / en attente**
- Pas de fenêtre annuelle (exercice) sur le CA en Lot 3 : somme cumulée par constructeur. Le scoping par
  année + les objectifs (`revenueTarget`) et le statut de partenariat (quota+revenu) arrivent au Lot 4.

---

## Lot 2 — Certifications rattachées aux consultants (ADR-P03)

**Fait**
- Domaine PUR `functions/domain/parCertification.js` : `validateCertification` (consultantId/partnerId/
  catalogId + date plausible), `computeCertStatus` (expired / expiring_soon ≤ 90 j / active, today
  INJECTÉ → recalculable par le sweep Lot 4), `engineerRhStatus`. Tests (6 cas).
- Handler `upsertParCertification` / `deleteParCertification` : VALIDE l'existence du consultant
  (annuaire ESN = seule vérité des personnes) ET du partenaire+entrée de catalogue (Lot 1) ; DÉRIVE
  expiration (validityMonths du catalogue) + statut ; dénormalise NOM/BU/GRADE du consultant **sans**
  le CJM. Idempotent (id = `<consultantId>_<catalogId>`). Exportés + `deployed-functions.txt`.
- Rules : `match /par_certifications/{id}` — lecture directe gatée drapeau+droit `partenariats`
  (donnée non confidentielle), écriture callable-only.

**Appris**
- Stocker les certifs en sous-collection de `consultants` aurait hérité de son accès callable-only
  (CJM confidentiel) → gate RBAC faux pour une donnée non sensible. Le top-level `par_certifications`
  RÉFÉRENÇANT `consultantId` respecte ADR-P03 (pas de second annuaire) tout en gardant le RBAC propre.
- La validité (mois) n'est jamais saisie : dérivée du catalogue du partenaire à l'écriture — cohérent
  avec le point d'attention Fortinet (24 mois porté par le catalogue).

**Échoué / en attente**
- `requiredRole` (ex. « SE ») du kit n'a pas d'équivalent direct dans les rôles ESN (`grade`) : le
  matching de quota par rôle est reporté au Lot 4 (couverture) ; on dénormalise `grade` dès maintenant.
- Aucun recompute déclenché en Lot 2 (le scope `partenariats` d'agrégat n'existe pas encore ; il arrive
  avec le summary Lot 3/4).

---

## Lot 1 — Référentiel partenaire (par_partners, données)

**Fait**
- Domaine PUR `functions/domain/parPartner.js` : validateurs tier/compétence/entrée-catalogue/exigence +
  `validatePartner` (intégrité référentielle : exigence→niveau+cible connus, certif→compétence connue) +
  `computeExpiry`. Tests `functions/test/parPartner.test.js` (8 cas). Modèle EMBARQUÉ, exigences aplaties
  (ADR-P06).
- Handler `functions/handlers/partenariats.js` (factory injectée) : `upsertParPartner` / `deleteParPartner`,
  double garde `requireWrite("partenariats")` + `assertParEnabled()`, audit. Câblés + exportés dans
  `index.js` ; ajoutés à `deployed-functions.txt`.
- Rules : `parEnabled()` (fail-closed) + `match /par_partners/{id}` (read gaté drapeau+droit
  `partenariats`, write:false). Référentiel sans montant → lecture directe temps réel autorisée.
- Seed exemple `docs/partenariats/exemple-par-partners.json` (données de départ du kit portées au schéma
  embarqué, 4 constructeurs) — validé par `validatePartner` (intégrité comprise).

**Appris**
- Le contrat `computeCoverage` du kit était incohérent avec la forme réelle des données (champs
  `cert`/`min` vs `certIdOrCompetencyId`/`minCount`). En posant l'intégrité référentielle à la frontière
  d'écriture, la couverture (Lot 2/4) lira des cibles garanties existantes.
- Nouvelle clé de module `partenariats` : gérée par la matrice `config/permissions` (donnée), pas par un
  nouveau rôle (ADR : socle RBAC intouché). `direction` écrit déjà ; les autres rôles quand la matrice
  est complétée (ou au Lot 6 avec l'onglet).

**Échoué / en attente**
- `computeExpiry` : arithmétique de mois naïve (débordement fin de mois, comme le kit) — documenté, jugé
  immatériel pour l'alerte J-90/60/30. Miroir front de `parPartner` différé au Lot 6 (aucun consommateur
  front avant l'UI).

---

## Lot 0 — Drapeau de fonctionnalité + socle d'ancrage

**Fait**
- Phase 0 (empreinte) : deux cartographies parallèles (kit + surface d'intégration nt360). Résultats
  dans `00-ANCRAGE.md`.
- Résolution des collisions : les 6 noms du kit sont libres, mais `purchaseOrders` et `certEngineers`
  recréeraient des vérités existantes (`bcLines`, `consultants`) → ADR-P02 / ADR-P03.
- Drapeau `config/parFeature` : `domain/parFeature.js` (`isParEnabled`) + miroir `web/src/lib/parFeature.ts`,
  tests des deux côtés. Callable `setParFeature` (direction-only, audité), toggle Habilitations
  (`ParFeatureCard`), règle de lecture `config/parFeature`, enregistrement `deployed-functions.txt`.
- Front INCHANGÉ en Lot 0 : `App.tsx`/`moduleFlagOn` ne bougent pas tant qu'aucun onglet ne porte le
  flag (l'ERP reste byte-for-byte identique). La généralisation de `moduleFlagOn` + le câblage du
  filtrage accompagneront l'onglet Partenariats (Lot 6) — évite aussi de saturer le budget bundle
  (chunk d'entrée au plafond de 120 KB) pour zéro surface visible.

**Appris**
- `moduleFlagOn` codait `"mntFeature"` en dur (`mntFeature.ts`) : un second module l'imposait de le
  généraliser plutôt que de le dupliquer (ADR-P01) — sinon deux façons de gater = deux façons de se
  tromper.
- Le CA « dérivé des BC » du kit correspond exactement au module Fournisseurs existant (`bcLines`) :
  l'intégration indiscernable réutilise cette source, elle ne la double pas.

**Échoué / en attente**
- Rien à ce stade. Décisions structurantes (ADR-P02/P03/P04) actées sur preuve de code ; à confirmer par
  l'utilisateur avant d'attaquer les lots de données (1-3).

---

## Remédiation post-Lot 7 — audit gardien (2 findings MAJEUR)

**Fait**
- **M1 (statut de certif figé)** : `lib/aggregate.js`, bloc `want("partenariats")`, re-dérive
  `c.status = computeCertStatus(c.expiryDate, asOf)` pour toutes les certifs AVANT de construire
  `certsByPartner` → quotas/couverture reflètent le temps écoulé (le sweep quotidien promis par
  `domain/parCertification`). Source unique du statut « à date » = le recompute (ADR/GARDIEN-M1).
- **M2 (CA confidentiel exposé)** : `summaries/par_ca` gaté par un SECOND verrou `rentabilite` (ADR-P07),
  aligné sur les summaries `*Margin` et les astreintes. Trois surfaces cohérentes :
  - `firestore.rules` : `match /summaries/{id}` ajoute `&& (id != 'par_ca' || canRead('rentabilite'))`
    (condition bon marché, `canRead` évalué pour le seul `par_ca` — pas de dépassement des 1000 éval).
  - `handlers/partenariats.js` : `parCanSeeCa(req)` (droit `rentabilite` ou direction) ; `generateParActionPlan`
    et `generateParQbr` passent `ca: {}` au snapshot sans ce droit → le CA n'est ni transmis au modèle
    ni renvoyé au client. L'IA reste disponible sur certifs/quotas/relances.
  - `web/src/modules/partenariats.tsx` : `useCanSeeMargin()` conditionne l'abonnement à `par_ca`
    (null sinon → pas de permission-denied) et masque le KPI + la carte CA.
- Tests : `test-rules/rules.test.js` +3 (par_partners gaté drapeau ; par_ca refusé sans `rentabilite`,
  autorisé avec) → 73/73. Suite functions 1098/1098. Lint web propre. Bundle 118.1 KB (≤ 120).

**Appris**
- Le champ `status` persisté sur une certif est un cache d'affichage, pas une vérité : toute vérité « à
  date » (dépendant du temps qui passe) doit se re-dériver au recompute, sinon deux vues divergent.
- « CA » côté partenariats = volume d'achat fournisseur = donnée confidentielle au même titre que la
  marge. Le cloisonnement doit être identique (rules + serveur + front), pas seulement côté UI.

**Échoué / en attente**
- Régression UX assumée : un data-steward `partenariats` SANS `rentabilite` perd la liste des
  fournisseurs BC non rattachés (annotée du CA) dans Paramétrage — il mappe alors à la saisie manuelle.
  Choix conservateur (le montant EST le CA confidentiel) ; à revoir si le besoin d'un libellé
  fournisseur sans montant se confirme (nécessiterait un summary non confidentiel dédié).

---

## Remédiation post-Lot 7 (suite) — vérification adverse : fuite CA résiduelle QBR

**Fait**
- La vérification gardien du correctif M2 a trouvé une **fuite résiduelle** : `generateParQbr`
  calculait bien `seeCa = parCanSeeCa(req)` mais ne l'appliquait PAS au snapshot — le CA brut
  (`ca_realise_ytd_fcfa`) était transmis au modèle ET renvoyé au client, contournant rules + front.
  Le masque avait été posé sur `generateParActionPlan` et **oublié sur la QBR**.
- Correctif : `handlers/partenariats.js` — `ca: seeCa ? (caSnap.data() || {}) : {}` (comme le plan
  d'action). Sans le droit `rentabilite`, `qbrSnapshot` retombe sur `ca_realise_ytd_fcfa: 0`.
- Test de contrat ajouté (`test/parAi.test.js`) : `ca={}` ⇒ montant 0 dans les DEUX snapshots
  (plan + QBR) → verrouille la non-régression. functions 1099/1099.

**Appris**
- Une variable de garde calculée mais non branchée est pire qu'absente : elle donne l'illusion du
  cloisonnement. Un correctif de confidentialité doit être vérifié sur CHAQUE point de sortie (ici
  deux callables IA symétriques), pas seulement sur celui qu'on a en tête.
- La vérification adverse post-merge a fait son travail : le premier passage avait manqué ce point.

**Échoué / en attente (note, pas un changement silencieux)**
- `qbrSnapshot.certifications_actives` filtre `c.status === "active"` sur le statut PERSISTÉ des certifs
  lues en direct par `generateParQbr` (pas re-dérivé comme au recompute) → la liste affichée en QBR peut
  être légèrement périmée. N'affecte pas les quotas (M1 clos). À traiter si le besoin d'exactitude de
  cette liste se confirme (re-dériver `computeCertStatus(c.expiryDate, today)` avant le filtre).
