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

---

## Remédiation post-Lot 7 (suite) — QBR : statut de certif re-dérivé (note close)

**Fait**
- Traitement de la note laissée en attente : `qbrSnapshot.certifications_actives` filtrait sur le statut
  PERSISTÉ des certifs lues en direct par `generateParQbr` → liste QBR potentiellement périmée.
- Correctif : `handlers/partenariats.js` re-dérive `c.status = computeCertStatus(c.expiryDate, today)`
  pour toutes les certifs AVANT `qbrSnapshot` — même fonction pure et même symétrie que le recompute
  (`aggregate.js`, GARDIEN-M1). La QBR reflète désormais le statut « à date » comme les quotas.
- Test durci (`test/parAi.test.js`) : `qbrSnapshot` exclut bien une certif au statut `expired` de
  `certifications_actives` (verrouille la moitié « filtre active-only » ; l'autre moitié, `computeCertStatus`,
  est déjà testée). functions 1099/1099, garde no-undef verte.

**Appris**
- La règle « le statut à date se re-dérive, jamais lu du cache persisté » vaut pour TOUT lecteur de certifs,
  pas seulement le recompute : le QBR lisait les certifs en direct et devait donc re-dériver aussi.

---

## Lot P1 — Relances actives (extension : le module envoie enfin)

**Fait**
- Scheduler quotidien `parRelancesSweep` (07:45) qui envoie les relances que le module calculait sans
  jamais les émettre. Patron `mntSlaSweep` à l'identique : double gate (drapeau parFeature + emailNotify
  activée & trigger `partenariats`), lecture des summaries frais (par_relances + par_alerts), best-effort.
- Deux audiences : par MANAGER (assignations à relancer, résolution `managerUid` → `users/{uid}.email`) ;
  DIRECTION (vue d'ensemble relances + renouvellements → `recipients.codir`).
- Réutilise l'infra email existante (`sendEmail`, gabarits `domain/emailNotify.js`, `GRAPH_CLIENT_SECRET`).
  Ajout du trigger `partenariats` à `TRIGGERS` (additif, défaut true, gaté par le drapeau). Non exposé
  dans l'UI Habilitations, exactement comme `maintenance` (symétrie module sœur).
- Logique PURE + testée : `groupParRelancesByManager`, `parBucketLabel`, `buildParManagerEmail`,
  `buildParDirectionEmail` (+ mise à jour des tests de TRIGGERS). functions 1103/1103, deploy-targets 177,
  no-undef OK. `parRelancesSweep` inscrit dans `deployed-functions.txt`. ADR-P08.

**Appris**
- `par_alerts` (renouvellements de certifs) ne porte aucun champ destinataire (ni managerUid ni am) — d'où
  le choix d'un digest DIRECTION pour les renouvellements, et par-manager pour les assignations (qui, elles,
  portent managerUid). Router les renouvellements par manager demanderait d'enrichir par_alerts au recompute
  (consultantId → consultants/{id}.managerUid) : candidat pour un lot ultérieur si le besoin se confirme.
- Le module sœur `maintenance` n'expose pas son trigger email dans l'UI (backend-only, défaut true). On
  reproduit ce choix pour rester indiscernable plutôt que d'introduire une 2ᵉ convention.

**Échoué / en attente**
- Aucun anti-spam (dédup « déjà envoyé ») : comme `emailRelancesDigest` et `mntSlaSweep`, on envoie la photo
  quotidienne. Choix aligné sur l'existant, pas une dette propre au module. À revoir globalement si l'ERP
  se dote un jour d'un mécanisme « déjà notifié » (aucun précédent à copier aujourd'hui).

---

## Lot P2 — Actualité + CODIR (le module devient visible au niveau direction)

**Fait**
- **Actualité** : nouveau summary `summaries/par_news` (bulletins conformité quotas / renouvellements /
  retards), DÉRIVÉ dans le bloc `want("partenariats")` de `aggregate.js` via `domain/parNews` (PUR) —
  SANS toucher l'autorité `buildNews`. Préfixe `par_` ⇒ gaté par les rules existantes (aucune règle
  nouvelle). Front `news.tsx` agrège `par_news` au fil (abonnement conditionné drapeau + droit).
