# Journal — Partenariats & Certifications

> Append-only. Fait / appris / échoué. Le plus récent en tête (après ce bloc de format).

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
