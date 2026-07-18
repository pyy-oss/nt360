# Journal — Partenariats & Certifications

> Append-only. Fait / appris / échoué. Le plus récent en tête (après ce bloc de format).

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