- **CODIR** : carte « Partenariats & certifications » dans le Bilan CODIR (conformes / à risque / à
  renouveler / expirées), même gate. Aucun montant (le CA reste confidentiel, hors CODIR).
- Décision de convention (divergence avec maintenance qui reste hors Actualité) VALIDÉE par l'humain →
  ADR-P09. Tests : `test/parNews.test.js`, `test-rules/rules.test.js` (par_news lisible sous
  `partenariats` seul, contrairement à par_ca). functions 1106/1106, rules 73/73, web lint/build OK,
  bundle 118.1 KB, no-undef OK.

**Appris**
- `par_news` (préfixe `par_`) hérite gratuitement du double verrou drapeau+droit ET du mapping
  `summaryModule` — nommer un nouvel agrégat avec le préfixe du module évite toute règle Firestore
  supplémentaire (et le risque de dépasser la limite d'évaluations).
- Piège hooks : `flag && useCan(...)` court-circuite l'appel du hook → hoisté en `const canPar = useCan(...)`
  avant le ternaire d'abonnement (règles des hooks).

**Échoué / en attente**
- Les nouveaux ids de bulletins (`par_*`) ne sont pas dans le catalogue de la curation IA (`newsCuration`)
  → toujours affichés (jamais démotés), dégradation gracieuse documentée. À intégrer au catalogue de
  curation si le besoin de filtrage fin de ces bulletins se confirme.

---

## Lot P3 — Historisation de la couverture des quotas (tendance)

**Fait**
- Nouveau summary `summaries/par_quotasHistory` : un point par jour (statuts conformes/à risque/non
  conformes + certifs à renouveler/expirées), patron EXACT de `summaries/qualityHistory` (lecture du
  doc précédent, remplacement idempotent du point du jour, fenêtre glissante 90 j). Écrit dans le bloc
  `want("partenariats")` de `aggregate.js`. Couvert par ADR-P04 (états dérivés au recompute) — pas de
  nouvel ADR.
- Point PUR + testé : `domain/parQuota.parQuotaHistoryPoint` (+ `test/parQuota.test.js`).
- Front : carte « Tendance de conformité (30 j) » dans le tableau de bord Partenariats, via le composant
  `MultiLine` réutilisé de `design/charts` (recharts, chunk lazy — budget d'entrée inchangé à 118.1 KB).
- Préfixe `par_` ⇒ gaté par les rules existantes (drapeau + droit `partenariats`, pas de `rentabilite`).
  Vérif : `test-rules/rules.test.js` (par_quotasHistory lisible sous partenariats). functions 1107/1107,
  rules 73/73, web lint/build OK, no-undef OK.

**Appris**
- Le patron « snapshot quotidien » (qualityHistory / TACE history) est réutilisable tel quel pour toute
  nouvelle tendance : lire le doc, filtrer le jour courant, pousser, trier, `slice(-90)`. Idempotent au
  sein d'un recompute (coalescing sûr).

**Échoué / en attente**
- L'historique se construit à partir de zéro (aucun rétro-remplissage possible) : la courbe n'a de valeur
  qu'après plusieurs jours de recompute. Attendu, documenté (comme qualityHistory).

---

## Lot P4 — Push d'une assignation de certification en tâche ClickUp (liste dédiée)

**Fait**
- Callable `pushParAssignmentToClickup` : crée/met à jour (idempotent) une tâche ClickUp pour une
  assignation, dans la liste DÉDIÉE `config/clickup.parListId` (ADR-P10). Réutilise `lib/clickup`
  (createTask/updateTask) + secret `CLICKUP_TOKEN` — rien recréé. Payload PUR (`domain/parClickup`).
  Écriture `partenariats` + drapeau + rate-limit `clickup`. taskId/url stockés sur l'assignation
  (anti-doublon). Inactif si parListId non renseigné (défaut).
- Config : `setClickupConfig` accepte `parListId` (défaut vide) ; champ ajouté dans Habilitations → ClickUp.
- Front : onglet Assignations — bouton « Pousser / Resynchroniser » + lien vers la tâche.
- Tests `test/parClickup.test.js`. functions 1110/1110, deploy-targets 178, no-undef OK, bundle 118.1 KB.
  Aucune règle Firestore touchée (par_assignments déjà gaté ; taskId/url non confidentiels).

**Appris**
- Décision de convention (mélange d'entités dans le board ClickUp) validée par l'humain → liste dédiée
  plutôt que la liste commandes. Le défaut « parListId vide = inactif » garantit qu'aucune tâche ne part
  tant que l'ops n'a pas explicitement désigné une liste — cohérent avec « drapeau éteint = ERP d'avant ».

**Échoué / en attente**
- Pas de rattachement inverse (une tâche ClickUp fermée ne met pas à jour le statut de l'assignation) :
  sens app→ClickUp seulement, comme la v1 du push commande. Sens inverse = lot ultérieur si besoin.

---

## Lot P5 — Export CSV (référentiel de conformité + certifications + assignations)

**Fait**
- Boutons « Export CSV » dans le module Partenariats : conformité des quotas (tableau de bord),
  certifications des ingénieurs (onglet Certifications), assignations (onglet Assignations).
- RÉUTILISE `lib/exportCsv` (buildCsv/downloadCsv) — l'idiome d'export du module Reports : BOM UTF-8,
  séparateur « ; » (Excel FR), neutralisation de l'injection de formule. Aucune nouvelle dépendance.
- Composant `ExportCsvBtn` local (désactivé si aucune ligne). Front-only : aucun backend, aucune règle,
  aucun test nouveau (exportCsv a déjà sa suite). web lint/build OK, bundle 118.1 KB.

**Appris**
- L'idiome d'export tabulaire de l'ERP est le CSV (`exportCsv.ts`, ouvert nativement par Excel), pas un
  xlsx front. Le « premium » (slides) passe par pptx (codirPptx/parQbrPptx). On suit l'idiome, on n'ajoute
  pas de dépendance (xlsx/jsPDF auraient exigé un ADR de dépendance — interdit sans validation).

**Échoué / en attente (note, pas un changement silencieux)**
- « Excel/PDF » demandé → livré en CSV (Excel-compatible) : pas de PDF, car aucune lib PDF n'existe côté
  front (seul pptx pour les slides) et en ajouter une serait une dépendance nouvelle (ADR requis). Le CA
  constructeur (confidentiel) est VOLONTAIREMENT exclu des exports (seules les données non confidentielles :
  conformité, certifs, assignations). Un export PDF ou un export incluant le CA (gaté rentabilite) = lot
  ultérieur si le besoin se confirme.

---

## Lot P6 — Test de parcours de bout en bout + audit d'activation

**Fait**
- Test d'intégration DOMAINE `test/parParcours.test.js` : chaîne complète référentiel → certification
  (expiration + statut à date) → couverture des quotas → alertes de renouvellement → bulletins d'Actualité
  → point d'historisation. Deux scénarios (conforme / non conforme) prouvant la COHÉRENCE de bout en bout
  (un même signal — l'expiration — se retrouve identique dans la couverture, les alertes et les bulletins :
  invariant « même métrique = même nombre »). Pas de Playwright : le parcours gaté (drapeau + seed + secrets
  IA/ClickUp) n'est pas testable en navigateur sans environnement seedé ; le test domaine pur couvre la
  logique de bout en bout sans émulateur. functions 1114/1114.
- Audit d'activation (gardien + conformiste) sur le module étendu (P1-P5) — voir résultats/remédiations.

**Appris**
- La chaîne dérivée du module est entièrement PURE (domain/) : un seul test d'intégration vitest exerce
  tout le parcours métier sans I/O — le meilleur « filet » pour un pipeline de dérivation.

---

## Lot MES — Guide de mise en service + audit d'activation + remédiation conformité

**Fait**
- **Guide de mise en service** `docs/partenariats/07-MISE-EN-SERVICE.md` : prérequis, activation en 7 étapes
  (drapeau + droits → référentiel → mapping CA → certifs/assignations → canaux email/ClickUp), surfaces de
  visibilité, vérification & retour arrière. Aucun secret nouveau (réutilise l'existant).
- **Audit d'activation** du module étendu (P1-P5), deux passes :
  - **gardien = VERT** : zéro régression, zéro fuite de CA (5 surfaces vérifiées : par_news, CODIR, export
    CSV, email, payload ClickUp) ; drapeau éteint = ERP d'avant sur chaque point d'entrée ; buildNews intact ;
    contrôles mécaniques verts (functions 1114, rules 73, deploy 178, bundle 118.1 KB).
  - **conformiste = NON CONFORME** (3 écarts, tous sur le bouton d'export P5) → **remédiés** : réutilisation
    du composant partagé `design/bulk.ExportBtn` (libellé + nom de fichier `nt360-<name>-<stamp>.csv`
    conformes) au lieu du wrapper divergent ; dates d'export via `frDate` (JJ/MM/AAAA) au lieu d'ISO brut.
    `ExportCsvBtn` local supprimé. web lint/build OK, bundle 118.1 KB.

**Appris**
- La conformité (indiscernabilité) se joue dans les détails : un bouton d'export « maison » a suffi à créer
  trois divergences (libellé, nom de fichier, format de date). Réutiliser le composant partagé — pas juste
  la lib sous-jacente — est ce qui rend l'export réellement indiscernable des autres exports de l'ERP.
- L'audit adverse en DEUX rôles (gardien = casse/fuite, conformiste = indiscernabilité) attrape des choses
  orthogonales : le gardien a validé la sécurité, le conformiste a rattrapé le style.

## Formulaire de référentiel partenaire (création + objectifs) — 2026-07-18

**Fait.** Ajout d'un écran de **création/édition de partenaire** dans l'onglet Paramétrage (bouton
« Nouveau partenaire » + action « Éditer » par ligne). Le formulaire couvre niveaux, compétences,
catalogue de certifications (avec validité) et **exigences de quota** = les *objectifs du business plan*
(par niveau : minimum d'ingénieurs sur une compétence ou une certification). Front seul : il s'appuie sur
le callable `upsertParPartner` **déjà existant** (aucun changement backend, aucun nouvel export, aucun
`deployed-functions.txt` touché). Logique de préparation du payload extraite en helper PUR testé
(`web/src/lib/parPartnerForm.ts` : `buildPartnerPayload`/`partnerToForm`/`parSlug`, 6 tests) — le backend
`validatePartner` reste seul juge de l'intégrité référentielle et des slugs.

**Appris.** Le module était **livré mais non alimentable depuis l'UI** : le référentiel ne pouvait être
initialisé que par appel technique (`upsertParPartner`). Un utilisateur direction, module activé, tombait
sur un tableau de bord à zéro sans moyen évident d'y remédier — signalé en usage réel (capture). La leçon :
un module « complet » côté calcul peut rester **inutilisable** faute d'un point d'entrée de saisie ; la
complétude se mesure au parcours utilisateur de bout en bout, pas à la seule chaîne dérivée.

**Conception.** Clé locale stable par ligne (`k`) pour relier catalogue→compétence et exigence→niveau/cible
indépendamment des libellés saisis ; remappage vers les slugs au submit → intégrité préservée quel que soit
l'ordre d'édition. Aucune 2ᵉ vérité : mêmes primitives (Modal/Field/Select/Busy), même callable, formats et
voix de l'ERP. Pas d'ADR : additif, aucune nouvelle convention ni donnée (le callable et la structure du
référentiel préexistent au lot P0).

---

## PA1 — CRUD certifications/assignations : supprimer, éditer, cycle de vie — 2026-07-18

**Fait.** Câblage front des callables CRUD **déjà existants** mais non exposés dans l'UI (audit de
complétude Partenariats). Onglet **Certifications** : action « Éditer » (révise la date d'obtention) +
« Suppr. » (`deleteParCertification`) par ligne. Onglet **Assignations** : « Éditer » (révise l'échéance) +
« Suppr. » (`deleteParAssignment`) + **sélecteur de statut inline** couvrant le cycle de vie
(`setParAssignmentStatus`) — remplace le bouton unique « Marquer obtenue ». Front seul : aucun changement
backend, aucun nouvel export, `deployed-functions.txt` intouché (les 3 callables y figuraient déjà).

**Appris.** Deuxième symptôme du même défaut que le formulaire de référentiel : des callables de correction
existaient côté serveur (supprimer, changer de statut) sans **aucun point d'entrée UI** — une certif saisie
par erreur restait ineffaçable pour l'utilisateur. Complétude = parcours de bout en bout, pas seulement la
présence du callable.

**Conception.** Réutilise `DangerBtn` (confirmation + toast + trackWrite) comme le reste de l'ERP — pas de
`window.confirm`. Édition : l'id d'une certif/assignation étant **dérivé** (`consultant × catalogue`), le
formulaire verrouille ces clés en mode édition (seule la date change) et affiche « supprimez pour recréer »
— on ne laisse pas l'utilisateur croire qu'il déplace une certif. Sélecteur de statut : n'expose que les
statuts **pilotables à la main** (`a_planifier`/`planifie`/`en_formation`/`obtenu`) ; `en_retard` reste
**dérivé** de l'échéance (domain/parAssignment) et n'est jamais posé manuellement. Pas d'ADR : additif,
aucune nouvelle convention ni donnée (callables préexistants au lot Moteur de risque).

---

## Modèles constructeurs + listes vides guidées (formulaire partenaire) — 2026-07-18

**Fait.** Le formulaire « Nouveau partenaire » partait de la **page blanche** : sans niveaux ni
compétences saisis, les listes déroulantes des **exigences de quota** (« Niveau… », « Cible… ») étaient
**vides** sans explication (signalé en usage réel, capture). Deux corrections : (1) une rangée « Partir d'un
modèle » en tête de formulaire (création uniquement) pré-remplit tout le référentiel depuis un des grands
programmes constructeurs — **Fortinet Engage, F5 Unity+, Palo Alto NextWave, Huawei ICT** ; (2) une aide
apparaît dans le bloc Exigences quand une exigence existe mais qu'aucun niveau/cible n'est encore défini.
Alignement de deux libellés du bloc au token dominant (`text-[11px]`).

**Conception.** Modèles extraits en helper PUR testé (`web/src/lib/parPartnerPresets.ts` : `PARTNER_PRESETS`,
`buildPartnerPreset(id, nextKey)` ; 17 tests vérifiant l'intégrité référentielle certif→compétence et
exigence→niveau/cible, puis `buildPartnerPayload` sans id vide). Les clés locales sont fournies par le
compteur `nk()` du formulaire → aucune collision avec les lignes ajoutées ensuite. Ce sont des **points de
départ éditables** (codes de certif publics : NSE/FCP/FCSS, F5-CA/CTS/CSE, PCNSA/PCNSE, HCIA/HCIP/HCIE ;
niveaux et validités indicatifs) — l'utilisateur ajuste avant d'enregistrer, et le backend
`validatePartner` reste seul juge. Pas d'ADR : additif, front seul, callable `upsertParPartner` inchangé ;
les modèles sont des données d'amorçage éditables, pas une convention ni une vérité persistée.

---

## PA-DATA — Plan d'affaires partenaire + statut + amorçage données réelles — 2026-07-18

**Fait.** Intégration des deux fichiers de référence direction (`Partners_Status_Tracking`,
`CERTIFICATIONS_TOP_PARTENAIRES`). Élément **structurel** ajouté au module (ADR-P11) : le **plan d'affaires
partenaire**, absent jusqu'ici. Backend `domain/parPartner` (additif) : champs optionnels `status`,
`renewalDate`, `validationStatus`, `businessPlan` (objectif BP / réalisé YTD sur Pipeline/Booking/
Certifications/Croissance) + helper PUR `bpAchievement` (ratio par axe + % global = moyenne, reproduit la
colonne du fichier). Formulaire : bloc « Statut & plan d'affaires ». Tableau de bord : carte **« Plan
d'affaires par partenaire »** (% par axe + global, échéance, validation) — miroir du tableau direction, triée
les moins avancés en tête. Modèles constructeurs (`lib/parPartnerPresets`) refaits avec les **dix partenaires
clés réels** (statut, plan d'affaires, catalogue de certifs des fichiers).

**Appris.** Le vrai pilotage des partenariats à NT n'est pas la couverture des quotas (ce que le module
gérait) mais un **scorecard de plan d'affaires** à échéance de renouvellement — le fichier Excel que la
direction tient à la main. Un module « complet » côté certifications restait à côté de l'usage réel tant
qu'il n'exposait pas ce scorecard. Les fichiers ont aussi révélé le vrai vocabulaire (statuts Platinum/Expert/
Silver/Innovator…, axes BP/YTD, Validé/Presque validé/Non validé) — encodé tel quel.

**Conception.** Réalisé (YTD) **saisi à la main** = reproduire le fichier, pas dériver de l'ERP (pas de 2ᵉ
vérité ; dérivation = ADR distinct plus tard). Montants en **flottant** (comme l'ERP ; décimales compta du
fichier conservées — piège FCFA assumé). `bpAchievement` à **double miroir** back/front (invariant de parité).
Tout additif : aucun champ existant touché, `upsertParPartner`/`deployed-functions.txt` inchangés, bundle
118.3 KB. Tests : 12 (back parPartner) + 8 (parPartnerForm) + 51 (parPartnerPresets). Modèles = données
d'amorçage éditables (validités indicatives) ; le backend `validatePartner` tranche.

---

## PA-DATA2 — Top 20 partenaires : modèles réels + exigences de programme — 2026-07-18

**Fait.** Extension des modèles constructeurs de **10 à 20** (tous les partenaires du fichier
`Partners_Status_Tracking`) : ajout de **Sophos, Nutanix, Wallix, Jabra, Veritas, APC — Schneider, Tufin,
Rapid7, Allot, Juniper**. Chacun porte son **statut** courant, son **plan d'affaires** réel (BP/YTD par axe),
son **échéance** et son **statut de validation** issus du fichier, plus des **niveaux / compétences /
catalogue de certifications / exigences de quota** inspirés du programme constructeur réel (JNCIA→JNCIP pour
Juniper, NCA→NCM pour Nutanix, SCE/SCA pour Sophos, TCSA/TCSE pour Tufin, WBA/WCE pour Wallix, VCS-NetBackup
pour Veritas, InsightVM/IDR pour Rapid7, APC Secure Power / DCPI pour Schneider…). Exigences des 10 modèles
existants enrichies (2-3 par partenaire). Front seul (`lib/parPartnerPresets`), aucun backend touché.

**Appris.** Le fichier direction est un **classeur tenu à la main, aux formules incohérentes** entre colonnes
(le % Booking se blanchit à YTD=0, le % Cert affiche 0) — la reproduction exacte cellule-à-cellule est illusoire.
On garde la règle PROPRE et documentée de `bpAchievement` (ratio dès que l'objectif > 0, % global = moyenne des
axes évaluables) ; le % global peut donc différer très légèrement d'une ligne où une cellule était laissée
vide. C'est un choix assumé (calcul cohérent > mimétisme d'une incohérence de tableur).

**Conception.** Toujours des **données d'amorçage éditables** : validités (mois) et exigences INDICATIVES
(les fichiers ne les portent pas ; les programmes évoluent) — le backend `validatePartner` tranche à
l'enregistrement. Les modèles vivent dans le chunk LAZY du module (bundle d'entrée inchangé, 118,3 KB).
Tests : `parPartnerPresets.test.ts` couvre les 20 (intégrité référentielle + plan d'affaires calculable) —
101 cas.

---

## PA2 — Niveau de partenariat tenu + écart au niveau suivant — 2026-07-18

**Fait.** Helper PUR `web/src/lib/parTier.ts` (`tierProgress`) : à partir des niveaux d'un partenaire (rangs)
et de la couverture de ses exigences de quota (summary `par_quotas`), dérive le **niveau tenu** (plus haut
palier dont toutes les exigences ET celles d'en dessous sont couvertes — échelle CUMULATIVE), le **prochain
niveau** et l'**écart** (exigences manquantes : cible, détenteurs/minimum, manque). Surfacé en trois colonnes
sur la carte « Conformité des quotas » du tableau de bord (+ export). 5 tests.

**Conception.** **Aucun re-calcul de couverture** : on interprète les `ok` déjà produits par le backend →
mêmes chiffres que la carte de conformité (invariant de parité respecté). Front seul, additif, aucun backend
touché. Un niveau sans exigence est « couvert » (rien à satisfaire), cohérent avec le backend. Bundle
d'entrée inchangé (118,3 KB). Pas d'ADR : additif, aucune nouvelle donnée ni convention.

---

## PA3 — Supprimer un partenaire + garde d'intégrité (orphelins) — 2026-07-18

**Fait.** Bouton **« Suppr. »** (DangerBtn) par ligne du référentiel des partenaires (Paramétrage), câblé sur
le callable **déjà existant** `deleteParPartner`. **Garde d'intégrité** : la confirmation compte les
certifications/assignations rattachées (par `partnerId`) et prévient qu'elles deviendront **orphelines** (à
supprimer séparément) — `deleteParPartner` ne cascade pas. Colonne « Rattachés » ajoutée au tableau pour voir
le lien avant d'agir. Front seul (certifs/assigns déjà chargées en temps réel), aucun backend touché,
`deployed-functions.txt` intouché.

**Conception.** Réutilise `DangerBtn` (confirmation + toast) comme le reste de l'ERP. On **prévient** plutôt
que de bloquer (le backend autorise la suppression) : cohérent avec l'esprit additif et laisse la décision à
l'utilisateur, tout en rendant le risque visible. Pas d'ADR : additif, aucune nouvelle donnée ni convention.

---

## PA4 — Relance de renouvellement de certif au manager de l'ingénieur — 2026-07-18

**Fait.** Les managers recevaient déjà par email (`parRelancesSweep`) leurs **assignations** à relancer, mais
les **renouvellements de certif** (par_alerts ≤ 90 j) n'allaient qu'au digest DIRECTION (par_alerts n'avait pas
de destinataire). Comblé : (1) `upsertParCertification` dénormalise désormais le **managerUid** du consultant
(comme les assignations) ; (2) `certRenewalWatch` remonte ce managerUid sur chaque item ; (3) `parRelancesSweep`
groupe les renouvellements par manager (`groupParAlertsByManager`) et envoie à chaque manager **un seul email**
couvrant SES assignations à relancer ET SES certifs à renouveler (section dédiée dans `buildParManagerEmail`).

**Conception.** Additif, aucun nouvel export (parRelancesSweep préexiste ; `deployed-functions.txt` intouché).
Grouping factorisé en `groupByManagerUid` (une logique, deux sources). Tests : `parAlert` (managerUid remonté)
+ `emailNotify` (section renouvellements + grouping alertes). **Migration douce** : une certif écrite AVANT ce
lot n'a pas de managerUid tant qu'elle n'est pas ré-enregistrée → elle reste au digest direction (filet), pas
d'orphelin. Pas d'ADR (extension d'ADR-P08 : relances email par manager).
