# Journal — Partenariats & Certifications

> Append-only. Fait / appris / échoué. Le plus récent en tête (après ce bloc de format).

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
