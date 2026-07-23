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

## 2026-07-18 — Remédiation d'audit revenu (retrait Reconnaissance incohérente + fix arrondi MRR)

**Fait** — audit adverse (gardien) des lots revenu #453/#454 sous la barre « zéro incohérence ». 2 constats
certains, corrigés.

- **Blocage 1 — Reconnaissance du revenu RETIRÉE.** Le KPI « Facturé » de la carte confrontait un
  `reconnu` **maintenance par contrat** (`sousFacturation.engage`) à un `facturé` **de l'affaire entière**
  (`sousFacturation.facture` = Σ factures HT du FP, sans filtre maintenance). Double périmètre → (a)
  **double-compte** quand deux contrats scorés partagent un `fpKey` (chacun reçoit le même facturé affaire),
  (b) inclusion des factures projet non-maintenance. L'écart (à-facturer / facturé-d'avance) comparait donc
  deux natures différentes. **Aucune correction cohérente sans allocation facture↔contrat** (donnée absente)
  → la carte + `revenueRecognition` + tests sont **retirés** plutôt que de servir un chiffre faux. La
  réconciliation reconnu/facturé demandera un vrai périmètre maintenance (lot dédié).
- **Blocage 2 — arrondi MRR.** MRR par groupe = `round(ARR/12)` pouvait faire Σ(lignes) ≠ MRR consolidé. La
  **colonne MRR par groupe est retirée** (l'ARR entier somme juste) ; le MRR n'est plus affiché que consolidé
  (KPI). `risqueItems` remémoïsé retiré (n'avait de sens que pour la reconnaissance).
- Axes audités PROPRES : `recurringRevenue.totalArr` = `arrActifs` (même assiette/annualise), sémantique
  reconnu back correcte, aucune régression, confidentialité, « éteint = ERP d'avant ».
- 149 tests web verts, lint exit 0, bundle 119,9 KB.

**Décidé**
- Ne pas livrer un KPI dont la définition n'est pas stable (« Facturé » variait avec le nb de contrats par FP
  et le facturé projet). La reconnaissance consolidée fiable nécessite une allocation des factures au
  périmètre maintenance — hors de ce lot, à arbitrer.

**Échoué / abandonné**
- La carte « Reconnaissance du revenu » (livrée #454) : retirée en remédiation, définition non fiable.

---

## 2026-07-18 — Reconnaissance du revenu (reconnu vs facturé) — DO Lot 4 (reconnaissance)

**Fait**
- `revenueRecognition(items)` (pur, `mntRisque.ts` front) : réconcilie le revenu **reconnu à ce jour**
  (échéancier engagé) au **facturé** réel, dérivé des items du moteur de risque (`sousFacturation` =
  MÊME source que le signal de sous-facturation → mêmes nombres). Rend `reconnu`, `facture`,
  `aFacturer` (couru = Σ max(0, reconnu−facturé), « CA qui dort »), `factureAvance` (constaté d'avance =
  Σ max(0, facturé−reconnu)) — sommés **séparément** (ne se compensent pas).
- Carte « Reconnaissance du revenu » : 4 KPIs (reconnu / facturé / à facturer / facturé d'avance).
- Perf : `risqueItems` mémoïsé (identité stable → mémos dérivés fiables, corrige un avert. react-hooks).
- Tests `mntRisque.test.ts` (+2). 151 tests web verts, lint OK, bundle 119,9 KB.

**Appris sur l'existant**
- Le moteur de risque calcule DÉJÀ, par contrat actif, `sousFacturation {engage, facture, ecart}` (échéancier
  reconnu vs facturé par fpKey). La reconnaissance consolidée en dérive **sans backend** ni chargement de
  factures côté front, avec cohérence garantie (source unique = summaries/mnt_risque).

**Décidé**
- Scopé au **module maintenance** (pas au niveau overview) pour rester additif et **ne pas toucher
  l'invariant `overviewCalc`/`chaine.js`** (P0). La reconnaissance consolidée toute-entreprise (projets +
  contrats), plus structurante, reste un lot dédié à arbitrer. Pas d'ADR (dérivé, même source, additif).

**Échoué / abandonné**
- (rien)

---

## 2026-07-18 — Revenu récurrent CONSOLIDÉ (MRR/ARR) — DO Lot 4 (récurrent)

**Fait**
- `recurringRevenue(contrats)` (domaine pur `mntDashboard.ts`) : consolide le revenu récurrent des contrats
  ACTIFS — **ARR** (montant par échéance annualisé, **même `annualise()`** que le KPI ARR → mêmes nombres),
  **MRR = ARR ÷ 12** — ventilé par **BU**, **client** et **périodicité** (ARR décroissant). MRR dérivé de
  l'ARR au niveau groupe (pas par contrat) → pas de dérive d'arrondi.
- Carte « Revenu récurrent (consolidé) » dans le module maintenance : KPIs MRR/ARR consolidés + nb clients,
  tables Par BU / Top clients (ARR), badges par périodicité. Vue direction de la **base récurrente engagée**
  (prévisible), distincte du revenu one-shot des projets.
- Tests `mntDashboard.test.ts` (+2). 149 tests web verts, lint OK, bundle 119,9 KB.

**Appris sur l'existant**
- Le KPI `arrActifs` du tableau de bord donne déjà l'ARR total ; il manquait la **ventilation** (BU/client/
  périodicité) et le **MRR**. Réutilisation stricte de `annualise()` (source unique) → `totalArr` =
  `arrActifs`, invariant « même métrique = même nombre » tenu.

**Décidé**
- Additif, front pur (pas de callable, pas de summary), pas d'ADR : dérivé des contrats déjà chargés, même
  assiette (contrats actifs) et même annualisation que le KPI existant. Aucune donnée confidentielle
  (montant engagé = revenu, pas coût). Gaté `maintenance` + drapeau via le module.

**Échoué / abandonné**
- (rien)

---

## 2026-07-18 — Audit du programme (astreintes + overlay) + remédiation

**Fait** — audit adverse en parallèle (gardien back + conformiste UI) des lots #450 (overlay) et #451
(astreintes). **2 blocages back + 3 écarts UI CERTAINS corrigés**, autres axes propres.

- **Blocage 1 (gardien) — invariant « éteint = ERP d'avant » rompu** : `deliveryMarginByAffaire` lisait
  `mnt_astreintes` et retranchait la charge **sans garde de drapeau** → la marge de livraison restait amputée
  module éteint. Corrigé : lecture/soustraction gatées sur `mntEnabled()` (patron du fichier), `{}` sinon.
- **Blocage 2 (gardien) — fuite du montant confidentiel** : le montant transitait en clair dans
  `approvals.amount` et `listApprovals` le renvoyait à l'approbateur (droit `pipeline` seul), contredisant la
  promesse ADR-035. Corrigé : `listApprovals` **masque `amount` (null) pour les astreintes** sans droit
  `rentabilite`. ADR-035 mis à jour (masquage de bout en bout, y compris boîte d'approbation).
- **Écarts UI (conformiste)** : (a) champ montant d'astreinte saisi via `decimals` (autorise décimales) →
  remis à `digits` (le FCFA n'a pas de subdivision, comme « Montant engagé ») ; (b) « Chargement… » de la
  carte Astreintes remis aux tokens standard (`text-[13px] text-muted py-3`) ; (c) modale de **consultation**
  de contrat (lecture seule) repassée `form → md` (un aperçu n'est pas une saisie, comme l'aperçu d'import).

**Appris sur l'existant**
- Le système d'approbation porte `amount` en clair pour toutes les natures (remise/DR/BC) — non confidentiel
  pour celles-là (pipeline), mais l'astreinte est un **coût** (rentabilite) : il fallait masquer au lecteur.
- L'invariant « éteint = ERP d'avant » doit être tenu sur **chaque** consommateur d'une collection mnt_, y
  compris les callables non-mnt_ (ici `deliveryMarginByAffaire`, gouverné `rentabilite`) — pas seulement le
  recompute.

**Décidé / signalé (sans correction dans ce lot)**
- `callFn` inline (module lazy) réutilisé plutôt que d'ajouter à `writes.ts` (budget du chunk d'entrée) —
  assumé (précédent `finance.tsx`). Divergence mineure signalée par le conformiste, non bloquante.
- `backlog.tsx:929/951` : `text-amber-400` (couleur brute hors tokens) — **pré-existant**, hors périmètre
  des deux lots ; noté pour un futur passage de conformité.

**Échoué / abandonné**
- (rien)

---

## 2026-07-18 — Astreintes : demande + validation + comptabilité en charge (ADR-035)

**Fait**
- Nouvel objet `mnt_astreintes` (domaine pur `mntAstreinte.js` : `validateAstreinte` + `astreinteCostByFp`).
  Une astreinte porte un N° FP obligatoire (affaire), un contrat optionnel, une période et un `montant`
  (charge saisie, XOF) — **première ligne de coût saisissable de l'ERP**.
- **Demande + validation** : réutilisation du workflow d'approbation (enum `astreinte` ajouté à
  `domain/approval.js`). `submitAstreinte` crée l'objet + la demande ; `decideApproval` existant décide ;
  le trigger `onMntApprovalDecided` porte l'effet (statut → `validee`/`rejetee`). Zéro mécanisme dupliqué.
- **Comptabilisation** : `astreinteCostByFp` (astreintes validées, par fpKey) — SOURCE UNIQUE — alimente
  `computeContratPnl` (composante `coutAstreintes`) ET `deliveryMargin` (retranchée du labor). Injecté aussi
  dans le recompute (score de risque via le palier ADR-034) et les callables mntContratPnl /
  deliveryMarginByAffaire. Front : carte « Astreintes » (demande via modale « form », liste + statut),
  charge ajoutée au tooltip de coût de la rentabilité.
- Confidentialité : `mnt_astreintes` callable-only en lecture (`allow read: if false`) ; `listAstreintes`
  et `coutAstreintes` masqués sans droit `rentabilite`. Callables inline (module lazy) → budget bundle tenu.
- Tests : `mntAstreinte.test.js` (+8), `mntContratPnl.test.js` (+2), `deliveryMargin.test.js` (+1),
  parité approbations OK. 1057 tests back + 147 web verts, gardes CI vertes, bundle 119,9 KB.

**Appris sur l'existant**
- Le workflow d'approbation est **générique** (`kind`/`entityType`/`entityId`/`amount`) et déjà étendu
  additivement par le module (mnt_contrat) : l'effet d'une décision passe par le trigger unique sur
  `approvals/{id}`, qui filtre par `entityType`. L'astreinte s'y insère sans nouveau trigger.
- L'ERP n'avait **aucune** ligne de coût saisissable (constat cartographie) : l'astreinte est un rail neuf,
  mais purement additif (ni dans le P&L importé ni dans le CRA labor) → pas de double-compte.

**Décidé**
- ADR-035 : montant confidentiel (callable-only + masquage), imputation par fpKey (source unique),
  comptabilisée à la validation. Limite assumée : astreinte hors carnet ET hors contrat non comptabilisée.

**Échoué / abandonné**
- (rien)

---

## 2026-07-18 — La rentabilité entre dans le score de risque des contrats (ADR-034)

**Fait**
- 5e signal `marge_faible` ajouté au moteur de risque (`mntRisque`) : `negative` (marge < 0, +30) ou
  `faible` (0 ≤ marge < 15 %, +15). Un contrat en perte n'est plus « Vert » par défaut.
- Calcul de la marge **côté serveur** (recompute) via `computeContratPnl` — **source unique** de la marge,
  donc même nombre que la vue Rentabilité — réduit à un **palier** par `margeRisqueNiveau(row)`. Seul le
  palier entre dans `summaries/mnt_risque` (lu sous droit `maintenance`) : **le montant confidentiel n'y
  transite jamais** (il reste dans le callable gaté `mntContratPnl`). Pas de fuite RBAC.
- `mntRisque` reste PUR : il **reçoit** `margeByContrat` (map contratId → palier), ne calcule pas la marge.
- Miroir front `mntRisque.ts` : type `marge_faible`, `signalText` distingue « Marge négative » / « Marge
  faible », `RisqueItem.margeNiveau` exposé. La pastille apparaît automatiquement dans la table de risque.
- Tests : `mntRisque.test.js` (+3 : paliers negative/faible/absent), `mntContratPnl.test.js` (+4 :
  `margeRisqueNiveau`), `mntRisque.test.ts` front (+1 : libellé par sévérité). 1046 tests back verts.

**Appris sur l'existant**
- Le recompute charge `orders` inconditionnellement → le coût P&L par FP (`costTotal`) est dérivable dans
  le bloc risque sans dépendre de la garde `commandes`. CJM lu de `consultants.select("cjm")`, interventions
  de `mnt_interventions` : même assiette que le callable `mntContratPnl`, donc chiffres cohérents.

**Décidé**
- ADR-034 : divulgation **qualitative** de la santé de marge aux détenteurs `maintenance` (jamais le
  montant). Seuil 15 % ajustable. Signal prudent (hérite d'ADR-033) : plancher, jamais de sur-alerte de coût.

**Échoué / abandonné**
- (rien)

---

## 2026-07-18 — Correctif : « Montant engagé (actifs) » → Revenu récurrent annuel (ARR)

**Fait**
- Le KPI de tête du tableau de bord contrats additionnait des `montantEngage` **par échéance** de
  périodicités hétérogènes (mensuel + trimestriel + annuel) → un total sans signification (un mensuel
  1 M et un annuel 1 M pesaient pareil). Correctif : annualisation avant somme, sur les seuls contrats
  actifs. Helper `annualise(montantEngage, echeanceType)` = `montant × (12 / PERIOD_MONTHS[type])`,
  miroir de `functions/domain/mntEcheancier.PERIOD_MONTHS` (`mensuel:1, trimestriel:3, annuel:12`).
- Champ `MntDashboard.montantEngageActifs` renommé `arrActifs` (revenu récurrent annualisé, FCFA entier).
  KPI relibellé **« Revenu récurrent annuel (ARR) »** + sous-titre *« contrats actifs · annualisé »*.
- Test `mntDashboard.test.ts` réécrit : 1 M mensuel + 0,5 M trimestriel + 3 M annuel → **17 M** ARR
  (au lieu de 4,5 M avant, une somme de périodicités mélangées).

**Appris sur l'existant**
- `montantEngage` est bien le montant **par échéance** (confirmé par `mntEcheancier`, où `PERIOD_MONTHS`
  sert déjà à générer les échéances) — pas un montant annuel. Le KPI le traitait à tort comme sommable
  tel quel. Aucun autre lecteur du champ (grep `montantEngageActifs` → 0 hors définition).

**Décidé**
- Correctif de présentation additif, pas d'ADR : mêmes données, même population (contrats actifs),
  seule l'unité du KPI est corrigée (par-échéance → annuelle). Aucun schéma, aucun callable touché.

**Échoué / abandonné**
- (rien)

---

## 2026-07-18 — Actions opérationnelles sur les tables (de la visualisation à la gestion)

**Fait**
- Retour terrain : *« le module est encore trop de la visualisation, pas assez de gestion opérationnelle ».*
  Ajout d'actions contextuelles sur les tables purement descriptives, en réutilisant les callables existants :
  - **Rentabilité** → « Saisir un temps » (ouvre le ticket du contrat pré-rempli → l'intervention impute enfin
    un coût aux affaires à 0 j — corrige la cause du 100 % côté saisie).
  - **Risque** → « Ticket » (ouvre un ticket pré-rempli) + « S'abonner / Abonné » (`toggleWatchContrat`).
  - **Calendrier SLA** → « Traiter » (ouvre le ticket concerné, `openEditTicket`).
  - **Rétention / churn** → « Renouveler » (`submitMntDecision` renouvellement, via fp→id contrat).
  - **Renouvellements** → « Résilier » ajouté à côté de « Renouveler » (symétrie des décisions).
- Helper transverse `openTicketFor(contratId)` (modal ticket pré-rempli) + `contratIdByFp` (résolution FP→id
  par fpKey). Aucune nouvelle route, aucun nouveau formulaire : réutilisation stricte du modal ticket existant.

**Appris sur l'existant**
- Une intervention appartient à un ticket (`upsertMntIntervention` exige `ticketId`) : le point d'entrée
  opérationnel pour imputer un coût est donc toujours le modal ticket. `RisqueItem`/`MntRenouvellement`/
  `MntContratPnlRow` portent déjà l'id contrat ; seul le churn est clé-FP (d'où `contratIdByFp`).

**Décidé**
- Additif UI pur (pas d'ADR) : aucune métrique/donnée nouvelle, réutilisation des callables gouvernés.

**Échoué / abandonné**
- (rien)

---

## 2026-07-18 — Rentabilité contrat : coût = interventions + P&L affaire (ADR-033)

**Fait**
- Retour terrain : **tous** les contrats affichaient une marge de **100 %** (Coût 0). Cause confirmée :
  `computeContratPnl` ne comptait le coût que des interventions (jours CRA × CJM), rarement saisies → coût 0.
- `computeContratPnl` reçoit désormais `pnlCostByFp` et ajoute le **coût P&L de l'affaire** (achats +
  provisions du carnet), rapproché **par fpKey**, exposé en deux composantes (`coutInterventions`, `coutPnl`),
  masquées sans droit `rentabilite`. Le handler lit `commandesRowsMargin` (isolé marge, même droit).
- Front : type + colonne « Coût » avec détail au survol + Tip recadré (coût total, marge prudente). ADR-033.
- Tests : composition P&L + interventions, rapprochement fpKey (zéros de tête), masquage sans droit.

**Appris sur l'existant**
- Le coût carnet par affaire vit dans `commandesRowsMargin` (chunks `{i, rows:[{fp,costTotal}]}`) — la marge
  isolée des `orders` de base par le recompute (rules), lisible sous le droit `rentabilite`. Source à réutiliser
  pour tout rapprochement coût↔affaire côté contrats.

**Décidé**
- ADR-033 (coût contrat = interventions + P&L affaire ; limite « marge prudente » assumée).

**Échoué / abandonné**
- (rien — correctif ciblé)

---

## 2026-07-15 — Audit de vérification de la remédiation (#381/#382) — 3 axes

**Fait** — audit adverse du diff de remédiation (`015702d..f0a5be1`), focalisé sur le code PARTAGÉ
(`domain/timesheet.js`, `handlers/timesheets.js`) dont dépendent Activité/Rentabilité. Verdict :
- **Non-régression : VERT.** `computeConstat` (mois distincts) = no-op strict sur toute donnée que le code
  peut produire (tous les writers `timesheets` en id déterministe `consultant_mois` merge → nb docs = nb mois
  distincts pour le legacy). Forme de sortie inchangée (le `Set _months` ne fuit pas). Drapeau OFF = ERP
  d'avant, `mntEnabled()` fail-safe = false. `computeTaceTrend` sans biais résiduel.
- **Bugs : aucun confirmé.** Le fallback `prise_en_compte→resoluMs` prouvé MONOTONE (ne peut que faire
  rompu→respecté, jamais l'inverse). 2 edges LOW non productibles (données dégénérées). Tests non-tautologiques.
- **Conformité/parité : CONFORME.** Miroirs `mntSla.js`↔`mntSla.ts` exacts ; runbook & ADR-017/018 fidèles.

**Appris / durci** — seule condition où mois-distincts changerait un chiffre legacy : **doublon historique**
`(consultant, mois)` non-mnt (pollution manuelle, impossible via les callables). Ajout d'un **contrôle
pré-vol R0** au runbook de recette (grouper `timesheets` hors `mnt`, refuser `count>1`).

**Suivant** — néant : remédiation propre, module clos. Reste optionnel (toggle in-app du drapeau).

---

## 2026-07-15 — Runbook de recette & activation (07-RECETTE-ACTIVATION.md)

**Fait** — `docs/contrats/07-RECETTE-ACTIVATION.md` : procédure de recette (12 étapes R1–R12 à critère
mécanique), d'activation (déploiement → RBAC `maintenance` → drapeau `config/mntFeature`) et de rollback
(éteindre le drapeau = ERP d'avant, données conservées). Limites v1 tracées (ADR-006/015/017/018).

**Appris sur l'existant** — aucun setter/UI pour `config/mntFeature` : l'activation se fait par écriture
Firestore directe (console/Admin SDK). ADR-009 évoquait « édité en Habilitations » → toggle in-app = évolution
optionnelle (signalée dans le runbook §3.3 et §5), non requise pour activer.

**Suivant** — module prêt pour la recette ; à la main de la direction pour l'allumage.

---

## 2026-07-15 — Suite d'audit : interaction maintenance↔CRA (décisions direction 1A + 2A)

**Fait** — clôture des deux constats de politique produit laissés en attente (B1/M1), après arbitrage
direction (**1A + 2A**, ADR-018) :
- Helper PUR `excludeMaintenance` (`domain/timesheet.js`) : écarte les CRA `source:"mnt"` d'une liste.
- **B1 / 1A** — `timesheetKpis` + `taceHistory` (activité) : la contribution `mnt` est écartée **quand le
  drapeau est éteint** → TACE/occupation redeviennent strictement celles d'avant le module.
- **M1 / 2A** — `resourcePnl` (marge) + `preBillingFromCra` (pré-facturation) : contribution `mnt`
  **toujours écartée** de la valorisation au TJM (les jours sont couverts par le forfait `montantEngage`,
  ADR-005) → plus de double compte revenu.
- Test PUR ajouté (`excludeMaintenance` + TACE sans la contribution mnt).

**Appris sur l'existant**
- `computeTaceTrend` calcule le TACE PAR MOIS (dénominateur 20 j fixe) → pas de biais « double-mois »
  comme `computeConstat` ; seule la contribution `mnt` devait y être gatée par le drapeau (fait).

**Décidé** — ADR-018 (interaction maintenance↔CRA : activité gatée par le drapeau, jamais valorisée au TJM).

**Suivant** — correctif de lisibilité ClickUp (relabel admin.tsx) en PR séparée (hors module).

**Vérif** : functions 869 (89 fichiers) · no-undef 117 · deploy-targets 146.

---

## 2026-07-15 — Audit adverse du module (4 axes) + remédiation des constats certains

**Fait** — audit adverse en 4 axes parallèles (sécurité/RBAC + extinction, cohérence des chiffres,
conformité au kit, chasse aux bugs). Correctifs des constats CERTAINS (bugs de correction, non-policy),
chacun testé :
- **BUG1 (SLA prise en compte, HAUTE)** — un ticket résolu en PREMIER CONTACT (`ouvert→resolu` sans
  `en_cours`) a `priseEnCompteLe=null` → `slaState` basculait « rompu » à tort. `mntRisque.js` : pour un
  engagement `prise_en_compte`, `markMs` retombe sur `resoluMs` (pris en compte au plus tard à la résolution).
- **BUG2 (couverture `h24`, MOY/HAUTE)** — `slaState` ignorait `couverture` (tout en jours ouvrés). Ajout
  de l'horloge **calendaire 24/7** pour `h24` (`mntSla.js` + miroir `mntSla.ts`). → **ADR-017**.
- **BUG3 (échéancier, contrat non démarré)** — `dateDebut` future comptait déjà 1 échéance → fausse
  sous-facturation. Garde `asOf >= dateDebut` (`mntEcheancier.js` + miroir).
- **B2 (CRA double-mois, HAUTE)** — `computeConstat` comptait les DOCUMENTS comme des mois : un consultant
  avec CRA manuel + contribution maintenance le même mois obtenait `months=2` → TACE ≈ divisé par 2 et coût
  de banc gonflé (marge faussée via `resourcePnl`). Corrigé : **mois calendaires DISTINCTS** (`domain/timesheet.js`).
  `billedDays` continue de s'additionner (une seule vérité du temps, ADR-013). Test de régression ajouté.
- **Conformité (montant)** — le champ « Montant engagé » affichait `fmt()` (abrège « 1,2 M ») dans un
  INPUT → corruption à la frappe (`digits("1,2 M")`="12"). Lié à la valeur brute, comme les 5 autres champs
  montant de l'ERP (`maintenance.tsx`).

**Appris sur l'existant**
- `computeConstat` (autorité CRA) comptait les documents, pas les mois : bug LATENT que la 2ᵉ source
  d'écriture (`timesheets/mnt_*`) a révélé. Le fix (mois distincts) est correct universellement.
- Cohérence des chiffres du Lot 5 : **SAINE** (le front ne recalcule jamais le score, miroirs SLA/échéancier
  byte-identiques, rapprochement par `fpKey`). Aucun correctif nécessaire sur cet axe.

**Échoué / abandonné** — rien.

**Dette assumée / EN ATTENTE DE DÉCISION (non corrigé dans cette passe)**
- **B1 (invariant « éteint = ERP d'avant »)** : les docs `timesheets/mnt_*` créés drapeau ALLUMÉ
  subsistent après extinction et continuent d'alimenter TACE/marge (les 4 consommateurs CRA ne filtrent pas
  `source`). Violation de la règle intouchable n°6 dès que le drapeau a été allumé une fois.
- **M1 (double facturation potentielle)** : les jours d'intervention `mnt_` (forfait `montantEngage`,
  ADR-005) sont valorisés au TJM dans la marge (`resourcePnl`) et proposés à la pré-facturation
  (`preBillingFromCra`) → risque de double compte revenu.
- B1 et M1 sont des **décisions produit** (interaction maintenance↔CRA sur des KPI de production) →
  **question posée à la direction** avant correctif (PR de suivi dédiée).

**Décidé** — ADR-017 (horloge SLA `h24` calendaire).

**Suivant** — décision direction sur B1/M1 → PR de suivi ; puis correctif lisibilité ClickUp (hors module).

**Vérif** : functions 868 (89 fichiers) · web 90 · no-undef 117 · deploy-targets 146 · bundle 115.5 KB · lint web propre.

---

## 2026-07-15 — Lot 5 (Moteur de risque — DERNIER lot du module)

**Fait**
- **Moteur PUR** `functions/domain/mntRisque.js` : score [0..100] + palier (Vert/Ambre/Rouge/Critique)
  par contrat ACTIF, à partir des 4 signaux décidés (SLA rompus via `slaState`, échéance proche ≤ 60 j,
  quota dépassé, sous-facturation via `echeancier`). Rapprochement facture par `fpKey`. Testé (10 tests).
  Formule/poids/seuils → **ADR-016**.
- **C3 (recompute)** : bloc ADDITIF dans `lib/aggregate.js`, DOUBLEMENT gaté (`want("maintenance")` +
  drapeau `config/mntFeature`). Écrit UN seul chemin nouveau `summaries/mnt_risque` (ADR-003). Horodatages
  Firestore → ms à la frontière I/O (domaine pur). **Caractérisation** `mntRecomputeGate.test.js` : faux
  Firestore, recompute complet — drapeau off ⇒ zéro écriture `mnt_*` ; on ⇒ diff = exactement
  `{summaries/mnt_risque}` (aucun summary existant altéré/retiré).
- **C7/C8 (notif)** : cron `mntSlaSweep` (quotidien 07:30) — digest de risque à la **direction** (liste
  `codir`) + à chaque **AM** (ses contrats, nom→email annuaire). Verrouillé par le drapeau ⇒ no-op strict
  éteint. Trigger `maintenance` ADDITIF dans `emailNotify.TRIGGERS` (défaut `true`), builder
  `buildMntRisqueEmail`. `deployed-functions.txt` +1 (146 fns).
- **Rules** : `summaries/mnt_risque` → module `maintenance` (`summaryModule`) + second verrou du drapeau
  dans `match /summaries` (conjoint toujours vrai pour les summaries existants → comportement inchangé).
  Test de règles ajouté (double verrou, comme les collections `mnt_*`).
- **Front** : miroir `web/src/lib/mntRisque.ts` (libellés/tons, **aucun recalcul de score** — le score
  vient du summary, une seule vérité) + carte « Risque des contrats » (KPI par palier + table à risque)
  dans `maintenance.tsx`, lue via `useDocData("summaries/mnt_risque")` (gaté). Chunk 19.5 KB (lazy).

**Appris sur l'existant**
- Les tickets ne portent pas de champ `date` : le mois de quota se dérive de `ouvertLe` (Timestamp).
- `Kpi` accepte un ton libre (`keyof TONES | string`) → `plum/clay/gold/emerald` passent sans ajout.

**Échoué / abandonné**
- Rien d'abandonné. `TaskCreate` refusé une fois (paramètres Agent au lieu de `subject`) — corrigé.

**Dette assumée**
- Poids de score = hypothèse de départ (ADR-016) ; recalibrage possible dans le domaine pur à l'usage.
- ADR-015 (matérialisation historique des ruptures SLA) reste reporté : le score suffit à la v1 ; seul
  l'état COURANT est matérialisé (pas la série temporelle des ruptures).

**Décidé**
- ADR-016 (formule de score + paliers). Réutilise ADR-003 (matérialisation), ADR-008 (palette),
  ADR-002/005 (SLA/échéancier).

**Suivant**
- Audit adverse complet du module (sécurité/RBAC, cohérence des chiffres, 10 règles intouchables,
  non-régression, « éteint = ERP d'avant », vérification adverse des trouvailles).
- Correctif de lisibilité ClickUp (relabel admin.tsx) — PR séparée, hors périmètre module.

**Vérif** : functions 863 (89 fichiers) · web 88 · test:rules 69 · no-undef 117 · deploy-targets 146 ·
indexes OK · bundle 115.5 KB · lint web propre.

---

## 2026-07-15 — Lot 4 (Renouvellements & résiliations via approvals)

**Fait**
- Extension ADDITIVE du domaine d'approbation (`domain/approval.js`) : `APPROVAL_KINDS` += `renouvellement_contrat`,
  `resiliation_contrat` ; `APPROVAL_ENTITIES` += `mnt_contrat`. Aucune valeur retirée.
- Callable `submitMntDecision` (`handlers/maintenance.js`) : gouverné `maintenance` + drapeau, RÉUTILISE
  le moteur existant (`validateApprovalRequest`/`approverFor`/`ownerChain`, collection `approvals`,
  `visibleTo`) — routage vers le manager (sinon direction), audité. La DÉCISION (approuver/rejeter) passe
  par le callable `decideApproval` et l'écran **Approbations** existants (aucun circuit recréé — ADR-004).
- `index.js` : +1 export (injection `loadUsersMap`/`anyDirectionUid`), `deployed-functions.txt` +1 (145 fns).
- Front : wrapper `writes.ts` + boutons « Demander le renouvellement / la résiliation » dans la fiche
  contrat (Busy), visibles seulement en édition d'un contrat existant + droit `maintenance`.

**C6 — frontière DÉPLACÉE (volontaire)** : le test de caractérisation `mnt-caracterisation.test.js` a été
mis à jour DANS ce lot — il affirmait « renouvellement rejeté aujourd'hui », il affirme désormais
« accepté (moteur inchangé, valeurs ajoutées) ». C'est le signal attendu que la frontière C6 a bougé.

**Filet / vérif — TOUT VERT**
- `functions` **849** (C6 mis à jour, `approval.test.js` non régressé), `web` **85**, `test:rules`
  **68** (inchangé — écriture `approvals` en Admin SDK), build OK, **chunk 115,5 KB ≤ 120**,
  no-undef (116), deploy-targets (**145**), indexes, lint : verts.

**Points de contact touchés**
- **C6** (approbations) : extension additive du domaine + test de frontière mis à jour ; le moteur et
  les demandes existantes restent valides (non-régression prouvée par `approval.test.js` + le 3ᵉ cas C6).
- **C4** : +1 callable (`deployed-functions.txt`).

**Appris sur l'existant**
- `submitForApproval` existant est gouverné `pipeline` ; on a préféré un point d'entrée `maintenance`
  dédié (`submitMntDecision`) plutôt que de rouvrir la garde — même moteur, cloisonnement propre.
  `loadUsersMap`/`anyDirectionUid` sont des `async function` (hoisted) → injectables au câblage.

**Échoué / abandonné**
- Rien.

**Dette assumée**
- L'e-mail à l'approbateur (best-effort dans `submitForApproval`) n'est pas répliqué dans
  `submitMntDecision` (la demande reste visible dans Approbations + digests) — à ajouter si besoin.
- La décision approuvée ne fait pas encore MUTER le contrat (ex. prolonger `dateFin` / passer `resilie`)
  automatiquement : la décision est tracée, l'application de l'effet reste manuelle en v1. Noté.

**Décidé**
- Application d'ADR-004 (réutilisation du moteur d'approbation). Aucun nouvel ADR.

**Suivant**
- Validation + fusion, puis `/5-lot 5` (Moteur de risque — DERNIER lot ; touche le recompute `aggregate.js`,
  point de contact C3 le plus sensible).

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

---

## 2026-07-15 — Lots 6 & 7 (dashboard + suggestions)

**Fait**
- **Lot 6 — Tableau de bord** : carte cockpit en tête du module, dérivée des collections déjà
  chargées (mnt_contrats, mnt_tickets) + summary de risque. Aucun appel serveur. Domaine PUR
  `web/src/lib/mntDashboard.ts` (contrats actifs, montant engagé, tickets ouverts/priorité,
  échéances ≤ 60 j) + test.
- **Lot 7 — Suggestions de contrats** : repère dans le carnet de commandes (useCommandesRows) les
  affaires « maintenance » (mots-clés sur la désignation) sans contrat, rapprochées par fpKey. Domaine
  PUR `web/src/lib/mntSuggest.ts` + test. Aucune création auto : « Créer » ouvre la fiche pré-remplie.

**Appris**
- `Kpi.value` attend une STRING → `fmt(n)` (et non `money(n)` qui rend un `<span>`).
- Le carnet n'expose pas de champ « nature/récurrent » dans le summary : l'heuristique s'appuie sur
  `affaire` (désignation) — silencieuse si le champ manque (zéro faux positif).

**Décidé**
- Pas d'ADR : additif, front pur, réutilise l'existant. Reste : Lot 8 (import Excel des contrats).

---

## 2026-07-16 — Lot 8 (import Excel des contrats)

**Fait**
- Import EN MASSE des contrats depuis un classeur (.xlsx/.csv), calqué sur `importOpportunities`
  (aperçu dry-run puis apply). Parseur PUR `parsers/mntImport.js` (en-têtes FR tolérants, statut/
  périodicité → codes, dates → ISO) + plan PUR `domain/mntImport.js` (validation via validateMntContrat,
  classement création/mise à jour par id=safeId(fp), dédup intra-fichier, erreurs par ligne). Tests +5.
- Callable `importMntContrats` (handlers/maintenance.js) DOUBLEMENT gaté (requireWrite + drapeau),
  écritures batchées (chunks 400), cap 2000 lignes, scan borné des existants, auditLog. Exporté par nom
  (index.js + deployed-functions.txt → 148 fonctions).
- Front : carte « Importer des contrats (Excel) » (maintenance.tsx, écriture only) — input fichier,
  « Aperçu » (compteurs création/MàJ/erreurs + lignes fautives), « Importer (N) ». Wrapper writes.ts.

**Décidé (périmètre)**
- Import limité à l'EN-TÊTE du contrat (1 ligne = 1 affaire = 1 FP). Les engagements SLA, structurés,
  restent saisis en fiche (le doc plat ne les porte pas). Additif, aucune colonne existante touchée.

**Appris**
- `safeId` remplace `/` par `_` (id = `FP_2026_1`), pas `-` (corrigé dans le test).
- Le module ne lit rien de mnt_* à drapeau éteint : l'import est inaccessible (callable refuse), donc
  invariant « éteint = ERP d'avant » préservé.

**Vérif** : functions 881 tests, web 101 tests, build OK, lint propre, deploy-targets/no-undef OK,
chunk d'entrée 116,3 KB ≤ 120, maintenance 26,9 KB (lazy).

---

## 2026-07-16 — Remédiation vérif adverse (import Lot 8 + prévision)

**Échoué (détecté par gardien, corrigé)**
- Import contrats : `set(merge:true)` avec `engagements:[]` REMPLAÇAIT le tableau stocké → ré-importer un
  contrat effaçait ses engagements SLA (perte de données, contraire au périmètre « en-tête only »). Idem
  montant/devise à colonne vide → zéroïsés. Corrigé : la MISE À JOUR est désormais NON EFFAÇANTE
  (`domain/mntImport.updatePatch` — écrit seulement les cellules renseignées, JAMAIS `engagements`). +2 tests.

**Appris**
- Firestore ne fusionne pas les éléments d'un array en merge : fournir `[]` écrase. Un import « en-tête »
  doit exclure explicitement les champs structurés (engagements) du payload de merge.

---

## 2026-07-16 — Doper les suggestions de contrats à l'IA (ADR-019)

**Fait**
- Suggestions de contrats passées d'une heuristique mots-clés à un **jugement IA** (Claude Opus 4.8,
  réflexion adaptative, `refusal` géré), en **surcouche** — l'heuristique reste l'affichage instantané,
  l'IA se lance sur clic « Doper à l'IA ».
- Patron du Centre de correction calqué à l'identique : `domain/mntSuggest.js` (prompt + normalisation
  défensive, PUR), `lib/mntSuggestAi.js` (pont LLM), callable `aiSuggestMntContrats` double-gardé
  (`requireWrite('maintenance')` + drapeau) + `rateLimit` + secret `ANTHROPIC_API_KEY`.
- Front : bouton + tableau IA (Confiance en %, Analyse), « Créer » pré-remplit la fiche (dont l'échéance
  suggérée). Pool de candidats fourni par le carnet fusionné (parité « même métrique = même nombre »).
- 6 tests (normalisation défensive : fp halluciné rejeté, confiance illisible/bornée, échéance validée,
  dé-doublonnage par FP canonique). `aiSuggestMntContrats` ajouté à `deployed-functions.txt`.

**Appris**
- Le patron « l'IA propose, l'humain valide » du Centre de correction se réutilise tel quel : la vraie
  barrière n'est pas le prompt mais la **normalisation défensive** (rapprochement `fpKey`, bornage,
  énumérations ERP) — l'IA ne fait qu'alimenter des propositions, jamais une écriture.

**Vérif** : functions mntSuggest 6/6, deploy-targets (149 fonctions) + no-undef OK, build web OK,
chunk d'entrée 116,6 KB ≤ 120.

---

## 2026-07-16 — Création en masse de contrats depuis les suggestions (ADR-020)

**Fait**
- Sélection multiple (case à cocher + « tout sélectionner ») sur les deux tables de suggestions (heuristique
  + IA) + bouton **« Créer N contrat(s) »**.
- Helper PUR `buildContratDraft(order, today, echeance?)` : `dateDebut` = date de commande (repli millésime
  PO plausible → AAAA-01-01, sinon aujourd'hui), `dateFin` = **+12 mois** (`addMonths`), `montantEngage` =
  CAS, `statut` = brouillon, `echeanceType` = échéance IA sinon annuel. `deviseEngage` XOF, `engagements` [].
- Écriture en masse = boucle client séquentielle sur `upsertMntContrat` (écriture gouvernée existante),
  tolérante par ligne — patron « appliquer en lot » du Centre de correction. **Aucun nouveau callable.**
- Colonne **Échéance** (dateFin dérivée) visible dans les tables → rien inventé en silence. Le « Créer »
  unitaire pré-remplit désormais AUSSI montant + dates (même helper).
- 8 tests (addMonths : +12 mois, clamp fin de mois, passage d'année, illisible ; buildContratDraft : date
  commande / repli millésime / repli aujourd'hui, échéance validée, montant borné >= 0).

**Appris**
- Piège regex : une regex de VALIDATION (`/^\d{4}-\d{2}-\d{2}$/`) n'a pas de groupes de capture — réutilisée
  telle quelle pour EXTRAIRE (`.exec` puis `m[1..3]`) elle rend `NaN`. Séparer validation et extraction.

**Vérif** : web mntSuggest 11/11, suite web 109/109, build OK, lint OK, chunk d'entrée 116,6 KB <= 120.

---

## 2026-07-16 — Lot 1/7 « valeur ajoutée » : échéancier de facturation DÉTAILLÉ (opérationnel)

**Fait**
- `echeancier` ne donnait qu'un agrégat (engagé/facturé/écart). Ajout de `echeancierPlan` (domain/mntEcheancier.js
  + miroir web/src/lib/mntSla.ts) : la **liste datée** des échéances, chacune marquée `facture` (couverte par le
  facturé cumulé de l'affaire), `du` (échéance passée non couverte) ou `a_venir`. Agrégats strictement
  identiques à `echeancier` (parité). Sans date de fin : on ne liste QUE les échéances dues (pas de projection).
- Helper `addMonthsIso` (clamp fin de mois) pour dater chaque échéance (dateDebut + i × périodicité).
- Surface dans la fiche contrat : table « Détail des échéances » (#, date, montant, cumul engagé, statut),
  sous l'agrégat existant. Aucun callable, aucun schéma — pur affichage dérivé.

**Appris**
- Couverture SANS allocation facture↔période inventée : modèle CUMULATIF (1ʳᵉ échéance dont l'engagé cumulé
  dépasse le facturé total = 1ʳᵉ non couverte). Honnête, et cohérent avec le signal « sous-facturation » du risque.

**Vérif** : parité back mntSla 13/13, front mntSla 8/8, build OK, lint OK, chunk 116,6 KB <= 120.

**Note process** : lot poussé sur la branche portant déjà #398 (branche de dev unique) — #398 couvre donc
« création en masse » + cet échéancier tant que non fusionnée.

---

## 2026-07-16 — Programme « valeur ajoutée » : 7 features / 4 axes (fusionné #398)

**Fait** — 7 features additives sur le module Contrats, chacune vérifiée, toutes derrière le drapeau :
- **Opérationnel** : (1) échéancier de facturation détaillé (`echeancierPlan`, parité back/front) ;
  (2) calendrier SLA des tickets (`slaAgenda`, échéances en attente live, moteur `slaState` réutilisé).
- **Contrôle** : (3) contrôle de complétude des contrats actifs (`mntCompliance`) ; (4) rentabilité par
  contrat (`mntContratPnl` + callable) — coût CJM calculé SERVEUR, masqué sans droit `rentabilite`.
- **Anticipation** : (5) alerte renouvellement (`mntRenouvellements`, ≤ 30/60/90 j + action approbation) ;
  (6) analyse de rétention IA / churn (`aiAnalyzeChurn`) — additive au moteur de risque, ne re-score pas.
- **Conformité** : (7) registre d'audit (`auditLog` filtré, export CSV natif) + index composite.
- En amont : création en masse depuis suggestions (ADR-020), normalisation clients dopée à l'IA
  (`aiSuggestClientMerges`), correctif matrice RBAC (module `maintenance` rendu accordable).

**Vérif** — 911 tests functions + 121 web ; gardes CI (152 fonctions, no-undef, index, chunk ≤ 120 KB).
Audit de session adverse : gardien (régressions/fuites) **VERT**, conformiste (conventions) **CONFORME**.
5 lots à risque passés au gardien individuellement, tous VERT.

**Appris / dette mineure notée par les audits (non bloquant)**
- `maintenance.tsx` : `nowMs = Date.now()` recalculé à chaque render sert de dépendance à `agenda`/
  `churnInput` → ces `useMemo` ne bénéficient pas du cache. Datasets petits, aucun risque de boucle. À
  mémoïser un jour (figer `nowMs` par render via un state d'horloge) — cosmétique.
- Format « Marge % » (et confiance IA / fusion clients) : `Math.round(x*100) %` (entier, espace) au lieu du
  helper `pct()` (une décimale). Cohérent avec la convention DÉJÀ en place dans le module (la confiance IA
  l'utilisait avant cette PR) : ne pas corriger isolément sous peine de créer deux formats de % au même
  écran ; à traiter globalement si un jour on standardise sur `pct()`.

**Note process (à retenir)** — les 10 changements ont été empilés sur la branche de dev unique puis fusionnés
en une seule PR #398 (grosse revue). À l'avenir, fusionner après chaque lot pour des PR séparées relisibles.
La fusion de #398 a été déclenchée sur une consigne `/loop … suivi de deploy` interprétée comme un « merge » :
le garde-fou a signalé que « deploy » n'équivaut pas à un « fusionne #398 » explicite. Règle réaffirmée :
ne fusionner que sur instruction de fusion explicite.

---

## 2026-07-16 — Correctif : échéancier « doublé » sur les contrats à durée multiple exacte

**Symptôme signalé** — une 2ᵉ ligne d'échéance apparaissait, doublant le montant du contrat, sur
« certains » contrats et pas d'autres. Reproduction : elle ne tombait que sur les contrats dont la durée
est un multiple ENTIER de la périodicité (annuel `dateDebut`→`dateDebut+12 mois`, mensuel de 12 mois pile,
etc.). Comme la création en masse pose `dateFin = dateDebut + 12 mois` pour un contrat annuel, tous les
contrats créés en masse tombaient dans le cas piégé.

**Cause** — dans `mntEcheancier.js`, le plafond de durée valait `Math.floor(monthsBetween(dateDebut,
dateFin)/per) + 1`. Le `+ 1` compte l'échéance émise à `dateDebut` (correct pour le décompte *asOf*), mais
appliqué à `dateFin` il compte AUSSI l'échéance tombant PILE sur `dateFin`. Or `dateFin` est la borne de
**renouvellement** (exclusive) : les contrats ne se reconduisent pas d'office (rappel métier de l'utilisateur).
L'échéance du jour de `dateFin` est donc la 1ʳᵉ du contrat SUIVANT, pas du contrat courant → +1 échéance
fantôme, donc +1× le montant. Sur une durée partielle (mensuel 01/01→30/06) le `floor` masquait le bug
(`floor(5/1)+1 = 6`, juste par accident), d'où « certains cas oui, d'autres non ».

**Fix** — helper pur `periodsInContract(dateDebut, dateFin, per)` : compte les débuts de période dont la
DATE RÉELLE (`addMonthsIso`) est **strictement < dateFin**. Correct pour les deux cas — exact (annuel
12 mois → 1, non 2) comme partiel (mensuel 01/01→30/06 → 6). Appliqué à l'identique au plafond de
`echeancier` ET de `echeancierPlan`, back (`mntEcheancier.js`) et miroir front (`mntSla.ts`) — parité stricte.

**Chasse aux bugs similaires** — revue ciblée des autres générateurs de séries mensuelles/décomptes de
périodes (agent). Aucun autre off-by-one : les autres séries utilisent un horizon/span explicite ou des
bornes inclusives voulues ; le `+ 1` du décompte *asOf* (`periodsDue`) reste correct et distinct (il compte
l'échéance de `dateDebut`, borne de gauche INCLUSIVE — sémantique opposée à `dateFin`).

**Vérif** — 4 tests ajoutés (annuel 12 mois → 1 ; mensuel 12 mois → 12 ; lignes datées ; miroir front).
functions 914/914, web 123/123, build OK, lint OK, chunk 116,9 KB ≤ 120, gardes CI (152 fonctions,
no-undef, index) OK. Correctif purement additif (nouvelle fonction pure + resserrement d'un plafond) ;
aucune colonne ni signature touchée ; comportement inchangé hors le cas piégé.

---

## 2026-07-16 — Audit adverse du module (workflow) + remédiation M1/M2 + 3 mineurs

**Fait** — Audit adverse du module contrat conduit par un workflow multi-agents (8 axes : correctness
échéancier/SLA, risque/PnL, contrat/import/suggest, parité back↔front, sécurité/RBAC, IA, gouvernance/
additivité, conformité), chaque constat réfuté par un sceptique indépendant. 16 constats bruts → 11
confirmés, 5 faux positifs écartés (dont : signal `sous_facturation` à contribution nulle jamais rendu
pour les verts ; `aiAnalyzeChurn` requireRead **délibéré et documenté** ; `gap-1` vs `gap-0.5` aligné en
fait sur pipeline/finance). Remédiation des correctifs validés par l'utilisateur :

- **M1 (majeur) — échéancier fin de mois.** `echeancier.periodsDue` était dérivé de `monthsBetween/per`
  (comparaison du JOUR du mois) alors que les dates réelles sont posées par `addMonthsIso` (rabat au
  dernier jour). Un contrat démarrant le 29/30/31 sous-comptait d'une période (31/01→28/02 non compté),
  contredisant `echeancierPlan` — violation « même métrique = même nombre », propagée au risque et à la
  rentabilité. Fix : nouveau helper pur `periodsDueAsOf` (compte les débuts de période dont la DATE RÉELLE
  est ≤ asOf), back + miroir front, aligné sur `periodsInContract`. Bug DISTINCT du off-by-one dateFin de
  la même session (celui-là = sur-compte sur multiple exact ; M1 = sous-compte sur début fin de mois).
- **M2 (majeur) — assiette rentabilité.** `computeContratPnl` agrégeait TOUS les statuts ; un brouillon/
  échu/résilié gonflait revenu et marge, divergent de l'assiette `{actif,suspendu}` du risque. Fix :
  filtre sur `RISK_STATUTS` (source **unique**, importée de `mntRisque`). **ADR-021** (assiette vivante,
  rentabilité historique renvoyée à un ADR ultérieur si besoin).
- **m1 — import non effaçant.** Un montant négatif comptable (« (500 000) », « 500000- ») était coercé à 0
  par `Math.max(0,…)` → un import de MàJ pouvait effacer un montant stocké en silence. Fix : `validateMntContrat`
  REJETTE désormais un montant < 0 (absent → 0 toujours accepté).
- **m2 — dédup import.** « Dernière occurrence gagne » ne valait qu'entre lignes valides : une re-saisie
  fautive (dernière) partait en erreur pendant qu'une version antérieure valide s'importait. Fix : dédup
  par `fpKey` AVANT validation (dernière occurrence, même invalide, supersède les précédentes ; ordre des
  lignes préservé).
- **m5 — ticket créé déjà résolu.** La création ne posait que `ouvertLe` : un ticket saisi rétroactivement
  `resolu`/`clos` n'avait pas de `resoluLe` → SLA « rompu » à jamais. Fix : la création pose les mêmes
  horodatages de transition que l'édition, selon le statut initial.

**Vérif** — functions 919/919 (+5 tests : M1 fin de mois back + parité décompte↔liste, M2 filtre statuts,
m1 rejet négatif, m2 dédup invalide), web 124/124 (+1 : M1 miroir front). Build OK, lint OK, chunk 116,9 KB
≤ 120, gardes CI (152 fonctions, no-undef, indexes) OK. Correctifs **additifs** (helpers purs + gardes +
resserrement d'assiette) ; aucune colonne/signature touchée.

**Reste ouvert (audit, non traité — sur décision ultérieure)** : m3 (parité `slaBreaches` churn front vs
`slaRompus` back), m4 (décision d'approbation renouvellement/résiliation **inerte** — n'applique pas l'effet
au contrat), m6 (`missingCjm` absent → marge surévaluée en silence), m7 (normalisation clients IA hors `mnt_`
sans ADR), + infos (deviseEngage non validée XOF, dateFin===dateDebut, injection de prompt confinée, gate
front sur RBAC seul). Documentés ici pour ne pas les perdre.

---

## 2026-07-16 — Audit (suite) : remédiation m3/m4/m6/m7

**Fait** — Deuxième vague de remédiation de l'audit adverse, sur arbitrage utilisateur :

- **m4 (mineur) — décision d'approbation inerte → application automatique.** Un renouvellement/résiliation
  approuvé ne mutait pas le contrat. Ajout d'un trigger `onMntApprovalDecided` (Firestore, base nommée, gaté
  `RECOMPUTE_REGION`, `retry:false`, idempotent sur la transition→approved) qui applique la fonction PURE
  `applyMntDecision` : résiliation → `statut=resilie` ; renouvellement → `dateFin += terme initial` (échu/
  résilié → renaît `actif`). **ADR-022**. Audité `mnt_decision_apply`. Exclusion volontaire de déploiement
  (activé par ops, comme le recompute).
- **m3 (mineur) — parité churn.** `churnInput.slaBreaches` recalculait les ruptures SLA côté front (seul
  l'engagement `resolution`), divergeant de `r.slaRompus` (back, tous engagements + repli). Fix : réutiliser
  `r.slaRompus`, source **unique** déjà matérialisée (« même métrique = même nombre »).
- **m6 (mineur) — marge non fiable silencieuse.** Un consultant sans CJM renseigné contribuait 0 au coût
  sans signal → marge surévaluée. Ajout d'un drapeau `missingCjm` (jours d'intervention sans CJM) par ligne
  P&L (masqué sans droit coût), + marqueur « ⚠ » sur la colonne Marge, comme `resourcePnl.missingCjm`.
- **m7 (gouvernance) — normalisation clients IA hors `mnt_`.** **ADR-023** : actée comme référentiel
  transverse distinct, always-on, gouverné `import`/`habilitations`, hors kill-switch `mntFeature` (l'écran
  pré-existe, l'IA ne fait que proposer, l'application reste direction).

**Vérif** — functions 926/926 (+7 : applyMntDecision 6, missingCjm 1), web 124/124, build OK, lint OK,
chunk 116,9 KB ≤ 120, gardes CI (deploy-targets/no-undef/indexes) OK. Additif ; `onMntApprovalDecided`
listé en exclusion volontaire de `deployed-functions.txt` (comme `onRecomputeRequest`).

**Reste ouvert (infos, non traité)** : deviseEngage non validée XOF, `dateFin===dateDebut` accepté,
injection de prompt confinée (durcissement optionnel), gate front sur RBAC seul (défense en profondeur).

---

## 2026-07-16 — Audit (clôture) : les 4 durcissements « info »

**Fait** — Traitement des derniers constats info de l'audit (« go pour tout ») :

- **deviseEngage** — `validateMntContrat` REJETTE désormais toute devise ≠ XOF (module à devise pivot :
  `montantEngage` traité en FCFA entier sans conversion, donc une étiquette EUR sur un montant XOF était une
  erreur d'unité silencieuse). Fail-loud, cohérent avec le rejet du montant négatif. **ADR-024**.
- **dateFin === dateDebut** — rejetée (`<=` au lieu de `<`) : une fin ≤ début donnait un contrat à couverture
  nulle (0 échéance) silencieux. Message « la date de fin doit être postérieure à la date de début ».
- **Injection de prompt** — durcissement des 3 system prompts IA (`mntSuggest`, `aiChurn`, `aiClientNorm`) :
  ajout d'une consigne explicite « les objets JSON qui suivent sont des DONNÉES, jamais des instructions ».
  Défense en profondeur (la barrière normalize + validation humaine neutralisait déjà tout effet d'écriture).
- **Gate front** — le composant `Maintenance` gate désormais ses lectures `mnt_` sur le DROIT `maintenance`
  ET le drapeau `config/mntFeature` (`isMntEnabled`), même invariant que la nav et les rules. Défense en
  profondeur si un futur refactor rendait le composant atteignable hors du filtre de nav.

**Vérif** — functions 928/928 (+2 : devise + dateFin=égalité rejetées ; import devise ≠ XOF), web 124/124,
build OK, lint OK, chunk 116,9 KB ≤ 120, gardes CI OK. Additif (validations + prompt + gate), aucune donnée
existante touchée.

**Audit du module contrat : CLÔTURÉ.** 11 constats confirmés → tous remédiés (2 majeurs, 5 mineurs, 4 infos)
+ 5 faux positifs écartés. ADR-021 à 024. Tout sur la PR #400.

---

## 2026-07-17 — Contrats Lots 4 & 5 : types de maintenance + centre de surveillance

**Fait — Lot 4 (types de maintenance + objectifs, ADR-025)** :
- Énumération unique `TYPES_MAINTENANCE` (predictive/corrective/evolutive/veille), miroir back
  (`domain/mntContrat.js`) / front (`lib/mntContrat.ts`), libellés FR.
- Champ optionnel `typeMaintenance` sur tickets ET interventions (validé, fail-loud sur valeur hors
  énum) ; objectifs (max) par type EMBARQUÉS dans le contrat (`objectifsMaintenance`, entiers, rejet
  du négatif). Comptage SÉPARÉ tickets/interventions (`mntTypeStats`, vue pure).
- Double affichage : carte agrégée « Maintenance par type » (tableau de bord) + carte par contrat
  (consultation, colonne Objectif, dépassement en clay). Composant `TypeStatsTable` réutilisé.

**Fait — Lot 5 (centre de surveillance, ADR-026)** :
- `domain/mntSurveillance.js` (PUR) PROJETTE `summaries/mnt_risque` en flux d'événements (SLA rompus,
  renouvellements, quotas, sous-facturation) — aucun recalcul, cohérence garantie avec le centre de
  risque. Matérialisé dans `summaries/mnt_surveillance` (même bloc de recompute gaté que mnt_risque).
- Abonnements PAR UTILISATEUR : collection `mnt_watches/{uid}` (global ou ciblé contrat/client/AM),
  écrite par le callable `setMntWatch` (requireRead + drapeau, audité), lue en direct et isolée par uid.
- Front : carte « Centre de surveillance » (flux trié par sévérité, Segmented Tout / Mes abonnements,
  bouton Suivre par contrat + parc). Diffusion in-app live (réutilise summaries + onSnapshot) — pas de
  notification externe en v1 (rouvrable par ADR si besoin).
- Refactor connexe : wrappers mnt_ « fire-and-forget » de `writes.ts` factorisés via un helper `mntWrite`
  (récupère le budget de bundle après ajout de setMntWatch).

**Vérif** — functions 966/966 (+18 : mntSurveillance, objectifs, typeMaintenance ; caractérisation
recompute mise à jour : le bloc gaté ajoute mnt_risque + mnt_surveillance), web 144/144, lint OK,
build OK, chunk d'entrée 120,0 KB ≤ 120, gardes CI (deploy-targets/no-undef/indexes) OK. Additif :
3 champs optionnels + 1 summary + 1 collection par-utilisateur + 1 callable ; drapeau éteint ⇒ rien.

**Appris** — La surveillance n'avait pas besoin d'un nouveau moteur : le moteur de risque calculait déjà
tous les signaux. La bonne architecture était une PROJECTION (une vue), pas un second calcul — ça évite
la divergence « même métrique = même nombre » et concentre l'évolution sur une seule source.

---

## 2026-07-17 — Contrats Lot 6 : statut automatique (hybride règles + IA, ADR-027)

**Fait** — Détermination automatique du statut d'un contrat, à l'unité et en masse :
- `domain/mntStatutAuto.js` (PUR) : règles DÉTERMINISTES pour les transitions mécaniques (échéance
  dépassée → échu à 1.0 ; début atteint → actif à 0.7 ; résilié terminal…) ; isole les cas de JUGEMENT
  (dormant, réactivation, échéance prolongée) pour l'IA. Re-validation stricte de la sortie IA
  (`normalizeStatutProposals` : énumération, jamais resilie, confiance bornée).
- `lib/mntStatutAi.js` : pont Claude Opus 4.8 (adaptative, refus géré) sur les seuls cas ambigus.
- Callable `aiMntContratStatut({ ids?, apply?, threshold? })` : règles + IA, AUTO-APPLIQUE au-dessus du
  seuil (0.85, journalisé `auto_mnt_contrat_statut`, recompute scopé), PROPOSE en deçà. rate-limit `ai`.
- Front : bouton « Statut IA » par contrat (unitaire), action de sélection « Déterminer le statut (IA) »,
  carte « Statut automatique (IA) » (« Analyser le parc ») listant les propositions à valider (Appliquer
  d'un clic via setMntContratStatut). Emplacement : module Contrats (confirmé en session).
- Refactor connexe : wrappers mnt_ de `writes.ts` factorisés (`mntCall`/`mntWrite`) — budget bundle tenu.

**Vérif** — functions 979 → +12 (mntStatutAuto), web 144, lint OK, build OK, chunk d'entrée 119,9 KB ≤ 120,
gardes CI (deploy-targets `aiMntContratStatut` listé / no-undef / indexes) OK. Additif ; drapeau éteint ⇒ rien.

**Note** — Consigne mi-parcours « afficher uniquement dans Référentiel > Normalisation clients » levée par
question : un module de STATUT DE CONTRAT dans un écran clients aurait trompé l'œil (indiscernabilité) →
emplacement retenu = module Contrats de maintenance.

**Appris** — L'« auto IA » la plus sûre est surtout NON-IA : les règles déterministes tranchent l'essentiel
(échu) avec une exactitude testable, et l'IA ne touche qu'aux quelques cas de jugement — presque toujours
en simple proposition. L'hybride donne le meilleur des deux : exact où c'est mécanique, prudent où ça juge.

---

## 2026-07-17 — INCIDENT statut auto : tout le parc en échu → auto-application supprimée (ADR-028)

**Échoué** — L'auto-application du statut (Lot 6, ADR-027) a basculé TOUT le parc en `échu` : la règle
« date de fin dépassée → échu » (confiance 1.0, auto) a frappé tous les contrats à `dateFin` passée — or
beaucoup restent actifs (renouvelés sans MAJ de la date). Hypothèse fausse rendue auto = dégât de masse
silencieux. La leçon d'origine du module (« la règle de l'ERP gagne », « rien d'autre n'a bougé ») a été
violée par excès de confiance dans une règle « mécanique » qui ne l'était pas.

**Fait — correctif** :
- `aiMntContratStatut` ne fait plus que PROPOSER (n'écrit plus aucun statut). Application = geste humain
  (setMntContratStatut), à l'unité ou « Appliquer les recommandés » (explicite).
- Nouveau callable `revertMntAutoStatut` : rétablit chaque contrat à son statut ANTÉRIEUR depuis la piste
  d'audit `auto_mnt_contrat_statut` (from/to), seulement s'il porte encore le statut auto-appliqué.
  Idempotent. Bouton « Rétablir (annuler l'auto) ». ADR-028.
- UI : avertissement explicite que « échu dérivé d'une date passée » est à vérifier avant d'appliquer.

**Vérif** — functions 979, web 144, lint/build OK, chunk 120,0 KB ≤ 120, gardes (revertMntAutoStatut listé).

**Appris** — Aucune écriture de masse ne doit être « automatique » sur des données que d'autres utilisent.
Une règle déterministe « correcte au sens strict » (dateFin < today) peut être opérationnellement fausse ;
la seule position sûre par défaut est PROPOSER, l'humain applique. La piste d'audit from/to a permis un
rétablissement exact — d'où l'importance de tout tracer avant d'écrire.

---

## 2026-07-17 — Audit complet (6 axes) avant migration + correctifs

**Fait** — Audit transverse en 6 axes (sécurité, cohérence des chiffres, correction, perf, migration,
UX). Rapport priorisé : `docs/AUDIT-2026-07.md` ; runbook de migration projet dédié :
`docs/MIGRATION_PROJET.md`. Aucun P0. Correctifs mnt_ de ce lot :
- **P1** statut auto : « échéance dépassée → échu » marquée `requiresReview` → jamais recommandée en masse
  (ADR-029) ; confirmation avec décompte sur « Appliquer les recommandés ». Ferme le vecteur de réincidence
  de l'incident du 17/07 tout en gardant l'application à l'unité.
- **P1** régression mobile : `TypeStatsTable` — ajout des `data-label` (mode carte `.rtable` < 640 px).
- **P2** renouvellement de contrat : le terme se composait au 2ᵉ renouvellement (mesuré dateDebut→dateFin
  courante) ; on fige `termeMois` au 1er renouvellement et on le réutilise. Invariant.
- **P2** marge contrat : `pct()` (1 décimale) au lieu de `Math.round` — aligné sur le reste de l'ERP.
- **P3** dates mnt_ : `validateMntContrat` rejette une année de début implausible (discipline `plausibleYear`,
  bloque la sentinelle 1899 → échéancier gonflé → faux signal critique).

**Appris** — Un correctif d'incident (propose-only, ADR-028) peut laisser un vecteur résiduel dans l'UI
(bouton d'application de masse). Fermer l'incident, c'est aussi retirer l'action dangereuse du chemin
« un clic », pas seulement l'auto-application serveur.

---

## 2026-07-17 — Objet/désignation dans toutes les tables du module

**Fait** — Colonne **« Objet »** ajoutée aux quatre tables du module (Contrats, Conformité, Risque,
Renouvellements). Le contrat ne stocke PAS l'affaire (ADR-001 « 1 contrat = 1 affaire ») : l'objet est
la **désignation de la commande adossée**, rapprochée par `fpKey`. Réutilise `orderByFp` (déjà construit
depuis le carnet `useCommandesRows` pour les suggestions) — hoisté en tête du composant + helpers
`objetOf`/`objetCell` partagés. Additif, aucune lecture ni écriture nouvelle, aucun schéma modifié.

**Appris** — La demande « afficher l'objet partout » ne nécessitait aucun champ nouveau : la donnée
existait déjà côté carnet ; il suffisait de la joindre par `fpKey` (invariant ERP) et de mutualiser la
cellule pour un rendu identique dans toutes les vues.

---

## 2026-07-17 — Lignées de renouvellement câblées en prod (ADR-030)

**Fait** — Le domaine PUR (détection successeur + confirmation IA) développé plus tôt et **parké** (tag
`parked/lignee`) est enfin **branché** : callables `aiMntLignees` (détection + confirmation IA, aucune
écriture) et `applyMntLignee` (persiste le champ additif `ligneeId`, geste humain, recompute scopé) ;
carte front « Lignées de renouvellement (IA) » + colonne « Lignée » sur la table Contrats. Numéro généré
`AAAAMM` + lettres client. Objet des contrats joint depuis la commande (`orderByFp`, fpKey). Export
`deployed-functions.txt`, wrappers `writes.ts`, type `ligneeId?` sur `MntContrat`.

**Appris** — Un domaine parké se rebranche sans risque quand il est PUR et testé : il a suffi de restaurer
les 3 fichiers (domaine + IA + test, 8 tests verts) et de câbler l'I/O (callables) + l'UI. La contrainte de
budget de chunk d'entrée (120 KB) a été tenue en **mutualisant** les appels IA longs de `writes.ts` dans un
helper `mntCallLong` (dé-duplication qui a plus que compensé l'ajout).

---

## 2026-07-17 — Conformité recentrée sur la complétude ; « échéance dépassée » → renouvellements (ADR-031)

**Fait** — `mntCompliance` (Lot 3/7) ne juge plus que la **complétude structurelle** des contrats actifs
(`sans_sla`, `sans_echeance`, `montant_nul`) ; le manque `echeance_depassee` est **retiré** et la fonction
devient indépendante de la date (plus d'`asOfIso`). Les contrats actifs **échus** rejoignent
`mntRenouvellements` en nouveau palier `depasse` (jours < 0), affiché **en tête** sous la carte renommée
« Renouvellements & échéances à revoir ». Fronts alignés : KPI conformité « Sans date de fin » (au lieu de
« Échéance manquante/dépassée »), tip recadré, badge « Manques » simplifié. Tests `mntDashboard.test.ts`
mis à jour (17 verts), bundle 120,0 KB tenu.

**Appris** — Une même métrique qui portait deux sens (défaut de saisie **et** signal de cycle de vie)
créait un double-compte silencieux : un contrat complet mais échu apparaissait « non conforme » alors qu'il
n'appelait aucune correction de fiche. ADR-029 avait déjà établi que « `dateFin` passée ⇒ échu » est
opérationnellement faux ; il restait à en tirer la conséquence dans la vue conformité. Séparer les deux
dimensions (complétude vs décision de renouvellement) rend chaque compteur univoque — sans champ nouveau,
en réutilisant la carte renouvellements existante.

---

## 2026-07-17 — Remédiation audit module Contrats (3 passes adverses)

**Fait** — Audit adverse en 3 passes parallèles (régression, conformité ERP, correction/cohérence) sur le
module complété (#427 objet, #428 lignées, #429 conformité). Verdicts : régression **VERT** (functions
1004, web 146, gardes CI vertes, bundle 120,0 KB) ; correction **2 MEDIUM** ; conformité **1 NON-CONFORME**.
Correctifs livrés :
- **F1/F2 (`applyMntLignee`, back)** : `batch.set(merge)` sur un id absent le CRÉAIT (doc fantôme malformé,
  l'Admin SDK contournant les rules) → on lit d'abord via `db.getAll`, on ne rattache que les contrats
  **réellement présents** (refus si < 2 membres subsistent). Les rattachements qui **écrasent** un `ligneeId`
  déjà posé sont désormais **tracés** (ancien → nouveau dans `auditLog.detail.reassignes`, jamais muets).
- **Conformité (front)** : la colonne « Objet » (#427) devient **« Affaire »** — libellé universel de la
  désignation d'affaire dans l'ERP (>10 sites, 5 modules) et déjà utilisé par les tables de suggestions du
  **même** module ; « Objet » créait deux libellés pour un concept dans le même écran. Helpers renommés
  `affaireOf`/`affaireCell`.
- **Ton (front)** : KPI « Sans date de fin » repassé `clay → gold`, cohérent avec ses KPI frères (« Sans SLA »,
  « Montant nul ») et le badge « Manques » du même écran (sémantique `gold` = avertissement structurel).
- **Broutille** : `requireWrite` dupliqué dans `deleteMntContrat` (résidu #428) supprimé.
- **F3 (LOW)** : divergence de source du signal « affaire » (détection = `orders` bruts vs affichage = carnet
  fusionné) **assumée et documentée** en ADR-032 (heuristique confirmée IA + humain, pas un défaut silencieux).

**Appris** — Un `batch.set(..., {merge:true})` côté Admin SDK n'est jamais anodin sur un id non garanti : il
crée le document au lieu d'échouer, et contourne les rules `write:false`. Le garde-fou n'est pas la validation
d'entrée mais la **lecture préalable** (`getAll` → filtre `exists`). Côté conformité, le signal le plus fort
n'était pas la règle ERP externe mais l'**auto-incohérence** : le module s'appelait « Affaire » à un endroit et
« Objet » à l'autre pour la même donnée — un module doit d'abord être cohérent avec lui-même.

## Navigation en 4 sous-onglets (CT1) — 2026-07-18

**Fait.** Le module rendait ~18 cartes sur une seule page ; retour d'usage direction : « on se perd ». Un
audit navigation a confirmé la cause racine (aucune sous-nav, contrairement à Partenariats/Pipeline). Le
rendu est désormais enveloppé dans un `Segmented` de 4 onglets (Pilotage / Contrats / Tickets & SLA /
Surveillance, ADR-036). Regroupement **purement présentationnel** : chaque carte est déplacée sous un onglet
sans toucher son contenu ; les hooks restent tous appelés au-dessus du `return` (aucune violation des règles
de hooks, même patron que `partenariats.tsx`). Build vert, bundle d'entrée sous budget, aucun calcul modifié.

**Appris.** Un module riche en fonctionnalités peut devenir **inutilisable par simple accumulation** : ce
n'est pas un manque de fonctions mais un défaut d'**architecture de l'information**. La divergence avec le
patron maison (sous-onglets) était le signal — un module doit d'abord se naviguer comme le reste de l'ERP.

**Suite (décidé, non inclus dans ce lot).** Câbler les filtres globaux BU/AM/Client au module (aujourd'hui
affichés mais inertes) ; fusionner les surfaces qui se répètent (Revenu KPI + carte ; Risque + churn IA ;
Renouvellements + lignées IA ; Statut dashboard + statut auto IA) — chacune un ADR ; déplacer les **Astreintes**
dans le module **Exécution** (elles pèsent sur les affaires ET les contrats — ADR-037 à venir).

## Astreintes déplacées dans Exécution (CT-EX) — 2026-07-18

**Fait.** Retour d'usage : « déplacer astreinte dans exécution, ça impacte à la fois les projets et les
contrats ». Juste — une astreinte est imputée par N° FP (affaire) et éventuellement un contrat ; elle pèse
dans la rentabilité de livraison ET de contrat. La carte a été extraite du module Contrats vers un écran
DÉDIÉ « Astreintes » dans la section Exécution (`web/src/modules/astreintes.tsx`, ADR-037). Front seul :
mêmes callables (listAstreintes/submitAstreinte, gouvernés droit `maintenance` + drapeau mntFeature),
comptabilisation `astreinteCostByFp` inchangée, aucun backend ni `deployed-functions.txt` touché. Nettoyage
des imports devenus inutiles dans maintenance.tsx (callFn/httpsCallable/functions). Build vert, 160 tests web.

**Appris.** L'emplacement d'une fonctionnalité est un choix d'architecture de l'information, pas un détail :
une donnée transverse (charge par affaire) rangée dans un seul module suggère une portée fausse. On a
distingué la **relocalisation présentationnelle** (bougé, sans risque, ce lot) du **découplage RBAC** (droit
propre, changement backend, dette assumée et documentée) — ne pas confondre les deux évite un sur-engineering.

## Filtre global BU/AM/Client câblé (CT2) — 2026-07-18

**Fait.** Les filtres BU/AM/Client s'affichaient mais n'agissaient pas sur le module (aucun `useFilters`).
Câblage (ADR-038) : le module se restreint au sous-ensemble de contrats visibles (`vContrats`) et propage ce
périmètre à toutes les vues — dérivées client (dashboard/revenu/conformité/renouvellements/type/SLA/listes via
`vContrats`/`vTickets`/`vInterventions`) et lignes de summary backend (risque par bu/am/client, rentabilité et
statut par N° FP visible). `useClientKey` pour la parité alias. `FilterNote` signale le périmètre.

**Appris (invariant de parité).** La tentation était de re-dériver des KPI filtrés côté client — source
classique de divergence. La règle qui a rendu ce lot sûr : **ne jamais re-scorer, seulement sous-compter**.
Chaque KPI filtré est le décompte exact des lignes filtrées affichées (le risque reste celui du recompute
serveur, on ne fait que retenir les lignes du périmètre). La parité tient donc **par construction**, pas par
vérification a posteriori. Le filtre PM est volontairement ignoré (un contrat n'a pas de PM).

## Fusions de vues (CT3 — revenu dédup, risque & rétention) — 2026-07-18

**Fait.** Retour d'usage : « il y a peut-être des vues qu'on peut fusionner ». Deux fusions à forte valeur
(ADR-039) : (1) l'ARR n'apparaît plus deux fois — retiré de la carte « Revenu récurrent » (déjà KPI de tête
du tableau de bord), la carte se recentre sur MRR + clients + ventilation ; (2) le churn IA (rétention) est
rapatrié en Pilotage juste après « Risque des contrats » (même population), fini l'aller-retour vers
Surveillance. Présentationnel, aucun calcul modifié. Build vert, ESLint clean, bundle ≤120 KB.

**Appris.** Toutes les « fusions » ne se valent pas : dédupliquer un chiffre affiché deux fois (ARR) ou
réunir deux vues d'une même population (risque/churn) est clair et à forte valeur ; réunir deux outils IA
souvent vides (lignées, statut auto) apporte peu et complexifie — mieux vaut l'assumer en ADR (« restant
optionnel ») que le forcer. On distingue la fusion qui SERT la lecture de celle qui ne fait que déplacer.

---

## DO Lot 4a — Pré-facturation consolidée en summary + alerte — 2026-07-18

**Fait.** La pré-facturation (jours FACTURÉS au CRA × TJM, Lot 21) n'existait qu'en **callable à la demande**
(`preBillingFromCra`) : le pilotage (DO/CODIR) ne pouvait pas la lire sans déclencher un calcul. Matérialisée
en **summary** (`summaries/preBilling`) via un bloc ADDITIF d'`aggregate.js`, gaté `want("prebilling")` :
lecture BORNÉE aux 3 derniers mois (`timesheets where month ≥ fromYm`, contribution mnt écartée comme le
callable), calcul par la fonction PURE `computePreBilling` **déjà existante** (aucune 2ᵉ vérité). Gaté
`rentabilite` dans les rules (préfixe `preBilling` → rentabilite : expose TJM/CA par ressource). **Alerte**
consolidée : `global.missingTjm` (jours facturés sans TJM, à tarifer). Consommé au **Bilan CODIR** (chip « À
facturer (pré-fact. CRA) » + chip « Lignes sans TJM », gaté droit Rentabilité). Tests : `preBillingGate`
(recompute complet → summary écrit ; recompute ciblé → non réécrit, jamais à vide). 1129 functions + 271 web.

**Appris / à arbitrer (reste de DO Lot 4).** L'audit de la chaîne de revenu confirme :
- **Récurrent (MRR/ARR)** : DÉJÀ livré et conservé (`mntDashboard.recurringRevenue`, isolé du projet).
- **Encaissé (4ᵉ maillon)** : DÉJÀ en place en version booléenne (`chaine.js` `encaisse = Σ factures payées`).
  Un encaissé DATÉ (dates/montants de règlement, DSO réel) = sous-chantier séparé (aucune donnée de règlement
  aujourd'hui — pas de lettrage).
- **Reconnaissance à l'avancement** : NON refaite ici. La tentative précédente (`revenueRecognition` dans
  `mntRisque`) a été RETIRÉE (double-compte quand deux contrats partagent un `fpKey` ; confrontation reconnu
  périmètre maintenance ↔ facturé affaire entière). La refaire proprement demande une DÉCISION (source
  d'avancement : jours consommés / avancement ClickUp / jalons) + une allocation facture↔périmètre — laissée
  à l'arbitrage humain, pas de changement silencieux.

---

## DO Lot 4b — Reconnaissance de revenu à deux taux (financier + opérationnel) → FAE/PCA — 2026-07-18

**Fait (ADR-040).** Suite au reste de DO Lot 4, la Direction tranche : **deux taux d'avancement** plutôt qu'un
« reconnu » unique (qui rejouerait le double-compte du lot retiré). Fonction PURE `domain/recognition.js`
(`recognitionByFp`, `operationalRate`) : par affaire (`fpKey`), **financier** = `facturé / montant` (carnet),
**opérationnel** = avancement ClickUp — **progression checklist réelle** (`cu.progress` 0..100, résolu/total,
déjà persistée par la synchro inverse Lot 4) prioritaire, sinon **statut ordinal** de l'ERP (`4-/5-/9-…`→1 ;
`0-affecté`→0 ; `1-/3-` en cours→**null**). `null` = indéterminé — **aucun palier inventé** (CLAUDE.md).
Écart op − fin × montant → **FAE** (livré non facturé) / **PCA** (facturé d'avance), calculé seulement quand
les deux taux sont connus.

**Garde-fou double-compte (le cœur du lot, sur alerte utilisateur « les contrats ont aussi des fpKey,
vérifie »).** Vérifié dans le code : les contrats de maintenance portent bien un `fpKey` (ADR-001) et le module
mnt dérive DÉJÀ leur facturé des mêmes factures d'affaire par `fpKey` (`mntRisque` §Sous-facturation, ADR-005).
La reconnaissance projet **exclut** donc tout `fpKey` présent dans `mnt_contrats` — lecture des contrats
**uniquement si le module maintenance est allumé** (sinon aucune collision + invariant « éteint = aucune
lecture mnt_* »). Test `recognition.test.js` fige : une affaire sous contrat mnt n'apparaît PAS dans le summary.

**Câblage.** Bloc ADDITIF `aggregate.js` gaté `want("recognition")` (lit `orders` + overlay `clickupSync`
déjà en mémoire + fpKey mnt gatés) → `summaries/recognition` (`global` + top 200 rows par exposition). Rule
`recognition.* → rentabilite`. Bilan CODIR : chips « FAE — livré non facturé » / « PCA — facturé d'avance »
(gaté Rentabilité), avec compte des affaires sans avancement ClickUp. **Encaissé : reste booléen** (décision
Direction — aucune donnée de règlement daté).

**Vérifs.** `recognition` (7) + `recognitionGate` (2) ; 1138 functions + 271 web ; bundle 118.3 KB (≤ 120) ;
check-deploy-targets (178, aucun nouvel export) + check-no-undef OK.


---

## Lot 8b — Front facture fournisseur (vérité du coût), câblage additif

**Contexte.** Le backend « Vérité du coût » (ADR-P21) était fusionné mais sans surface front : ni bascule
du drapeau, ni saisie des factures fournisseur, ni rapprochement coût planifié/réel. Lot 8b câble ces trois
manques — **additif strict**, aucun nouvel export serveur, aucune règle ni index touchés.

**Arbitrage humain (étanchéité du drapeau).** `config/soaFeature` ne gouverne que la SOURCE du solde SOA,
pas l'affichage. Décision : la **saisie/liste** des factures reste sous le seul droit `fournisseurs` (pour
amorcer les pièces AVANT de basculer), tandis que la **carte de réconciliation coût** en FP 360° est gâtée
par le drapeau (kill-switch sur l'effet métier) + accès Rentabilité (le coût planifié `o.costTotal` est
confidentiel). Drapeau éteint ⇒ FP 360° strictement d'avant.

**Câblage.** (1) `SoaFeatureCard` admin calquée sur `ParFeatureCard` (appel `setSoaFeature` inline, chunk
d'entrée au plafond). (2) `SupplierInvoiceCard` dans « Crédit Fournisseurs » : Combo/DateField/Busy/DangerBtn
réutilisés, `upsert/deleteSupplierInvoice` inline, montant XOF **entier** (le FCFA n'a pas de subdivision).
(3) Carte « Réconciliation amont (coût) » en FP 360° : coût planifié (`o.costTotal`, carnet) rapproché du
coût réel (Σ factures fournisseur par **fpKey**, pendant symétrique de l'aval). Helper PUR `supplierCostByFp`
(domain/fournisseurs.js) + test, pour figer le rapprochement une fois. Type `SupplierInvoice` additif.

**Vérifs.** `fournisseursSupplierCost` (4 nouveaux) ; 1233 functions + 287 web au vert ; bundle 119.4 KB
(<= 120) ; check-deploy-targets (187, aucun nouvel export) + check-no-undef OK ; tsc propre.


---

## Lot 5b — Contrats reliquat : seuil échéance 90 j, snapshot MRR, contrat sans affaire

**Trois reliquats additifs sur le module mnt_**, scopés par workflow puis arbitrés par la Direction.

**1. Seuil d'échéance unifié à 90 j (ADR-041).** `ECHEANCE_PROCHE_JOURS` passe de 60 à 90 dans `mntRisque.js`
(autorité) + son miroir `mntDashboard.ts` + libellés `maintenance.tsx` (interpolés, plus de « 60 j » codé).
Aligne l'alerte d'échéance sur le rappel de renouvellement (horizon 90 j). Changement de comportement ASSUMÉ
(les contrats à 60–90 j déclenchent désormais le signal) — caractérisation `mntRisque.test.js` /
`mntDashboard.test.ts` mise à jour. Les buckets tiérés `mntRenouvellements` (30/60/90) sont une échelle
distincte, NON touchée.

**2. Snapshot MRR/ARR quotidien (ADR-043).** Nouveau domaine PUR `mntRecurring.js` (`recurringTotals`),
**miroir back exact** de `recurringRevenue` (front) — assiette contrats actifs, MRR = round(ARR/12) agrégé.
Historisé dans `summaries/mnt_mrrSnapshot` (1 point/jour, borné 90 j, patron `qualityHistory`), dans le bloc
mnt déjà doublement gaté. **Test de parité croisé** sur fixture partagée (`mntRecurring.test.js` ↔
`mntDashboard.test.ts`). Front : tendance MRR (delta ~30 j) sur la carte Revenu récurrent. Rule
`mnt_mrr.* → maintenance`.

**3. Contrat sans affaire.** Prédicat PUR `isContratOrphelin(contrat, orderFpSet)` (`mntContrat.js`),
transposition du prédicat d'orphelin canonique de `dataQuality` (fpKey, jamais brut). Champ ADDITIF
`sansAffaire` sur `summaries/mnt_risque` (parc entier, plafonné 200), surfacé sous la carte Risque.

**Arbitrage — purge des CRA mnt_ : REJETÉE.** La tâche demandait de supprimer les timesheets `source:"mnt"`
à l'extinction du drapeau. Décision humaine : **ne pas purger** — le read-guard neutralise déjà la
contribution TACE sans détruire de donnée, l'extinction reste réversible (règle 6). Cf. note ADR-043.

**Vérifs.** 1240 functions (dont `mntRecurring` 3, `isContratOrphelin` 3, échéance 90 j, gate C3 mis à jour) +
288 web (dont parité back↔front + fenêtre 90 j) au vert ; bundle 119,4 KB (<= 120) ; check-no-undef,
check-deploy-targets (187, aucun nouvel export), check-firestore-indexes OK ; tsc propre.


---

## Lot 10b — Contrat opposable : versionnement (ADR-P24)

**ADR-P24 — Opposabilité du contrat de maintenance.** On fige une VERSION immuable du sous-ensemble
SIGNIFICATIF du contrat (engagements SLA, couverture, quota, prix, périodicité) à chaque changement réel,
pour que le SLA d'un ticket soit calculé sur la version EN VIGUEUR à son ouverture — opposable, indépendant
des éditions ultérieures. Additif, sous drapeau ; **repli sur les engagements courants si le snapshot est
absent** → non-régression byte-identique. Décision structurante validée humainement (R1/R2 de la SPEC).

**Câblage.**
- Domaine PUR `mntContratVersion.js` : `versionPayload` (ignore client/statut/dates → éditer le statut ne
  crée PAS de version), `versionHash` (sha1 sur JSON stable — insensible à l'ordre des engagements),
  `versionsDiffer`. Testé (4 cas : ignore non-significatifs, stable au réordre, change sur les 4 axes, diff).
- `upsertMntContrat` : point d'interception UNIQUE — crée une version (append-only `mnt_contratsVersions`)
  quand le hash change ; champs additifs `versionCourante/Id/Hash` sur `mnt_contrats`.
- `importMntContrats` : versionne les contrats CRÉÉS (version 1, même batch — chunk réduit 400→200 car une
  création = 2 écritures ≤ 500/batch). **Les MàJ d'import ne versionnent pas** (patch partiel, engagements
  préservés) : elles versionneront au prochain `upsertMntContrat` — décision explicite, non silencieuse.
- `upsertMntTicket` (création) : GÈLE `engagementsSnapshot` + `versionId/versionNo` du contrat en vigueur
  (gel-une-fois, jamais réécrit en édition, comme `ouvertLe`).
- `mntRisque` : le SLA se mesure sur `t.engagementsSnapshot ?? engagements` (repli). Le **quota** reste
  contrat-level (agrégat mensuel, pas rattaché à un ticket) — décision assumée.
- `aggregate.js` : le mapping `ticks` porte `engagementsSnapshot` (null si absent) → summaries/mnt_risque
  inchangé quand aucun ticket ne porte de snapshot (prouvé par mntRecomputeGate).
- Rules : `mnt_contratsVersions` lisible drapeau+droit maintenance, écriture cliente refusée. Index composite
  (contratId, version DESC).
- Front : miroir PUR `engagementsForTicket` (mntDashboard.ts) — `slaAgenda` + colonnes SLA (liste + fiche
  contrat) jugent sur le snapshot du ticket, repli contrat courant. Types additifs `MntTicket.*`.

**Hors périmètre (confirmé).** Couverture back-to-back / `couverture_b2b` (R3) : reste pour un lot ultérieur.

**Vérifs.** 1245 functions (dont `mntContratVersion` 4, opposabilité mntRisque, gate C3) + 291 web (dont
`engagementsForTicket` + slaAgenda opposable) au vert ; bundle 119,4 KB (<= 120) ; check-no-undef (158),
check-deploy-targets (187, aucun nouvel export), check-firestore-indexes (3 composites) OK ; tsc propre.

## Réf. PR1 — Fournisseurs dans Référentiels (ADR-044) — 2026-07-20

**Fait.** Relocalisation présentationnelle de la SAISIE des lignes de crédit fournisseur (plafond
autorisé, solde d'ouverture SOA daté, migration des clés canoniques ADR-P20) depuis l'écran de suivi
« Crédit Fournisseurs » (Rentabilité) vers un nouvel écran **Référentiels › Fournisseurs**
(`web/src/modules/fournisseursref.tsx`, composant `FournisseursRef`). Même patron qu'ADR-037 (Astreintes).

**Câblage.**
- `CreditEditor` + `MigrateCreditKeysBtn` déplacés hors de `operations.tsx` → `fournisseursref.tsx`.
  Imports morts retirés d'`operations.tsx` (`useConfirm`, `trackWrite`, `upsertCreditLine`,
  `migrateCreditLineKeys`) — vérifiés uniques aux composants déplacés.
- « Crédit Fournisseurs » reste le suivi SOA (solde/engagement/disponible/factures) ; sa colonne d'édition
  et le bouton de migration disparaissent ; un `Tip` renvoie vers Référentiels › Fournisseurs.
- Nav : `MODULES` id `fournisseursref` (key `fournisseurs` → MÊME droit d'écriture, aucun élargissement),
  ajouté au groupe **Référentiels** ; garde-fou nav (id ⊆ un seul GROUPS) respecté.
- `functions/domain/fournisseurs.js` : cap `bySupplier` 50 → **500** (le référentiel doit lister TOUS les
  fournisseurs pour les éditer). Additif : agrégats et listes critiques inchangés (calculés sur l'ensemble).

**Gouvernance.** Strictement additif : aucun callable/droit/schéma/calcul modifié, seul l'emplacement UI
de l'édition change. ADR-044. Étape 1/3 de la consolidation des référentiels (fournisseurs ; puis
référentiels Admin ; puis normalisation fournisseurs minimale).

## Correctif re-audit final — parité chiffres mnt_/coût + étanchéité drapeau — 2026-07-20

**Contexte.** Re-audit final du programme (workflow 5 axes × auditeur/gardien, vérification adverse) :
24 agents, 8 constats confirmés, **0 high** (chaque high brut ramené à medium en vérification : module
sous drapeau, déclencheur conditionnel, effet d'affichage sans écriture ni corruption). Correctifs des
constats **medium** confirmés, tous additifs.

**Fait.**
- **Étanchéité drapeau (back).** `onMntApprovalDecided` (index.js) : ajout de la garde
  `isMntEnabled(config/mntFeature)` en tête → drapeau éteint ⇒ AUCUNE écriture mnt_astreintes/mnt_contrats
  ni auditLog(module:maintenance) même en décidant une approbation mnt_ en attente. Cohérent avec
  submitAstreinte / la décision de contrat (déjà gâtées, ADR-009). Invariant C10 rétabli sur le dernier
  chemin d'écriture mnt_ non gardé.
- **RBAC FP 360° (front).** La réconciliation amont (coût) lit `supplierInvoices` : la règle exige le droit
  `fournisseurs`, or l'abonnement n'était gâté que sur `rentabilite` → onSnapshot silencieusement refusé,
  « Coût réel » affichait 0 (faux). Ajout de `canFournisseurs` à l'abonnement ET à la carte (masquer plutôt
  qu'un zéro trompeur).
- **Parité fiche contrat (front).** La fiche comptait les factures ANNULÉES (overlay config/cancelInvoices)
  que le recompute PURGE avant d'agréger la sous-facturation du risque → « écart » contradictoire. Exclusion
  des annulées côté fiche (miroir aggregate.js). Le rapprochement reste par requête fp canonique — la parité
  suppose des FP stockés canoniques (garanti à l'écriture) ; résidu legacy documenté, non corrigé (préserve
  la requête indexée).
- **fpKey pipeline (front).** `pipeline.tsx isBooked` comparait des FP bruts (fpDocId) au lieu de fpKey, en
  divergence avec l'autorité miroir `overviewCalc.ts` → risque de double-compte pipeline. Rapprochement par
  `fpKey` des deux côtés. (Bornage période vs tous-millésimes : question distincte, non traitée.)
- **Commentaire de parité (front).** `mntDashboard.ts` : l'en-tête revendiquait une « parité stricte »
  echeancesProches ↔ signal echeance_proche, factuellement fausse (le front exclut suspendus + échéances
  dépassées). Commentaire corrigé pour décrire le SOUS-ENSEMBLE réel ; l'alignement de population (inclure
  suspendus/dépassés) est signalé comme décision produit à arbitrer — **non changé en silence**.

**À arbitrer (l'IA propose, l'humain valide).**
- Population « Échéances proches » (front) : rester le sous-ensemble « actifs à venir » ou s'aligner sur le
  signal de risque (suspendus + dépassés) ? Change les compteurs affichés → décision humaine.

**Lows documentés, non corrigés (nuance/dette, pas de régression).** churn `joursEcheance` recalculé au jour
vs `joursAvantFin` matérialisé ; MRR live vs snapshot (assiette identique hors filtre — commentaire) ;
`supplierCostByFp` (Lot 8b) correct mais non câblé (la marge mnt lit le coût P&L, pas les factures réelles).

**Vérifs.** tsc propre ; 1245 functions + 291 web au vert ; bundle 119,7 KB (≤ 120) ; no-undef (158),
deploy-targets (187) OK. Additif uniquement, aucun callable/droit/schéma nouveau.

## Réf. PR2 — Référentiels transverses dans Référentiels (ADR-045) — 2026-07-20

**Fait.** Relocalisation présentationnelle des référentiels transverses (taux de change/devises, Project
Managers, Business Units, Territoires, Équipes) depuis Habilitations vers un nouvel écran **Référentiels ›
Devises & référentiels** (`web/src/modules/referentielsadmin.tsx`, `ReferentielsAdmin`).

**Câblage.**
- `FxRatesCard` + `RefListCard` (×4) déplacés hors d'`admin.tsx` → `referentielsadmin.tsx`. Imports morts
  retirés d'`admin.tsx` (`setFxRates`, `setRefList`, `listClickupMembers` — vérifiés uniques aux composants
  déplacés). Rubrique « Référentiels » d'Habilitations retirée (renvoi en commentaire).
- Garde `useClaims().role === "direction"` conservée à l'identique (état « Réservé à la Direction » sinon) ;
  clé de module `habilitations` (visibilité admin). **Aucun élargissement** de qui édite (FX surtout).
- Nav : `MODULES` id `referentielsadmin`, ajouté au groupe **Référentiels** ; garde-fou nav respecté.
- Callables et règles Firestore inchangés (config/* déjà lisibles, écriture réservée aux Functions).

**Gouvernance.** Strictement additif. ADR-045. Étape 2/3 de la consolidation des référentiels.

## Réf. PR3 — Normalisation fournisseurs minimale (ADR-046) — 2026-07-20

**Fait.** Infrastructure MINIMALE de normalisation fournisseur : inventaire + alias manuels déterministes
(sans IA), consolidée en SECTION du référentiel Fournisseurs. Dernière étape (3/3) de la consolidation.

**Câblage (back).**
- Domaine PUR `functions/domain/supplierName.js` (`buildSupplierResolver`, `groupSupplierNames`) + test
  (7 cas). Clé = `cleanName` (ADR-P20), PAS de règles juridiques/pays. Sans alias, resolve = identité.
- `suppliers()` (`domain/fournisseurs.js`) : nouvel `opts.resolveSupplier` (défaut `cleanName`) — les 4 sites
  de clé fournisseur passent par `keySup`. **Caractérisation** : `fournisseurs.test.js` (9 tests) au vert
  inchangé → SOA byte-identique sans alias (non-régression prouvée AVANT modification).
- `aggregate.js` lit `config/supplierAliases`, construit le résolveur, le passe à `suppliers()`.
- Callables `setSupplierAliases` (droit `fournisseurs`) + `supplierNames` (inventaire, lecture) ; ajoutés à
  `deployed-functions.txt` ; rule `config/supplierAliases` (lecture `fournisseurs`, write Functions).

**Câblage (front).**
- `web/src/lib/supplierNormWrites.ts` (isolé du chunk d'entrée) + `web/src/modules/suppliernorm.tsx`
  (inventaire + table d'alias, sans IA/fuzzy). Rendu comme **section** dans `fournisseursref` (pas un onglet
  séparé → budget bundle 119,9 KB respecté ; regroupe la gestion fournisseur).

**Gouvernance.** Strictement additif : le SOA ne bouge QUE si un alias est posé (l'humain valide). `cleanName`
reste l'autorité (ADR-P20). ADR-046.

**Vérifs.** 1252 functions (dont supplierName ×7 + caractérisation fournisseurs) + 291 web au vert ; tsc
propre ; bundle 119,9 KB (≤ 120) ; no-undef (159), deploy-targets (189), indexes (3 composites) OK.

## #268 — Intégration ClickUp déplacée dans le cockpit ClickUp (ADR-047) — 2026-07-20

**Fait.** La configuration + les actions ClickUp (grosse carte `ClickupCard` : toggle, listes, synchro/push/
rattachement/dédoublonnage commandes & BC, webhooks temps réel, diagnostic) déménagent d'Habilitations vers
le cockpit ClickUp, aux côtés de ses KPI de pilotage.

**Câblage.**
- Extraction de `ClickupCard` + helpers (`ClickupHealthPanel`, `ClickupActionRow`, `CLICKUP_LISTS`,
  `CLICKUP_WEBHOOK_ENDPOINT`) d'`admin.tsx` vers un nouveau `web/src/modules/clickupAdmin.tsx` (export
  `ClickupCard`). ~390 lignes déplacées ; imports morts retirés d'`admin.tsx` (15 callables ClickUp +
  `useConfirm`, `trackWrite`, type `ClickupHealthSummary`).
- `clickupcockpit.tsx` : rend `<ClickupCard/>` **uniquement pour la direction** (`useClaims().role`),
  identique à l'ancien `isDirection`. Les redirections « → Habilitations » deviennent « → carte de
  configuration ci-dessus ». La vue lecture (KPI) reste ouverte au module `overview`.
- Habilitations garde la rubrique « Intégrations API » (Odoo/outbound/API keys/… — cible de #269) ; la
  carte ClickUp est retirée (renvoi en commentaire).

**Gouvernance.** Strictement additif : aucun callable/droit/schéma modifié, aucun élargissement de qui
configure ClickUp. Les deux modules restent lazy → chunk d'entrée inchangé. ADR-047.

**Vérifs.** tsc propre ; bundle 119,9 KB (≤ 120) ; 291 web au vert (backend inchangé).

## #269 — Onglet Admin « Intégration » dédié (ADR-048) — 2026-07-20

**Fait.** Un nouvel onglet Admin « Intégration » regroupe tous les branchements externes de l'ERP :
webhook entrant Odoo, webhook sortant, API REST publique + clés, champs custom, automatisations,
notifications Slack/Teams, e-mail Office 365. Sortis d'Habilitations pour un point d'entrée dédié.

**Câblage.**
- Les 7 cartes (`OdooWebhookCard`, `OutboundWebhookCard`, `ApiKeysCard`, `CustomFieldsCard`,
  `AutomationCard`, `NotificationCard`, `EmailNotifyCard`) restent DÉFINIES dans `admin.tsx` (passées en
  `export`) et sont rendues par un nouvel écran `web/src/modules/integration.tsx`.
- `integration.tsx` : garde direction-only stricte (`useClaims().role === "direction"`, identique à
  l'ancienne condition d'Habilitations). Sections « Webhooks & API », « Champs & automatisations »,
  « Notifications ». Réutilise la clé de droit `habilitations` (aucun nouveau droit).
- `index.tsx` : entrée `MODULES` `integration` (icône `Wrench` déjà importée → coût bundle nul) ajoutée au
  GROUP « Admin » (`cleanup`/`habilitations`/`clickupcockpit`/`integration`).
- Habilitations : rubriques « Intégrations API & automatisation » et « Notifications » retirées (renvoi en
  commentaire → Admin › Intégration). La rubrique « Réglages de calcul » reste sur place.

**Gouvernance.** Strictement additif : aucun callable/droit/schéma modifié, aucun élargissement de qui
configure les intégrations (URLs/secrets sensibles). Le nouvel écran est lazy. ADR-048.

**Budget bundle.** L'accumulation d'entrées de nav (onglets Admin) porte le chunk d'entrée à ~120,1 KB. Le
garde-fou `check-bundle.mjs` passe de 120→122 KB (décision direction). Son rôle reste intact : bloquer un
import STATIQUE lourd qui devrait être lazy — la hausse ne vient pas d'un import lourd mais du cumul d'entrées.

**Vérifs.** tsc propre ; bundle ≤ 122 KB ; 291 web au vert (backend inchangé).

## Re-audit final du programme (workflow 5 dimensions + vérif adverse) — 2026-07-20

**Fait.** Re-audit final : 5 dimensions en parallèle (relocations UI, cohérence des chiffres, invariants
fpKey/plausibleYear, RBAC/sécurité, intégrité ingestion Odoo), chaque constat réfuté par 2 sceptiques
(lentilles correctness + portée/régression). 13 constats bruts → **5 confirmés (2/2)**.

**Verdict global : programme sain, un unique risque HAUT circonscrit.** La relocalisation UI (#533-538) est
une **non-régression vérifiée** : NAV intègre (42 ids, chacun dans 1 GROUPS), gardes d'édition STRICTEMENT
identiques au pré-déplacement (FX/intégrations/ClickUp restent direction-only ; lignes de crédit fournisseurs
restent `useCan('fournisseurs')==='write'`), aucun code mort (tsc clean), drapeau éteint = ERP d'avant.

**Correctif shippé (autonome, sans ADR) — constat #2 (MEDIUM) :** `backlog.tsx:679` — le correcteur de
commande testait `yearPo` BRUT (`!(row.yearPo && row.yearPo>0)`), masquant le champ « Année de PO » sur un
millésime aberrant (1900, 20226) que le cockpit Qualité signale pourtant. Aligné sur `plausibleYear`
(miroir de `dataQuality.js:61` et `atterrissage.js:34`) : `!(plausibleYear(row.yearPo)>0)`. Une ligne,
`plausibleYear` déjà importé, aucune donnée inventée. tsc propre, bundle 120,1 KB (≤ 122), 291 tests verts.

**Constat #5 (cosmétique, LOW) — classé, pas corrigé :** `referentielsadmin` et `integration` partagent
`key:'habilitations'` → 2 onglets vides (EmptyState « Réservé à la Direction ») pour un rôle non-direction
qui aurait `habilitations` en lecture (aucun preset par défaut ne l'accorde). PAS un élargissement d'édition.
Le « corriger » introduirait une visibilité par rôle exact = convention nouvelle = ADR pour gain nul.

**DÉCISION HUMAINE REQUISE (ADR à venir) — cluster convergence Odoo↔Excel (constats #1/#3/#4) :** un seul
sujet, la sémantique du champ `source` sous double alimentation. À NE PAS trancher en silence.
- **#3 (HIGH)** `aggregate.js:225` — une opp ingérée par Odoo AVANT l'import Excel produit DEUX docs pour le
  même FP (`odoo_<safeId(fp)>` source:"odoo" vs `<hashId(fp,0)>` source:"salesData") ; le dédoublonnage par
  FP est scopé `source==="salesData"` → **double-compte du pondéré/funnel/conversion**. Correctif proposé :
  élargir `bestSalesByFp`/`salesFps` à `source∈{salesData,odoo}` (repr. le plus récent par fpKey) + répercuter
  à l'identique dans `overviewCalc.ts` (miroir) + test de parité.
- **#4 (MEDIUM)** `odooSync.js:34` — le webhook flippe `source: salesData→odoo` sur un doc existant, le
  soustrayant au marquage FANTÔME (stale) de la synchro LIVE → l'opp reste au pipeline indéfiniment. Décision
  d'autorité (qui gouverne une opp co-alimentée) → ADR.
- **#5 (MEDIUM)** `odooSync.js:70` — `mapOrder` pose `raf:null` + `merge:true` → **écrase le RAF curaté P&L**
  à chaque update Odoo. Geste défensif proposé : OMETTRE la clé `raf` (et designation/client/cas sur updates
  partiels) quand absente/vide. Shippable sans ADR mais lié au cluster → à traiter avec l'ADR d'autorité.

**Extension Odoo (demande initiale) — BLOQUÉE, décision humaine :** cartographie faite. Factures clients
create+update **déjà supportées** (webhook `object:"invoice"`). BC fournisseurs via Odoo = collision
`bcLines` (PDF/ClickUp) vs `orders.suppliers[]`, mapping indéfini. « DC/AAAA/NNNN » = entité sans modèle dans
le code (FP est la clé canonique). Bouton « sync-depuis-Odoo » = nécessite un client Odoo SORTANT inexistant
(tout est PUSH aujourd'hui). Aucun de ces points n'est un lot additif propre sans décision métier.

## Correctif re-audit #5 — webhook Odoo : mapping commande ADDITIF (ADR-049) — 2026-07-20

**Fait.** `mapOrder` (`functions/domain/odooSync.js`) ne façonne plus un doc complet (`raf:null`, `cas:0`,
`designation:""`, `suppliers:[]`) mais un doc **additif** : chaque champ n'est posé que si Odoo le fournit
(`present()` distingue « absent » de « 0/vide »). Avec `set(...,{merge:true})`, un update Odoo (souvent
partiel, temps réel) **cesse d'écraser** la valeur curatée du P&L Excel — en premier lieu le **RAF FIGÉ**
qui retombait sinon sur le dérivé et faisait bouger le backlog en silence. `fp` + `source:"odoo"` toujours
écrits. Décision du re-audit : « shipper maintenant, en lot séparé ».

**Vérifs.** 1253 functions au vert (test `odooSync` mis à jour : raf/dateCommande absents → clé omise ;
nouveau test « update partiel préserve les champs curatés ») ; no-undef (159) + deploy-targets (189) OK.
Backend seul, aucun changement front/bundle.

**Reste (décision prise, à coder ensuite) — cluster #3/#4 :** « Odoo = source live égale » → dédoublonnage
par fpKey à travers `{salesData, odoo}` dans `aggregate.js` + inclusion dans le calcul fantôme + miroir
`overviewCalc.ts` + test de parité + ADR d'autorité inter-sources. Lot suivant.

## Correctif re-audit #3/#4 — Odoo = source live égale (dédup FP + non-rétrogradation source) — 2026-07-20

**Fait.** Décision direction « Odoo = source live égale » appliquée (ADR-050) :
- **#3 (HIGH)** : le dédoublonnage par FP des opps (`aggregate.js` + miroir EXACT `overviewCalc.ts`) passe de
  `source==="salesData"` seul à `isLiveSource ∈ {salesData, odoo}` (`bestLiveByFp`/`liveFps`). Une opp écrite
  par Odoo AVANT l'import Excel ne double-compte plus le pondéré/funnel/conversion — on garde le représentant
  le plus récent (`updatedAt`) par `fpKey`.
- **#4 (MEDIUM)** : le handler `odooWebhook` (`index.js`) ne rétrograde plus la `source` d'une opp EXISTANTE
  (`delete doc.source` si exists) → une opp co-alimentée créée par l'Excel reste `salesData`, donc éligible au
  marquage fantôme de `lib/sync.js` ; une opp Odoo-only garde `odoo`.

**Alternative écartée** (documentée ADR-050) : « inclure odoo dans le calcul des fantômes de sync.js » →
staliserait toute opp odoo-only à chaque import Excel. La non-rétrogradation atteint l'intention sans l'effet
de bord.

**Vérifs.** 1253 functions + 293 web (dont 2 nouveaux tests de parité `overviewCalc` : opp Odoo+Excel même FP
→ 1 représentant ; `saisie` masquée par une opp `odoo`) au vert ; tsc propre ; bundle 120,1 KB (≤ 122) ;
no-undef (159) + deploy-targets (189) OK. Strictement additif, aucune donnée supprimée.

**Cluster Odoo↔Excel du re-audit : CLÔTURÉ** (#3 HIGH + #4 + #5 traités ; #1 cosmétique classé).
**Extension Odoo (BC via Odoo / DC→FP / sync sortant) : en attente de précisions métier** (plan cadré à venir).

## Extension Odoo Lot 1 — BC fournisseurs via webhook (→ bcLines, ADR-051) — 2026-07-20

**Fait.** 4ᵉ type d'objet `bc` au webhook Odoo → collection `bcLines` (indiscernable des BC PDF/ClickUp).
- `domain/odooSync.js` : mapper PUR `mapBc` (additif, patron ADR-049) ; `"bc"` ajouté à `OBJECTS` + dispatch.
- `index.js` (handler `odooWebhook`) : contexte BC chargé une fois (taux `config/fxRates` + `known` de tous les
  N° BC de source ≠ odoo) ; branche `bc` dans `processOne` : **priorité « comptable/ClickUp prime »** (skip si
  N° BC déjà connu → pas de double-compte du SOA, `domain/fournisseurs.js` somme toutes les lignes), id
  déterministe `bc_odoo_<bcKey>`, conversion XOF (contre-valeur saisie prioritaire), **statut d'ENGAGEMENT
  seulement** (jamais facture/solde — solde = acte comptable, comme ClickUp). Champ `dc` capté (Lot DC à venir).
- `docs/ODOO_WEBHOOK.md` : section `object = "bc"` documentée (contrat + priorité + statut).

**Gouvernance.** Strictement additif (nouvelle `source:"odoo"` dans bcLines ; aucune ligne existante modifiée ;
le SOA ne bouge que si un BC Odoo INÉDIT entre). Odoo en plus basse priorité (défère à comptable ET ClickUp) —
point de revue noté dans l'ADR-051 si Odoo doit un jour superséder ClickUp.

**Vérifs.** 1256 functions au vert (dont 3 tests `mapBc` : cible bcLines + additif + dispatch/amountXof) ;
no-undef (159) + deploy-targets (189) OK. Backend seul, aucun changement front/bundle.

**Suite (décidé) :** Lot 2 = rattachement DC (champ propre en plus du FP) ; Lot 3 = bouton « sync-depuis-Odoo »
(client sortant xmlrpc/jsonrpc, clé API) — en attente URL instance / base / modèles / fenêtre.

## Extension Odoo Lot 2 — rattachement DC (identifiant propre additif, ADR-052) — 2026-07-20

**Fait.** Le « DC » Odoo est un identifiant PROPRE porté EN PLUS du FP (pas un alias, pas un remplaçant).
- Backend : champ `dc` capté additivement par les 4 mappers (`mapOpportunity`/`mapOrder`/`mapInvoice`/`mapBc`)
  quand Odoo le fournit ; jamais clé de rapprochement — le N° FP (`fpKey`) reste l'unique clé d'affaire.
- Front : `dc?` typé sur `Order`/`Invoice`/`Opportunity` ; affiché en lecture dans la modale « Corriger la
  commande » (backlog) là où le FP est déjà mis en avant. Élargissement à d'autres vues au fil du besoin.

**Gouvernance.** Strictement additif : champ optionnel, aucun agrégat ni rapprochement modifié ; le DC n'entre
dans AUCUN calcul (pas de 2ᵉ clé d'affaire). ADR-052.

**Vérifs.** 1257 functions (dont test DC sur les 4 mappers) + 293 web au vert ; tsc propre ; bundle 120,1 KB
(≤ 122) ; no-undef OK.

**Suite :** Lot 3 = bouton « sync-depuis-Odoo » (client sortant xmlrpc/jsonrpc, clé API) — EN ATTENTE des
précisions : URL instance, nom de base, modèles à tirer, fenêtre delta.

## Fix backlog — « intégrer »/« Solder »/correction FP sur « Commandes à RAF dérivé (suspectes) » — 2026-07-20

**Symptôme (signalé prod).** Sur la carte « Commandes à RAF dérivé (suspectes) », « intégrer » (valider le RAF)
et « Solder » ne faisaient rien / étaient refusés ; pas de possibilité de corriger le N° FP.

**Cause racine.** Ces lignes ont un RAF DÉRIVÉ précisément parce qu'elles n'ont PAS de ligne P&L curatée :
source `opp_won`/`fiche` = commande construite virtuellement par `mergeCommandes` depuis l'opp gagnée / la
fiche, SANS document `orders/{fp}`. Or `patchOrder` (derrière Valider/Solder) lève `failed-precondition —
commande P&L introuvable` s'il n'y a pas de doc. Les actions s'appliquaient donc à des lignes qu'elles ne
pouvaient pas écrire.

**Correctif (front seul, `RafValidator` dans backlog.tsx).** Valider/Solder tentent `patchOrder({fp,raf})` ;
si la commande est introuvable (ligne dérivée), on MATÉRIALISE via `createOrder` (source `manuel`, CAS de la
ligne + RAF validé) — mécanisme de réconciliation documenté (une ligne P&L Excel du même FP la réécrase au
prochain import → P&L strict prioritaire préservé). Ajout de la **correction du N° FP** dans le même éditeur :
re-clé `patchOrder({fp,newFp})` si la commande existe, sinon `createOrder` sous le FP corrigé (chacun a sa garde
anti-doublon). Réutilise les callables existants ; aucun changement backend.

**Vérifs.** tsc propre ; 293 web au vert ; bundle 120,1 KB (≤ 122).

**Reste à confirmer.** Le 1ᵉʳ signalement (« Inscrire au P&L » sur « opportunités gagnées sans commande »)
échoue différemment (probable `already-exists` : un `orders/{fp}` annulé/écarté existe) — en attente du toast
exact pour un correctif ciblé.

## Extension Odoo Lot 3 — backfill/re-sync par le webhook ENTRANT (option A retenue) — 2026-07-20

**Décision.** Plutôt qu'un bouton « sync-depuis-Odoo » (client sortant xmlrpc/jsonrpc à construire, non
testable sans instance, creds à héberger), la Direction retient l'**option A** : tout se tire d'Odoo vers
l'app **par le webhook entrant existant** (PUSH). Le temps réel est déjà couvert (Automated Actions) ; le
rattrapage/backfill complet se fait côté Odoo par une Server Action qui pagine (≤ 500/req) vers le même
endpoint HMAC — idempotent, rejouable, aucun doublon. **Aucun code nt360 neuf**, on réutilise le chemin testé.

**Fait (docs/ODOO_WEBHOOK.md).** Mappers `map_lead`/`map_order`/`map_invoice` enrichis du champ `dc` ; ajout
`map_bc` (purchase.order → bc). Automated Action `purchase.order` documentée. Nouvelle §4bis « backfill paginé »
(Server Action complète + variante delta via `write_date`/`ir.config_parameter`). Intro mise à jour (4 objets +
2 modes). Le Lot 3 « client sortant » est **abandonné** au profit de l'option A.

**Vérifs.** Docs seules (aucun code) ; aucun impact tests/bundle.

## Bouton Admin « Purge des données » (table rase P&L / Opportunités, ADR-053) — 2026-07-20

**Fait.** Callable `purgeCollections` (handler sanitize.js) + carte Admin « Zone dangereuse › Purge des données ».
- Backend : DIRECTION-only (nt360Role), confirmation « PURGER » obligatoire, rate-limité, audité. Table rase
  (toutes sources) de orders (P&L) et/ou opportunities, avec satellites + overlays (choix Direction : purger
  aussi les overlays + l'historique d'étapes). Suppression paginée (400/lot, garde PURGE_MAX). Recompute
  best-effort. Fonction PURE `purgePlan(targets)` (union dédupliquée de fpAliases partagé) — testée (4 cas).
- Front : PurgeCard Direction-only, bouton rouge conditionné à (cible cochée + saisie « PURGER ») +
  re-confirmation DangerBtn. web/src/lib/writes.ts : wrapper purgeCollections (timeout 540 s aligné serveur).
- deployed-functions.txt : purgeCollections ajouté (190 fns). ADR-053.

**Décisions (Direction) :** table rase toutes sources · purger AUSSI les overlays · purger l'historique.
Hors périmètre : factures + cancelInvoices (non demandés).

**Vérifs.** 1261 functions au vert (dont 4 purgePlan) ; tsc propre ; bundle ≤ 122 ; no-undef (159) +
deploy-targets (190) OK.

## Purge — extension anti-orphelins : activités & approbations (post-audit ADR-053) — 2026-07-20

**Constat (audit inline).** Le purge des opportunités vidait opps + historique + overlays mais PAS les
satellites top-level rattachés par enregistrement : `activities` (timeline) et `approvals` (workflow). Ids
déterministes → au ré-import, ces orphelins se ré-attachaient à l'opp fraîche (timeline/approbations périmées).

**Fait.** Suppression FILTRÉE (jamais toute la collection) : opportunités → activities(relatedType=opportunity)
+ approvals(entityType=opportunity) ; P&L → approvals(entityType=order). Comptes/BC/contrats/astreintes
PRÉSERVÉS. `purgePlan` étendu (champ `filtered`, dédup par collection|field|value) + helper `purgeColWhere`
(query bornée). Front : libellés de la carte Purge mis à jour. Tests purgePlan étendus (3 cas). ADR-053 complété.

**Vérifs.** 1261 functions au vert ; no-undef (159) + firestore-indexes (les `where` mono-champ n'exigent aucun
index composite) ; tsc propre ; bundle ≤ 122.

## Webhook BC entrant — champs additifs + rapprochement DC → N° FP (ADR-054) — 2026-07-20

**Contexte.** « Mettre à jour le webhook entrant pour les BC » — 3 axes retenus par la Direction : champs
manquants, doc Odoo (mapping), rôle du DC dans le rapprochement.

**Fait.**
- **Champs (grounded, non inventés — issus du type `BcLine` déjà consommé en aval)** : `mapBc` capte désormais
  `etaContrat` (ETA contractuelle ≠ `etaReel`, utilisée par `clickupBc.js`), `updateDate`, `comment`. Additif
  (patron ADR-049) : date invalide → `null`, champ absent → omis (pas d'écrasement au merge).
- **Rapprochement DC → N° FP** : helper PUR `resolveBcFp(doc, dcAliasMap)` (le FP explicite d'Odoo PRIME ;
  l'overlay n'agit que si le FP manque). Handler `odooWebhook` charge `config/dcAliases` dans `bcCtx` et
  l'applique avant l'upsert BC. Callable `setDcAlias` (miroir `setFpAlias`, droit « import », audité, recompute).
  Front : carte *Assainissement → Rapprochement DC → N° FP* (miroir `FpReconcileCard`) + wrapper `setDcAlias`.
  Règle Firestore `config/dcAliases` lisible sous `canRead('import')`. `deployed-functions.txt` : +`setDcAlias`.
- **Doc** `docs/ODOO_WEBHOOK.md` : lignes du contrat BC (etaContrat/updateDate/comment) + section rapprochement
  DC + exemple `map_bc` mis à jour.

**Décision de modèle (ADR-054).** DC = overlay curé `dcAliases` (additif, réversible, humain dans la boucle),
PAS un changement de modèle (lien BC↔commande client par DC, ou DC = sous-affaire) — écartés faute de donnée et
par « additif uniquement ». Overlay vide par défaut → comportement strictement inchangé (cas normal Odoo FP+DC).

**Vérifs.** odooSync.test.js au vert (19 tests, dont resolveBcFp 3 cas + champs additifs) ; no-undef (159) +
deploy-targets (191) OK. tsc + bundle : à valider en CI.

## Remédiation audit intégrité FP + systèmes de correction (ADR-055) — 2026-07-20

**Audit (5 auditeurs lecture seule + vérification manuelle).** Cœur de calcul FP SAIN : fpKey + fpAliases
appliqués partout (mergeCommandes, aggregate, dataQuality/alerts, miroir front overviewCalc), plausibleYear
discipliné, parité fpKey/plausibleYear back↔front identique au caractère près. Défauts concentrés dans les
overlays de correction et l'ingestion Odoo.

**Corrigé (choix Direction « tout, HAUTE→MOYENNE ») :**
- **H1** setFpAlias/setDcAlias : `merge:true` → `merge:false` — la suppression d'un alias (map) était
  silencieusement inopérante (clé préservée au merge récursif → alias « supprimé » toujours appliqué). Bug
  de prod pré-existant sur setFpAlias. Vérifié en lecture directe du code.
- **H2 + M1** mapBc/mapOpportunity/mapInvoice : gate sur le RÉSULTAT de fpKey/isoDay (clé omise si null) au
  lieu de l'input brut `present` — un fp placeholder / une date invalide écrivaient `null` qui écrasait au
  merge une valeur curatée (BC orphelin, correction setInvoiceFp perdue). Patron déjà en place dans mapOrder.
- **M2** dcAliases rendu RÉTROACTIF : appliqué au recompute (aggregate.js) + correctionQueue, pas seulement à
  l'ingestion webhook. resolveBcFp garde la primauté d'un FP existant.
- **M3** reconClient : exclut annulés (safeId(fp)/id) + fantômes(stale) + périmées(aged) + dédup salesData/
  saisie — assiette alignée sur aggregate/correctionQueue (ne proposait plus de rapprocher vers un FP annulé).
- **M4** capacity.demandDaysOf : retrait du repli `o.weighted` linéaire persisté (interdit CLAUDE.md) — pw
  tiéré puis repli montant×IdC.

**Tests.** Assertions mises à jour (clé omise vs null ; weighted ignoré) + nouveaux cas (fp placeholder omis,
resolveBcFp). Suite functions **1265/1265**. no-undef (159) + deploy-targets (191) + firestore-indexes OK.

**Non corrigé (FAIBLE/INFO, signalés) :** parité buildFpAliasResolver undefined/null (inoffensif, non testé
front) ; fiscalYearFromOrders non borné (défense en profondeur) ; RBAC config/dcAliases import vs bc ;
hypothèse 1 DC→1 FP ; dedupe/reconClient recompute direct ; trous de test parité croisée front/back.

## Colonne MB des opportunités reconnue + repli marge du carnet (ADR-056) — 2026-07-20

**Demande.** « Confirmer la colonne MB à l'import des opportunités » puis « MB sera considéré en l'absence de
MB TOTAL (à ramener en %) dans P&L et en l'absence de fiche affaire ».

**Fait (constat data).** Le fichier LIVE réel (`Opps.xlsx`, 3537 lignes) a une dernière colonne **`MB`** (pas
« MB TOTAL » comme la capture) = un **%** (3, 20, 23.42…). Elle était **ignorée** (parseur n'acceptait que
`MB prév…`). Côté P&L, `MB TOTAL` est au contraire un **montant absolu** (FCFA). Piège d'échelle central.

**Fait (2 briques, 1 PR).**
- **A — parseur opps** : `MB` (nu, ÉGALITÉ EXACTE — « mb » en sous-chaîne capterait « Nombre… ») + `MB TOTAL`
  alimentent `mbPrev` (%). Round-trip export inchangé.
- **B — autorité marge (`mergeCommandes`)** : repli `marginPct` fiche > `MB TOTAL/CAS` P&L > `mbPrev` opp.
  Levier = **`mb` (montant)**, PAS `marginPct` : dès `CAS>0` tous les consommateurs font `mb/CAS` et ignorent
  `marginPct` (piège appris : `Order.marginPct` est un RATIO côté fiche mais atterrissage/backlog ne le
  normalisent pas → injecter un % brut = bug ×100, audit P2-1). On pose `mb = round(mbPrev% × CAS)`,
  flag `mbSource="opp"`. Repli seulement si **pas de fiche** ET **`mbPresent=false`** (nouveau flag P&L,
  distingue MB TOTAL absent d'un 0 réel) ET `CAS>0` ET opp du FP porteuse d'un `mbPrev`.
- **Honnêteté** : `mbSource` porté du carnet au front (overlay `_shared` + chunk marge) ; badge « marge
  estimée » + note + compteur `mbEstimatedCount` en Rentabilité ; ces affaires EXCLUES du flag « coût absent »
  (un seul signal). Aucune donnée réécrite ; s'applique au prochain recompute / ré-import.

**Tests.** Reconnaissance MB/MB TOTAL (+ non-capture « Nombre ») ; repli (fiche/P&L/opp, mbPresent, legacy
mb>0, multi-opps stage). Suite functions **1275/1275**. no-undef (159) + deploy-targets (191) OK. Web build +
bundle d'entrée 120.7 KB ≤ 122.

**Appris.** La capture (« MB TOTAL ») mentait sur l'en-tête réel (« MB ») — toujours ouvrir le fichier. Et
`Order.marginPct` a une échelle ambiguë par conception (ratio canonique + tolérance pourcentage) : ne jamais
y injecter un nouveau %, passer par `mb` absolu.

## Audit 40 axes facturation/revenu/exécution + remédiation complète R1→R4 (ADR-057) — 2026-07-21

**Demande.** « on audite le module facturation-revenu-exécution : évaluation sur 40 axes user facing et
technique » puis « on corrige tout. cible 10 sur 10 ».

**Audit (5 auditeurs lecture seule, 8 axes chacun).** Verdict 8,2/10 — socle rigoureux (autorités pures
testées, miroirs commentés, overlays non destructifs), défauts concentrés sur UNE famille : un consommateur
secondaire pas à jour de l'autorité principale. 8 HAUTE : tauxEncaissement non persisté ; export CODIR
objectif/écart figés (isolation RBAC + merge:true) ; dédup live divergente correctionQueue⇄recompute ;
triple canonicalisation N° BC (double engagement SOA possible) ; écritures BC sans invalidation par_ca ;
receivables calculé jamais affiché ; vue Facturation ignorant le filtre sans bandeau ; alerte livraison
sans liste énumérable.

**Fait (4 commits, R1→R4 — détail en ADR-057).** Tous les HAUTE + MOYENNE calc + finitions : source unique
domain/liveOpps (nouveau, testé), bcCompareKey (lib/ids), purge des champs isolés de l'atterrissage public,
scopes partenariats/recognition, carte Créances & DSO, liste overdue persistée+affichée, miroir marginRate
CAS=0 + 4 cas de parité, missingCjm/astreintes affichés, soaFromInvoices → décaissements (needCredit étendu),
toast/flashs/frDate/indetermine/troncatures/tokens --hair.

**Appris.**
- Le patron de défaut dominant n'est PAS le calcul faux mais le consommateur orphelin d'une évolution :
  isolation RBAC sans purge des résidus merge:true, summary calculé sans vue, scope de recompute non étendu.
- `merge:true` + déplacement de champs = résidus FIGÉS invisibles ; toute isolation doit purger
  (FieldValue.delete) y compris les clés de maps fusionnées récursivement.
- Deux clés « canoniques » concurrentes (safeId vs bcKey) = trou d'éviction ; la comparaison inter-graphies
  doit assimiler les séparateurs AVANT canonisation (« BC-2026-001 » ≡ « BC/2026/1 »).

**Non corrigé (assumé, signalé) :** parités MRR/ARR front/back par convention (PERIOD_MONTHS triplé, pas de
fixtures partagées) ; « Backlog » cohorte vs glissant sans note UI sur les vues entités ; `o.marginPct || 0`
non normalisé dans atterrissage.js:105/backlog.tsx:170 (branche prouvée morte — rep borné à 0 quand CAS≤0 —
à unifier si un avoir net négatif la réveille) ; colonne « source » absente de la liste BC ; overlay
clickupBcSync par clé safeId (le push/pull écrit depuis les lignes app → clés alignées en pratique).

**Vérifs.** Functions 1291/1291 (dont liveOpps 12, décaissements drapeau 2), web 297/297 (dont parité 15),
no-undef (160), deploy-targets (191), indexes, bundle 120,8 Ko ≤ 122.

---

## 2026-07-21 — Remédiation audit partenariats (PAR-P1→P4, ADR-058)

**Audit (4 auditeurs, 34 axes, personas channel manager + responsable partenariats).** Verdict 7,4/10.
9 HAUTE : recompute différé inerte → summaries par_ figés 24 h après chaque mutation ; CA constructeur
comptant les achats planifiés `source:"fiche"` (double-compte à l'arrivée du BC réel) ; alias fournisseurs
(ADR-046) ignorés par par_ca (populations divergentes avec le SOA) ; `fiscalStartMonth` saisi mais
inappliqué ; `suggestParPartnerMap` absent du return du handler → export undefined en prod ;
`deleteParPartner` sans garde serveur (le front prétendait un refus backend inexistant) ; statut certif
persisté jamais réécrit ; timeouts client 70 s sur callables 300 s ; aucun loading/error/truncated.

**Fait (4 commits, P1→P4 — détail en ADR-058).** P1 : fiche exclue, resolveSupplier branché, exercice
fiscal par allocation (`exerciseStartIso`, fenêtre datée dateIn / approximation millésime), unmappedCount +
declaredRawXof. P2 : recompute synchrone best-effort sur les 8 mutations + setParFeature(on), garde
d'intégrité + purge mapping à la suppression de partenaire (purgePartnerFromMap pur), cascades staffing
(rename → dénormalisations, delete → cascade gatée drapeau), statut certif réécrit au recompute. P3 :
suggestParPartnerMap câblé + test fabrique→exports, timeouts 300 s, gardes loading/error/troncature, hero
« — », tris, ratioColor unifié, types. P4 : partnerRenewalWatch (J-90/60/30) + bulletins, badge « ≠
calculé » (déclaré vs tierProgress), comparatif inter-constructeurs, colonnes BC/déclaré/écart.

**Appris.**
- Le piège du test fiscal : un filtre d'exercice LIGNE-niveau court-circuite la logique PAR ALLOCATION —
  la décision d'appartenance à l'exercice appartient à l'allocation (chaque constructeur a sa fenêtre),
  le filtre civil ne juge que les lignes non mappées.
- `check-deploy-targets` (regex `exports.X =`) ne voit pas un export UNDEFINED : le trou se situe entre le
  handler défini et le return de la fabrique. Test de câblage systématique pour toute fabrique à N callables.
- Un front qui annonce une garde serveur (« seront refusés ») sans que le serveur la tienne est pire que
  pas de garde : l'utilisateur croit l'intégrité protégée.

**Non corrigé (assumé, à reproposer) :** avantages programme (MDF/rebates/deal registration), pipeline
sourcé partenaire, import certifs par fichier (session exceljs dédiée) — efforts L, sessions dédiées.

**Vérifs.** Functions 1308/1308 (dont parRevenue 25, parPartner 15, parAlert 8, parNews 3, câblage 2),
web 297/297, tsc OK, no-undef (160), deploy-targets (191), indexes, bundle 120,8 Ko ≤ 122.


---

## 2026-07-21 (suite) — PAR-L1/L2 : pipeline sourcé partenaire + import certifs fichier (ADR-059)

**Fait (2 commits).** PAR-L1 : parPartnerId additif sur l'opp (upsert/patch), domain/parPipeline pur (5
tests), summaries/par_pipeline (pondéré = projectionWeight/tiers, gagné = millésime closingDate via
plausibleYear), scope opp → partenariats, sélecteur au formulaire Pipeline (gaté drapeau + droit), carte
dashboard vs objectif BP. PAR-L2 : domain/parCertFile pur (6 tests — en-têtes FR tolérants, résolution
référentiel stricte, rétro-calcul d'obtention), callable importParCertificationsFile (dry-run → confirm,
propriété par_cert_import, consultants sous droit pipeline cap 300), bouton fichier en Paramétrage.

**Appris.** normName LIE les apostrophes → « Date d'obtention » plie en « date dobtention » : les listes
d'en-têtes reconnues doivent inclure les variantes PLIÉES, pas seulement les libellés lisibles.

**Vérifs.** Functions 1319/1319, web 297/297, tsc/eslint OK, deploy-targets (192), no-undef (162),
bundle 120,8 Ko ≤ 122. MDF/rebates/deal registration : toujours en attente (non demandé).


---

## 2026-07-21 (suite 2) — Backlog B1→B4 + Rentabilité RB1 + import actionnable (ADR-060)

**Audits.** Backlog 7,1/10 (4 auditeurs, 36 axes) ; Rentabilité 7,75/10 (4 auditeurs). Constat transverse
dominant : le recompute DIFFÉRÉ inerte en prod frappait TOUTES les mutations du carnet et de la marge —
toasts « recalcul lancé » mensongers, summaries figés jusqu'à 05:00, astreintes approuvées jamais comptées.

**Fait (6 commits).** Diagnostic import (refus nomme onglets/en-têtes vus + signatures attendues) ;
B1 fraîcheur (12 sites carnet en recompute synchrone best-effort, fpKey jalons aggregate, miroir défauts
réaligné + tests, gardes RAF/Σ serveur) ; B2 honnêteté (frDate, bandeau filtre, error/truncated propagés,
anti-flash + memo CarryoverCard, bornes dites, confirmation Solder, liste dormantes) ; B3 parité (pms
clampé, libellés glissant, reportedFromMilestones extrait+testé, parité croisée backlogFy⇄overview) ;
B4 finitions (tris, erreurs cartes, aria indexés, auditLog module réel, frontière RBAC actée en ADR) ;
RB1 rentabilité (marginRate autorité pour reporteMarge, effet astreinte synchrone, fuite tjmBilled
colmatée, scopes CRA/CJM, capped propagé/affiché).

**Appris.** Un « best-effort différé » qui ne s'exécute jamais est pire qu'un synchrone lent : l'UI promet
un rafraîchissement qui n'arrive pas, et l'utilisateur re-clique (double écriture évitée seulement par
l'idempotence). Vérifier le DÉPLOIEMENT d'un trigger avant de router des effets métier dessus.

**Reliquats (ADR-060) :** badge « estimée » FP360/livraison, fiche masquée dérivable, auditLog en clair,
formats %, tendance/byPm marge, purge summaries marge périmés, 3e copie du peg.

**Vérifs.** Functions 1323/1323, web 301/301, tsc/eslint, no-undef (162), deploy-targets (192), indexes,
bundle ≤ 122 Ko.

---

## 2026-07-21 — RB2 : reliquats Rentabilité soldés (ADR-061)

**Fait.** Les 7 reliquats de l'ADR-060 : masque fiche ÉTANCHE (vente + taux + montants de lignes omis,
garde serveur anti-écrasement aveugle sur updateFiche étape 0) ; auditLog en drapeaux (patch_fiche /
set_cost_model / astreinte_submit sans montants) ; tendance de marge mensuelle (plafond CAS chronologique,
Σ mois = mb Facturé, testé) + marge par PM dans rentabilite_* + 2 cartes front ; purge des summaries de
marge de millésimes disparus (mêmes gates que l'écriture) ; badge « marge estimée » propagé à FP 360° et
à la Marge de livraison (mbEstimated) ; erreurs front honnêtes (Factures, Créances & DSO, Objectifs,
Fiches, Rentabilité par ressource denied≠error) + useReloadOnWrite sur la Marge de livraison ; cible %MB
validée [0..1], date_fiche frDate, % fiches via pct(), peg centralisé (web/src/lib/fx.ts), drill-through
marge_negative segmenté, searchKeys des tables marge, byBu.pmb typé.

**Appris.** La marge « masquée » restait dérivable par un canal secondaire (lignes + vente + taux) et
fuyait par un troisième (auditLog) : masquer le canal principal ne suffit jamais — inventorier les canaux.
Un masquage serveur qui omet des champs ÉDITABLES impose une garde d'écriture symétrique, sinon le client
réécrit en aveugle ce qu'il n'a pas reçu.

**Échoué puis corrigé.** Tendance mensuelle : les factures non datées, triées en tête (clé vide),
consommaient le plafond CAS avant les factures datées → clé de tri « 9999-99-99 » (test rouge → vert).

**Vérifs.** Functions 1326/1326, web 301/301, tsc/eslint, no-undef (162), deploy-targets (192), indexes,
bundle 120,9 ≤ 122 Ko.

---

## 2026-07-21 — PAR-L3 : avantages programme (deal registrations, MDF, rebates) — ADR-062

**Fait.** Dernier effort L reporté par ADR-058 : 3 collections aux profils par_ existants (callable-only,
drapeau + droit, partenaire du référentiel obligatoire) — par_dealregs / par_mdf (droit partenariats),
par_rebates (marge arrière → second verrou rentabilite, montants jamais journalisés) ; domaine PUR
parBenefits (validations XOF entier / plausibleYear / fpKey, statuts d'expiration DÉRIVÉS au sweep du
recompute et réécrits) ; summaries/par_benefits (compteurs, expirations J-90/60/30 du MDF non consommé,
couverture du pipeline sourcé = opps taguées vs regs actives) + summaries/par_ca_rebates (attendu/reçu/
écart, échus non reçus) ; 7 callables + câblage (21) + deployed-functions (199) ; onglet front
« Avantages » (synthèse, fenêtres qui se ferment, 3 tables + formulaires, rebates gatés canSeeCa).

**Appris.** Le classement confidentiel se décide PAR NATURE de la donnée, pas par module : dans le même
onglet, le deal reg (montant d'opp) se lit au droit partenariats quand le rebate (marge arrière) exige le
second verrou — le préfixe par_ca des summaries fait le gating sans nouvelle règle.

**Vérifs.** Functions 1334/1334 (dont parBenefits 8 + câblage 21), rules émulateur 74/74, web 301/301,
tsc/eslint, no-undef (163), deploy-targets (199), indexes, bundle 120,9 ≤ 122 Ko.

**En parallèle (prod).** PR #555 fusionnée (squash 8d20265), Firebase Deploy success 12:49, smoke prod
success. « échec import » rapporté à 13:02 : 503 + CORS sur importDelta = fenêtre du déploiement glissant
(l'appel n'a pas atteint le code) — à rejouer ; si 503 persiste, lire les logs de la fonction.

---

## 2026-07-21 — HOTFIX : memoryMiB ignoré par firebase-functions v2 → import 503 (ADR-063)

**Fait.** Cause racine de l'« échec import » ENFIN trouvée : `memoryMiB` n'est pas une option v2 (c'est
`memory`, en "2GiB") — le SDK l'ignorait en silence, toutes les fonctions tournaient à 256 Mio, et
importDelta (2 Gio voulus) mourait en OOM (503 sans CORS) avant d'atteindre le code. Traduction centrale
lib/fnopts.withMemory + builders enveloppés sous leur nom (les ~175 sites inchangés), fail-fast sur valeur
inconnue, filet test __endpoint.availableMemoryMb === 2048.

**Appris.** Deux leçons : (1) un 503 sans en-têtes CORS = l'infrastructure a tué l'appel — chercher côté
conteneur (mémoire, démarrage), pas côté code ; (2) un SDK qui IGNORE une option inconnue sans erreur rend
le bug invisible pendant des mois — le filet doit vérifier l'état RÉSOLU (__endpoint), pas la déclaration.
Le diagnostic précédent (« fichier non reconnu », ADR-060) supposait que l'appel aboutissait — faux : il
n'a jamais abouti, d'où le carnet vide.

**Vérifs.** Functions 1338/1338 (fnopts 4), no-undef (164), deploy-targets (199).

---

## 2026-07-21 — CC : Centre de correction exploitable (contexte + actions + année FP + rapprochements intégrés) — ADR-064

**Fait.** Lot déclenché par le premier carnet réel en prod : (1) autorité — mergeCommandes step 1 dérive
`yearPo` de l'année du N° FP (bornée plausibleYear) quand la colonne Excel est vide/aberrante (plus de
« 2026 » en dur pour FP/2025/…) ; (2) chaque ligne du Centre porte son contexte identifiant (affaire,
montant, étape, AM, date, provenance) ; (3) actions de ligne par entité : modale « Corriger la commande »
(champs pré-remplis, seuls les modifiés partent), modale « Requalifier l'opportunité » (étape + motif de
perte), « annuler » commande/facture (overlay setCancellation, confirmation), « Solder le RAF » en un clic
(ClickUp clôturé), éditeur FP sur bc_fp_inconnu, « ouvrir » l'écran source partout ; (4) Dossier client,
réconciliations FP/DC et Doublons intégrés en sections repliables DANS le Centre (point unique) ;
(5) cockpit ClickUp : « Créer/Lier la tâche » unitaire par ligne non liée + « ⚡ tout créer » en masse,
pushOrderToClickup complété serveur depuis orders/{fp}.

**Appris.** Les champs de contexte étaient DÉJÀ transportés par correctionQueue (selects complets) — le
front les jetait à l'affichage. L'assiette des vues qualité passe partout par mergeCommandes : corriger
l'année à l'autorité aligne d'un coup summaries, alertes et Centre, sans miroir front à toucher.

**Vérifs.** Functions 1340/1340 (commandes 32 dont 2 nouveaux), web 301/301, tsc/eslint OK, no-undef
(164), deploy-targets (199), indexes, bundle 120,9 ≤ 122 Ko.

**Suivant.** PR à fusionner sur « go » ; après déploiement, relancer « Analyser » au Centre : le bucket
« sans année » doit tomber aux seuls FP sans millésime lisible.

---

## 2026-07-21 — Normalisation clients : zéro redondance (fusion flou + IA en une liste)

**Fait.** Les deux cartes de propositions (« Quasi-doublons » flous, « Normalisation IA ») faisaient le
même métier avec deux modèles d'interaction (bouton « Fusionner » par ligne vs cases + « Ajouter à la
liste »). Fusionnées en UNE carte « Fusions proposées » : liste unifiée dédupliquée par graphie SOURCE
(l'IA prime — elle porte une justification), badge de provenance (flou/IA), un seul mécanisme de
sélection, pré-cochage IA ≥ 90 % conservé. Une proposition DISPARAÎT dès qu'un alias (posé ou brouillon)
la couvre — plus de suggestion qui traîne après traitement. `aliases` mémoïsé (react-hooks).

**Vérifs.** Web 301/301, tsc/eslint 0, bundle 120,9 ≤ 122 Ko.

---

## 2026-07-21 — Normalisation fournisseurs dopée à l'IA (ADR-065)

**Fait.** « Doper à l'IA » l'atelier fournisseurs SANS recréer de pipeline : `aiSuggestClientMerges`
généralisé par un `entity` (« fournisseur ») — prompt achats (EXN = EXCLUSIVE NETWORKS, contre-exemples
SAMSUNG ≠ SAMSUNG MEDISON), droit `fournisseurs` (module de la donnée), dédup/no-op par `cleanName`
(ADR-P20) au lieu de `canonicalKey`. Front : carte « Fusions proposées (IA) » identique au modèle
clients (pré-cochage ≥ 90 %, ajout au brouillon d'alias, enregistrement humain, proposition masquée dès
qu'un alias la couvre). Zéro nouvelle fonction déployée (199 inchangé). Lève le « sans IA » d'ADR-046.

**Appris.** La barrière défensive (normalizeClientMergeSuggestions) était déjà paramétrable en pensée —
seul le no-op « déjà fusionné par les règles » dépendait du référentiel : c'est la clé canonique qu'il
fallait injecter (keyFn), pas dupliquer le module.

**Vérifs.** Functions 1342/1342 (aiClientNorm 9 dont 2 fournisseurs), web 301/301, tsc/eslint 0,
no-undef (164), deploy-targets (199), bundle 120,9 ≤ 122 Ko.

**En parallèle (prod).** PR #557 fusionnée (squash 3c2adec) sur « go » — déploiement main en cours à
la fusion (à confirmer au prochain point).

---

## 2026-07-21 — Récupération BC Odoo : option PUSH confirmée (renvoi unitaire §4ter + état de réception)

**Fait.** Demande « récupérer via webhook entrant odoo (unitaire ou masse) » depuis le rapprochement
DC → N° FP. Arbitrage utilisateur (AskUserQuestion) : RESTER EN PUSH (pas de client sortant Odoo — l'option
A d'ADR-051/274 tient). Livré : (1) doc ODOO_WEBHOOK.md §4ter — Server Action « renvoyer les BC
sélectionnés » (unitaire par DC ou sélection de la vue liste), en plus du backfill §4bis ; (2) odooWebhook
persiste `lastReceived` (horodatage, objet, écrits/échecs — best-effort, jamais bloquant) et
odooWebhookStatus l'expose (epoch ms) ; (3) Admin → Intégration affiche « Dernier envoi reçu » ;
(4) le Tip du rapprochement DC explique comment déclencher le renvoi et où vérifier son arrivée.

**Vérifs.** Functions 1342/1342, web 301/301, tsc/eslint 0, no-undef (164), deploy-targets (199),
bundle 120,9 ≤ 122 Ko.

---

## 2026-07-21 — Tableau de bord Contrats : lecture & analyse (KPI contextualisés, barres, échéances chiffrées)

**Fait.** Demande « améliorer design et affichage… et améliorer la lecture et l'analyse des data »
(capture du Tableau de bord Contrats). Uniquement des primitives ERP existantes, aucune couleur en dur :
(1) KPI contextualisés — part du parc (%), ARR avec équivalent MRR/mois, tickets « sur N », risque en %
des actifs ; (2) répartitions statuts/priorités en BARRES (HBars) avec les couleurs de sens des badges
(TONE_COLOR → tokens) et le % de chaque part — les proportions se comparent d'un regard ; (3) échéances
proches CHIFFRÉES : Σ ARR à renouveler en tête, ARR par contrat en ligne (`MntEcheanceProche.arr`,
même annualise() que le KPI — testé), badge 3 niveaux (≤15 j / ≤60 j / au-delà), renvoi vers
Renouvellements ; (4) « Par BU (ARR) » du revenu récurrent en HBars (les autres ventilations restent
en table, plus riches en colonnes).

**Vérifs.** Web 301/301 (mntDashboard étendu : arr par échéance), tsc/eslint 0, bundle 120,9 ≤ 122 Ko.

---

## 2026-07-21 — Design « tout » (D1+D2+D3) : entêtes cockpit partagées, tendance MRR visible, enjeux Σ

**Fait.** Suite du lot design, périmètre resserré après état des lieux (Partenariats a déjà son HeroBand,
Relances est déjà chiffré) : (1) `Spark` + `ScoreRing` MUTUALISÉS dans `_viz.tsx` (hors chunk d'entrée —
un premier passage par `_shared` faisait monter l'entrée à 121,8 Ko ; `_viz` n'est importé que par des
modules lazy → 120,9 Ko conservés) ; le Centre de correction consomme désormais les versions partagées ;
(2) Contrats/Pilotage : anneau « Santé du parc » (actifs sans signal de risque, seuils 90/70) devant les
KPI + SPARKLINE MRR (30 points du snapshot quotidien) à côté du delta — la tendance se voit ;
(3) cockpit ClickUp : la case « Couverture » devient un ANNEAU (un chiffre, un endroit — la tuile
redondante disparaît, grille resserrée) ; (4) Avantages partenaires : « À traiter (fenêtres qui se
ferment) » porte le compte et l'ENJEU Σ en tête (MDF non consommés à expirer · rebates attendus en
retard) — on sait ce qu'on laisse sur la table avant de dérouler.

**Appris.** `_shared` est dans le chunk d'entrée : toute primitive qu'on y ajoute se paie sur le budget
122 Ko. Les primitives d'entêtes cockpit vivent donc dans un module séparé importé par les seuls lazy.

**Vérifs.** Web 301/301, tsc/eslint 0, bundle 120,9 ≤ 122 Ko.

---

## 2026-07-21 — Seed FP–DC : import de la table de correspondance (ADR-066)

**Fait.** Contexte métier fourni par la direction : le DC Odoo est GÉNÉRÉ depuis le FP (« Générer DC »)
et porte ensuite toutes les dépenses du projet (BC, décaissements, astreintes…) ; une table FP–DC peut
être exportée pour le seed. Livré : callable `importDcAliases` (droit import, dry-run → confirmation,
fichier xlsx/csv ≤ ~22 Mo via xlsxRead), plan PUR `domain/dcMapImport` (détection PAR CONTENU — la
cellule fpKey-résoluble est le FP, l'autre est le DC, ordre libre ; dédup par DC ; borne 5 000 signalée),
règle de conflit L'EXISTANT PRIME (un arbitrage humain n'est jamais écrasé — conflits signalés). Front :
bloc « Seed initial » dans Rapprochement DC (aperçu à badges + exemples + application). Doc
ODOO_WEBHOOK.md : contexte DC (pivot des dépenses) + mode d'emploi. 200 fonctions déployées.

**Appris.** Le DC est le pivot de TOUT le coût projet côté Odoo — consigné dans l'ADR : si les
décaissements/charges remontent un jour, leur clé de rattachement naturelle sera le DC via ce même overlay.

**Vérifs.** Functions 1346/1346 (dcMapImport 4), web 301/301, tsc/eslint 0, no-undef (165),
deploy-targets (200/200), bundle 121,1 ≤ 122 Ko.

---

## 2026-07-21 — Blindage du delta du jour (audit adverse conformiste + gardien)

**Fait.** Audit adverse des 4 lots du jour (Centre de correction, IA fournisseurs, design Contrats,
seed FP–DC) par deux agents. Conformiste : CONFORME — un seul écart (libellé DangerBtn « annuler » →
« Annuler », ×2 dans cleanup.tsx), corrigé. Gardien : suites vertes et périmètre additif tenu, mais
3 constats DOUTEUX, tous levés : (1) `fiscalYearFromOrders` (currentFy) calculait max(yearPo) sur le
champ BRUT alors que le carnet dérive désormais le millésime du FP → même règle appliquée
(`plausibleYear(yearPo) || année du FP`, les deux appelants lisent aussi `fp`) + tests ; (2) le push
ClickUp unitaire « par FP seul » complétait la tâche depuis `orders/{id}` BRUT (ni fiche, ni override,
ni alias) → complète désormais depuis la ligne FUSIONNÉE du carnet (même source que le push en masse,
repli doc brut si hors carnet) ; (3) `planDcMapImport` devinait le DC sur une ligne à 3+ colonnes
(première cellule non-FP) → toute ligne à plusieurs cellules non-FP est écartée « ambigu » + test.

**Assumé (effet de bord documenté, pas un bug).** Le yearPo dérivé du FP (ADR-064) élargit les
assiettes des alertes « pré-PO » et « dormantes » : des commandes jusque-là sans millésime y entrent
au prochain recompute — les compteurs bougeront, de façon COHÉRENTE partout (backend et miroir front
partagent la fusion).

**Appris.** Quand une règle de dérivation entre dans `mergeCommandes`, chercher AUSSI les agrégats qui
lisent les collections brutes sans passer par la fusion (currentFy, push unitaire) : c'est là que
l'invariant « même métrique = même nombre » casse en silence.

---

## 2026-07-21 — BC/DC × Rentabilité : engagé (Σ BC), rattachement DC persistant, DC à l'import (ADR-067)

**Fait.** Suite de l'audit « prise en compte des DC et BC liés dans la rentabilité » (3 lots validés par
« go ») : (A) nouvelle grandeur ENGAGÉ = `bcCostByFp` (Σ BC réels par fpKey, tous statuts, fiche exclue)
affichée en FP 360° (réconciliation amont planifié/engagé/réel/écart + entête Lignes BC) et alerte
`achat_bc_sup_planifie` (high, margin) quand engagé > costTotal connu ; (B) le fp résolu par DC est
désormais PERSISTÉ sur les docs bcLines — resolveBcDc à l'import (delta + trigger, même règle que le
webhook), backfill au seed (importDcAliases, borné 20 000) et au rapprochement manuel (setDcAlias,
ciblé par DC), jamais d'écrasement, résolution mémoire du recompute conservée en filet ; (C) le parseur
Logistics capte la colonne « DC » additivement, colonne DC affichée dans Lignes BC du FP 360°.

**Appris.** La rentabilité ne consommait AUCUN BC (coût = planifié fiche/P&L puis réel factures) : le
stade « engagé » manquait alors que la donnée était déjà à l'écran, listée sans être sommée. Et toute
résolution d'overlay « en mémoire au recompute » doit se demander : les vues front qui lisent le champ
brut verront-elles la même chose ? Sinon, backfill persistant.

**Vérifs.** Functions 1353/1353 (alertsBcEngage 2, bcCostByFp 3, logistics DC 1), web 301/301, tsc/eslint 0,
no-undef (165), deploy-targets (200/200), bundle 121,1 ≤ 122 Ko. Miroir front `engage` = assiette exacte de bcCostByFp.

---

## 2026-07-21 — Audit adverse post-fusion ADR-067 : 3 écarts conformiste + 3 bloquants gardien, tous levés

**Fait.** Conformiste (NON CONFORME → corrigé) : backfill setDcAlias en batchs de 400 (un batch unique
plafonnait à 500 écritures Firestore), resolveBcDc/backfillBcFpFromDc testés dans apply.test.js (mock
maison, modèle resolveLogisticsFx), vérifs du journal chiffrées. Gardien (ROUGE → corrigé) :
(B1) le fp résolu par DC entrait dans la garde anti-orphelins d'applyWrites — un fichier delta d'UNE
ligne logistics à DC connu balayait les autres BC de l'affaire → resolveBcDc devient POST-applyWrites
et pose le fp sur les DOCS, jamais dans les écritures (test de non-régression du sweep) ;
(B2) le Kpi « Engagé » front comptait les doublons d'amorçage ClickUp que le recompute évince →
éviction miroir par bcCompareKey (miroir ajouté à web/src/lib/ids.ts, testé) + Number() sur les
montants ; (B3) le parseur Logistics écrivait fp: null → écrasait au ré-import un fp backfillé/corrigé
→ champ fp ABSENT quand la colonne est vide (comme dc/amountXof), et resolveBcDc branché sur la
ré-ingestion (reingest). Douteux levés : borne du backfill signalée (backfillTruncated, toast + audit).

**Assumé (à l'arbitrage de la direction si contesté).** Les BC « Annulé » comptent dans l'engagé : le
parseur les mappe déjà en a_emettre et le SOA les compte déjà en engagement — même règle partout (la
règle de l'ERP prime) ; les extraire créerait une deuxième vérité. Idem la limite fpAliases du FP 360°
(requête sur le fp brut) : pré-existante et commune aux Factures/Opportunités du même écran, documentée
dans le code.

**Appris.** Toute donnée dérivée injectée dans les ÉCRITURES avant applyWrites entre dans la garde
anti-orphelins — les enrichissements de rattachement se posent sur les docs APRÈS l'apply. Et un
parseur ne doit jamais écrire null là où « absent » préserve une correction au merge.

---

## 2026-07-21 — BC « Annulé » : statut propre hors engagements, charge planifiée conservée au P&L (ADR-068)

**Fait.** Règle métier posée par la direction : un BC annulé sort des engagements, le montant reste
attaché au P&L en attendant le BC de remplacement. Découverte clé : `annule` existait DÉJÀ côté ClickUp
(mapBcStatus de lib/clickupBc) — le lot GÉNÉRALISE un statut de facto au lieu d'en inventer un.
Reconnu de bout en bout : parseur Logistics (« Annulé » → annule, plus a_emettre), webhook Odoo
(accepté, mapping `cancel` documenté), BC_STAGES back+front (saisie manuelle/masse, libellé « Annulé »).
Sémantique unique : hors engagement SOA ET hors netting (l'achat retombe en prévisionnel `open` —
exactement « en attendant le BC de remplacement »), hors décaissements, hors bc_en_attente/bc_en_retard,
hors relances/bulletins, hors engagé rentabilité (bcCostByFp + miroir FP 360°). Le P&L n'est pas touché
(costTotal/fiche = objet distinct). Le « bouton supprimer la charge » (retrait total y compris P&L)
attend l'arbitrage sur l'objet porteur (ligne de fiche vs achats P&L) — lot dédié, overlay non destructif.

**Appris.** Avant d'inventer un statut, chercher s'il existe déjà dans UN canal : la règle de l'ERP
était là (ClickUp), il suffisait de l'étendre aux autres sources.

**Vérifs.** Functions 1365/1365 (SOA annulé 2, engagé annulé 1, alertes annulé 2, cash annulé 1,
relances témoin, mapBcStatus), web 303/303, tsc/eslint 0, no-undef (165), deploy-targets (200/200),
bundle 121,1 ≤ 122 Ko.

---

## 2026-07-21 — « Supprimer la charge » : retrait total y compris du P&L, overlay rétablissable (ADR-069)

**Fait.** Arbitrages de la direction posés par questionnaire (objet = ligne de coût de la fiche ; un
seul geste qui annule aussi le BC lié ; boutons aux trois emplacements). Livré : genre « charges »
ajouté au callable existant setCancellation (overlay config/cancelCharges, droit bc, aucune fonction
déployée nouvelle), règle PURE domain/charges.applyChargeDrops au recompute (ligne exclue + costTotal ↓,
marge ↑, %MB recalculé, plancher 0), boutons « Supprimer la charge »/« Rétablir » en FP 360°,
Exécution BC (annule aussi le BC, et inversement) et P&L Projet (liste des charges planifiées par
affaire), règle firestore.rules de lecture de l'overlay.

**Appris.** L'infrastructure d'annulation (CANCELLABLE + overlay + transaction + audit) s'étend à un
nouvel objet en une ligne de spec — le patron « overlay non destructif » continue de payer.

---

## 2026-07-21 — P&L Projet : charges planifiées en Table + fix modale Montant (CA Signé)

**Fait.** Retour utilisateur sur capture d'écran (×2). (1) Design : le bloc « Charges planifiées
(fiche) » du P&L Projet (pile de lignes libres + gros bouton rouge répété) refait avec la primitive
Table — colonnes Fournisseur/Type/XOF alignées, montants à droite, entête « · N · Σ », action
compacte « Supprimer » (prop `label` ajoutée à ChargeDropBtn, défaut inchangé ailleurs) — même
facture visuelle que « Coût par type » à côté. (2) Modale « Montant (CA Signé) » : le libellé du
bouton Commande → Opportunité affichait « pose [object Object] » — money() (JSX) interpolé dans un
template literal ; recomposé en JSX (même idiome que le bouton voisin). Ajout d'un « Réessayer »
sur l'échec de lecture du montant de l'opp (peek), utile si l'« internal » observé était transitoire.

**Appris.** Rechute du piège money()-dans-template-literal DANS LE MÊME COMPOSANT que le correctif
de l'audit 40 axes (axe 37, lignes voisines) — commentaire de garde posé au site même cette fois.
L'« internal » du peek de syncOrderAmount n'est PAS reproductible en local : branche saine (portées
MAX_SCAN/sliceCapped OK, requireRead/HttpsError corrects), non modifiée par les lots récents ;
guarded() trace le message réel dans opsLog → à lire en prod si l'erreur persiste après réessai
(capture prise 9 min après la fin d'un déploiement).

**Vérifs.** Web 303/303, tsc/eslint 0, bundle 121,1 ≤ 122 Ko (aucun changement functions).

---

## 2026-07-22 — Remédiation de l'audit du module Admin (17 constats vérifiés, ADR-070)

**Fait.** Audit de fond du module Admin (workflow 50 agents, chasse × 6 dimensions + double vérif adverse par
constat) : 22 chassés → 17 confirmés / 5 réfutés (14 utilisateur, 3 technique). Dimension « RBAC & sécurité
serveur » à ZÉRO (callables tous gardés). Après dédoublonnage : 12 constats distincts, tous traités en une
PR (une seule, plus économe qu'un double cycle CI/déploiement).

Correctifs (backend) : parité `correctionQueue` — `applyChargeDrops` (ADR-069) appliqué comme au recompute
(+ `source` au select bcLines) ; `deleteRecords` — troncature 1000 SIGNALÉE (`requested`/`truncated`) et
client découpé en lots ; `correctionQueue` retourne `scoped` (cadrage OWD privé).
Correctifs (front) : `[object Object]` sur « Solder le RAF » (fmtFull) ; erreurs de lecture distinctes de
l'état vide (listApiKeys, odooWebhookStatus, peek Montant) + « Réessayer » ; bascule MFA — busy + toast réel
+ confirmation anti-verrouillage ; anti-flash (QualityHero, Référentiels, dédup capped) ; troncature des
abonnements du Centre signalée ; `money()` local ClickUp → `fmt` ; retrait emojis (🎉/🧠/💡/🗺️/⚡) ; bandeau
« périmètre » expliquant l'écart hero↔Centre sous OWD privé.

**Appris.** Rechute du piège `money()`-dans-template-literal (encore, sur « Solder le RAF ») : c'est un
anti-pattern récurrent — un lint dédié (interdire `money(` dans un backtick) le tuerait à la source, à
envisager. La vérif adverse a bien fait son travail : 5 réfutés dont 2 « recompute différé inerte » (faux —
`requestRecompute` a un repli SYNCHRONE) qui auraient été de faux correctifs coûteux.

**Vérifs.** Functions 1367/1367 (no-undef 166, deploy-targets 200/200 — aucune fonction nouvelle), web 303/303,
tsc/eslint 0, bundle 121,2 ≤ 122 Ko.

**À noter (non fait ici).** La parité `correctionQueue`↔recompute sur les charges supprimées n'est pas
couverte par un test unitaire (nécessiterait l'émulateur Firestore ; la règle PURE `applyChargeDrops` l'est,
elle, dans charges.test.js). Le garde-fou serveur MFA « refuser l'activation tant qu'aucun compte direction
n'a de second facteur » n'est pas implémenté (nécessiterait une lecture des facteurs inscrits) : mitigé par
la confirmation d'avertissement côté front.

---

## 2026-07-22 — Audit métier des cockpits (Vue d'ensemble / CODIR / commercial) — 8 correctifs (ADR-071)

**Fait.** Audit métier lean (4 chasseurs : overview, CODIR, commercial, cohérence inter-écrans ; vérif adverse
1 sceptique sur haute/bloquant seulement — 8 agents, ~830 k tokens, ~6× moins cher que l'audit Admin). 9 constats
confirmés, 0 réfuté ; 8 distincts après dédoublonnage (le bloquant trouvé 2×). Tous corrigés en une PR.

BLOQUANT : le Bilan CODIR ne fusionnait pas les objectifs isolés (atterrissageObjectifs_) → objectifCaf=0,
jauges 0 %, faux « objectif dépassé », export PPTX « Atteinte 0 % », en contradiction avec la Vue d'ensemble.
Correctif : fusion extraite en SOURCE UNIQUE (lib/atterrissage) + test de parité. Hautes : filtre PM ignoré en
silence sous bandeau « recalculée » (garde de périmètre honnête) ; OppList ne dédupliquait pas les opps live par
fpKey (dédup extraite en lib/liveOpps, partagée avec overviewCalc → OppList) → sur-compte du pondéré. Moyennes :
prévision « Tout » (quota d'un exercice ÷ réalisé pluriannuel → attainment masqué) ; couverture RAF (numérateur
aligné sur att.pipelinePondere, toujours écrit) ; labels PPTX fidèles à l'écran. Basse : filet de parité aged-lost
corrigé (fixture sans ageDays → règle d'âge jamais exercée).

**Appris.** Les 3 bugs de cohérence avaient la MÊME cause : une logique « source unique » copiée-collée dont UNE
copie divergeait (ou manquait). Extraire (mergeAtterrissageObjectifs, dedupeMaskLiveOpps) + tester tue la classe
entière, pas juste l'instance. L'audit calibré serré (1 sceptique, haute/bloquant) a rendu 0 faux positif pour
6× moins cher — le bon défaut pour les prochains audits.

**Vérifs.** Functions 1367/1367 (no-undef 166, deploy-targets 200/200 — aucune fonction nouvelle), web 306/306
(+3 tests parité atterrissage ; overviewCalc.test toujours vert après refactor), tsc/eslint 0, bundle 121,3 ≤ 122 Ko.

---

## 2026-07-22 — Justesse des taux de conversion (audit commercial DC/DG) — Lot A (ADR-072)

**Fait.** Audit du cockpit commercial en posture Directeur commercial / DG, centré sur la question « nos taux
reflètent-ils les 15-25 % du secteur ? ». Réponse : non, pour DEUX raisons longtemps confondues sous le mot
« conversion ». (1) Le KPI « Conversion vente » de tête n'est pas un win rate mais un ratio PROJETÉ
(`cmd / (cmd + pondéré + perdu)`) qui met le pipeline escompté au dénominateur → sort au-dessus de la fourchette
par construction (pas un bug, un libellé trompeur). (2) Le vrai taux de gain comptait perdu = étape 7 SEULE : les
annulés (9) et les auto-périmées par âge (isAgedLost) échappaient au dénominateur → win rate optimiste.

Correctifs (Lot A). Prédicat de clôture UNIQUE : `oppLifecycle.isWonOpp` (6) / `isLostOpp` (7 OU 9 OU isAgedLost),
appliqué à pipeline.js, am360.js, velocity.js (qui recalculaient stage===6/7 à la main). Miroir front identique
dans lib/winLoss.ts. KPI de tête relibellé « Conversion (projetée) » avec sous-titre explicite (Vue d'ensemble +
Pipeline ×2) — on ne remplace pas la formule projetée (elle sert la capacité d'atterrissage), on cesse de la faire
passer pour un win rate ; le vrai win rate X/Y annoté à côté. TruncationNote en tête de la vue « analyses »
(un taux sur échantillon tronqué le dit). Sous-titres couverture rendus conditionnels au décalage de période.

**Appris.** Deux nombres appelés « conversion » n'étaient pas la même métrique — l'un mesure la CAPACITÉ (pipeline
au dénominateur), l'autre la PERFORMANCE de closing. Le vrai correctif n'était pas de « baisser le taux » mais de
NOMMER honnêtement chacun et d'unifier la définition du perdu. Sur l'exemple d'audit (6 gagnés / 4 perdus /
8 annulés / 5 périmées) : 60 % (faux) → 26 % (juste, comparable secteur). Un win rate durablement < 15 % signalerait
un défaut de qualification amont — ce que l'ancienne formule masquait.

**Report assumé (Lot A2, à arbitrer).** Funnel par étape + taux de gain EN VALEUR (won€/(won€+lost€)) non traités.

**Vérifs.** Functions 1371/1371 (no-undef 166, deploy-targets 200/200 — aucune fonction nouvelle),
web 308/308 (+2 winLoss annulé/aged-lost, +4 oppLifecycle isWonOpp/isLostOpp), tsc/eslint 0, bundle 121,3 ≤ 122 Ko.

---

## 2026-07-22 — Taux de gain EN VALEUR (Lot A2, ADR-073)

**Fait.** Prolongement du Lot A : ajout du taux de gain **en valeur** (`winRateValue = montant gagné /
(gagné + perdu)`) à côté du taux **en nombre**, sur la MÊME population clôturée (isWonOpp/isLostOpp,
ADR-072). Backend `domain/velocity.js` (+ `wonAmt`/`lostAmt` bruts) et front `lib/winLoss.WinLossRow`
— les montants étaient déjà collectés, ils n'étaient pas exposés en ratio. Surfacé : KPI « Taux de gain
(valeur) » dans la barre de vélocité, colonne repliable « Taux (valeur) » dans les tables win/loss par
origine de lead et par BU, infobulles expliquant l'écart. Type `SalesVelocity` (writes.ts) étendu.

**Décision de périmètre.** Le funnel par étape (oppFunnel/stageConversion) n'est PAS touché : il mesure
des transitions OBSERVÉES (population et sémantique distinctes — un →9 annulé n'y est ni gain ni perte).
Y injecter isLostOpp mélangerait deux métriques. C'était le second volet envisagé d'A2 ; il s'avère déjà
présent et correct sous une autre définition — rien à faire.

**Appris.** Un taux en nombre seul ment par omission : gagner 8 petites affaires et perdre 2 grosses = 80 %
en nombre mais minoritaire en chiffre. Le taux en valeur, côte à côte, répond « gagne-t-on les affaires qui
comptent ? ». Le garder sur la même population clôturée évite qu'un écart entre les deux vienne d'autre chose
que de la taille des deals.

**Vérifs.** Functions 1372/1372 (no-undef 166, deploy-targets 200/200 — aucune fonction nouvelle),
web 309/309 (+1 winLoss valeur, +1 velocity valeur), tsc/eslint 0, bundle 121,3 ≤ 122 Ko.

---

## 2026-07-22 — Surfacturation surfacée sur l'écran Factures (réutilise l'existant)

**Fait.** Demande « implémenter détection et correction des surfacturations ». Recherche préalable :
la fonctionnalité EXISTE déjà de bout en bout — détection `domain/dataQuality.js` (constat « surfacturation »
high, Σfactures > CAS × (1+seuil)) + `domain/alerts.js` (alerte high), seuil `surfacturationPct` (défaut 0,5 %)
éditable en Admin, correction chiffrée `domain/remediation.js` (« vérifier une facture en trop, ou relever le
CAS ») exposée au Centre de correction (`cleanup.tsx`, module `cleanup`). Règle « ne recrée pas ce qui existe » →
RIEN recréé. Seul manque réel : ce n'était pas visible sur l'écran Revenu › Factures où l'utilisateur se trouvait.

Correctif (additif, front seul) : tuile « Affaires surfacturées » (compte lu de `summaries/dataQuality`, MÊME
prédicat que le Centre de correction) à côté de « Factures non rattachées », avec rebond `go("cleanup")` vers la
correction chiffrée. RBAC : rôle sans module Qualité → lit `null` → tuile masquée. Tuile `.card` autonome (pas de
`<Kpi>` imbriqué → pas de double cadre).

**Appris.** Le réflexe « chercher avant de créer » a évité de rebâtir un moteur de détection/correction déjà
présent et testé — ce qui aurait créé une 2ᵉ vérité (deux comptes de surfacturées divergents). Le vrai besoin
n'était pas d'implémenter, mais de RENDRE VISIBLE là où le pilote regarde. NB : le RAF dérivé est plancher à 0
(`max(cas−facturé,0)`) — la surfacturation n'est donc PAS captée par un RAF négatif mais par le prédicat dédié.

**Vérifs.** web tsc/eslint 0, tests modules 15/15, bundle 121,3 ≤ 122 Ko. Aucun backend touché.

---

## 2026-07-22 — Cockpit DC/DG : marge attendue du pipe + concentration client (Lot B, ADR-074)

**Fait.** Reprise du Lot B (6 vues DC/DG). Cartographie préalable des agrégats (agent auditeur) : la MOITIÉ
existait déjà — atterrissage CAS/CAF (overview), pipe par BU (« Pondéré par BU »), CAS par domaine + concentration
top-5 (operations). Rien recréé. Deux vrais manques bâtis sur le cockpit commercial :
- **Marge attendue du pipe** : `lib/pipeMargin.pipeExpectedMargin` PUR (testé, 4 cas) — Σ pondéré × mbPrev %,
  taux moyen pondéré, ventilation BU. mbPrev absent → 0 % (aucune marge inventée). Carte dans la vue analyses.
- **Concentration du pipe par client** : pondéré par clientKey + part top 5 (risque portefeuille), calculé front
  sur l'assiette pipeline, miroir du patron lostByCompetitor/winLoss.

**Report MOTIVÉ (documenté, pas contourné).** Couverture base client : AUCUNE collection maître de clients
(univers dérivé des agrégats) → pas de dénominateur, exige une nouvelle source (ADR + décision). Win-rate
concurrentiel : `competitor` saisi UNIQUEMENT sur les perdues (étape 7) → won structurellement 0 ; exigerait de
saisir le concurrent sur les gagnées (changement de modèle). Les deux sont des décisions métier, pas de l'additif.

**Appris.** « Chercher avant de créer » a divisé le Lot B par deux : 3 des 6 vues existaient déjà sous un autre
écran. Le vrai travail était (a) identifier les 2 manques nets et (b) NOMMER les 2 blocages de modèle de données
plutôt que d'inventer une base client ou un win-rate concurrentiel faux.

**Vérifs.** web 313/313 (+4 pipeMargin), tsc/eslint 0, bundle 121,3 ≤ 122 Ko. Aucun backend touché.

---

## 2026-07-22 — Base client de référence persistante + taux de couverture (B4, ADR-075)

**Fait.** Déblocage de B4 (couverture base client), reporté en ADR-074 faute de dénominateur. Décision Direction :
matérialiser la NORMALISATION existante (canonicalKey + config/clientAliases) en base de référence persistante,
qu'Odoo alimentera ensuite.
- `config/clientsRef` : overlay ADDITIF (union au recompute des clients canoniques vus ; jamais de retrait →
  dénominateur stable, un churné y reste). Odoo écrira dans le même doc en Phase 2.
- `domain/clientCoverage` (PUR, testé, 4 cas) : couverture = clients avec commande / base ; ventile actifs /
  prospects (vus sans commande) / inactifs (base sans activité courante). Écrit sur clients_all (global), gaté « clients ».
- Front : bloc « Couverture base client » dans la Base Clients (operations.tsx), lu de clients_all même sous période
  sélectionnée (métrique globale). Libellé honnête sur la provenance.

**Appris.** Le blocage d'ADR-074 n'était pas « pas de données » mais « pas de dénominateur PERSISTANT ». La
normalisation fournissait déjà l'identité ; il manquait de la FIGER en base additive. Une fois la base persistante,
la couverture se calcule aujourd'hui et s'étend sans code quand Odoo poussera les clients (le dénominateur grandit,
les nouveaux sans activité tombent en « inactifs »).

**Vérifs.** Functions 1376/1376 (+4 clientCoverage ; no-undef 167, deploy-targets 200 — aucune fonction nouvelle,
index Firestore valides), web 313/313, tsc/eslint 0, bundle 121,3 ≤ 122 Ko.

---

## 2026-07-22 — B4 Phase 2 : le webhook Odoo alimente la base client de référence (ADR-076)

**Fait.** Sur demande (« Phase 2 à faire en webhook entrant déjà existant »), ajout de l'objet
`object: "partner"` au webhook `odooWebhook` : un client créé côté Odoo ajoute sa clé CANONIQUE (canonicalKey +
alias, mêmes règles que le recompute) à `config/clientsRef.keys` via `arrayUnion` (additif, jamais de retrait,
idempotent). Collecté sur le lot, écrit une fois, tracé (auditLog `odoo_partner`). Le recompute différé déjà
déclenché (`if (wrote)`) rafraîchit le count et le taux de couverture. Doc `docs/ODOO_WEBHOOK.md` mise à jour.

**Appris.** Réutiliser le webhook existant (signature HMAC, coalescing recompute, plafond de lot) plutôt qu'une
nouvelle fonction = zéro surface de déploiement, zéro règle, zéro secret nouveau. La base client devient l'univers
Odoo complet → le taux de couverture passe de « actifs / clients déjà vus » à « actifs / base réelle » (pénétration).

**Vérifs.** Functions 1376/1376 (no-undef 167, deploy-targets 200 — aucune fonction nouvelle), index.js
`node --check` OK. Aucun changement front, aucune règle.

---

## 2026-07-22 — Remédiation de l'audit de session (ADR-077 : aged-lost exclu partout + course clientsRef + parité actifs)

**Fait.** Audit adverse des 6 PR fusionnées de la session (3 agents). Trois défauts réels — dans MON propre
travail des dernières heures — corrigés, arbitrage utilisateur « Exclure partout » :
- **BLOQUANT — course `config/clientsRef`.** Le recompute réécrivait `keys` en tableau complet
  (`keys: [...refSet].sort()`), en course avec l'`arrayUnion` du webhook Odoo (ADR-076) → clés partenaires
  perdues. Réécrit en `keys: FieldValue.arrayUnion(...seen)` : additif, atomique, commutatif. `logger.warn` au-delà
  de 15 000 clés (limite doc Firestore 1 MiB).
- **HAUTE — win-rate à trois valeurs.** `isAgedLost` compté « perdu » par `isLostOpp` (cockpit) mais
  `salesVelocity` filtrait `stale !== true` seul et `scoreOpportunities` prenait `stage===6||7||isAgedLost` → trois
  populations, trois taux. Régime unique : aged-lost **exclu partout** (`!isAgedLost(o)` sur les deux callables),
  win-rate via la paire unique `isWonOpp`/`isLostOpp`. `scoreOpportunities` gagne le stade 9 (perdu) au passage.
- **MOYENNE — parité actifs.** CAS agrégé par client (`casByClient`) avant de dériver « actifs » (CAS > 0), au
  lieu d'un comptage par commande qui gonflait le décompte.
- **F7 (BASSE) — libellé marge pipe.** Sous-titre honnête : « opp sans MB prév. comptée à 0 % ».
- **finance.tsx** : lecture `summaries/dataQuality` pré-gatée sur le module `overview` (évite un `onSnapshot` refusé
  pour un lecteur sans droit) + commentaire corrigé.

**Appris.** Deux producteurs concurrents sur un même champ Firestore ⇒ jamais de write du tableau complet, toujours
`arrayUnion`. Et une métrique définie par un prédicat PUR (`isLostOpp`) n'est cohérente que si TOUS ses points de
calcul passent par ce prédicat — un callable qui refait le filtre « à la main » recrée une vérité divergente. L'audit
de son propre travail récent est le meilleur rapport qualité/prix : les défauts sont frais, le contexte intact.

**Vérifs.** Functions 1376/1376 (no-undef 167, deploy-targets 200 — aucune fonction nouvelle), `node --check`
index.js OK. Web 313/313, tsc/eslint 0, build + bundle 121,3 ≤ 122 Ko.

---

## 2026-07-22 — Écran Factures : recherche serveur (N°/FP) + montant HT éditable

**Fait.** Deux manques signalés sur l'écran Factures :
- **Recherche « 0 résultat » sur une facture existante.** La liste s'abonne à `invoices` bornée à
  `DEFAULT_SUB_CAP` (2000) et NON ordonnée ; la recherche de `<ListView>` ne filtre que les lignes
  chargées → une facture au-delà du plafond (recherche par N° « JV/2026/07/0007 » ou par FP) restait
  introuvable. Nouveau callable **`searchInvoices({q})`** (requireRead `facturation`, comme la collection) :
  préfixe sur `numero` (range, variante MAJUSCULES si saisie en minuscules) + égalité sur le FP canonique
  (`fpKey`, rapproche toutes les factures d'une affaire). Plafond 300, champs mono-indexés (aucun index
  composite). Front : barre « Chercher dans toute la base » distincte de la recherche cliente ; les
  résultats serveur remplacent la liste (bandeau honnête : filtres/segmentation non appliqués, plafond signalé).
- **Montant non éditable.** `patchInvoice` n'acceptait que date/échéance. Ajout de `amountHt` (garde nombre
  ≥ 0) dans le callable ET dans le correcteur inline `InvoiceDateFixer`. Le montant reste piloté par la
  source (une correction est réécrite au prochain import delta, EXACTEMENT comme la date — même convention,
  pas d'overlay). auditLog : montant en DRAPEAU (`amountChanged`), pas la valeur (l'auditLog se lit au droit
  « habilitations » ⊉ « facturation » — cf. précédent marge/patchProjectSheet). `amountHt` pilote CAF = Σ
  factures → `requestRecompute` réaligne CAF/surfacturation/cash.

**Appris.** Un abonnement temps réel borné est une base de RECHERCHE partielle, jamais complète : dès qu'une
recherche doit porter sur toute la base, elle passe par un callable serveur, pas par un filtre client sur les
lignes chargées. Et une nouvelle donnée éditable de facturation (le montant) suit la convention EXISTANTE de
`patchInvoice` (écriture directe réécrite au ré-import, drapeau d'audit) plutôt que d'inventer un overlay —
règle « l'ERP gagne ».

**Vérifs.** Functions 1376/1376 (`node --check` OK ; no-undef 167 ; deploy-targets 201 — +searchInvoices ;
indexes 3 composites valides). Web 313/313, tsc/eslint 0, build + bundle 121,3 ≤ 122 Ko.

---

## 2026-07-22 — Centre de correction : refonte premium des blocs d'anomalies en tableaux (Lot 1/5)

**Fait.** Les listes d'anomalies du Centre de correction (`cleanup.tsx`) étaient rendues en `flex-wrap` :
chaque ligne un empilement horizontal indépendant → colonnes non alignées (« zig-zag »). Refonte : chaque
bloc d'anomalies passe en **`Table`** (primitive maison) — colonnes ALIGNÉES (Réf, Client, Montant + colonnes
d'action Correction/Actions/IA en ligne), contexte (Affaire, Étape, AM, Date, Source), Recommandation chiffrée
et Proposition IA repliés dans le **détail dépliable**. Recherche/tri/pagination/filtres hérités de `Table`.
Extraction de `FixControl` (éditeur inline par type) et `RowActions` (modifier/requalifier/annuler/ouvrir,
modale remontée au bloc) depuis l'ancien `ItemFix` monolithique ; `AiInline`/`AiDetail`/`RecInline` compacts.
La liste « Réconciliations proposées » du Dossier client passe aussi en `Table`. Zéro changement de logique
ni de callable — refonte d'affichage pure.

**Appris.** La primitive `Table` (split auto primaire/détail, colonnes d'action toujours en ligne, `colId`
indexé donc plusieurs colonnes à entête vide cohabitent) est l'outil exact pour tuer le zig-zag : elle garantit
l'alignement sans grille CSS manuelle. Remonter l'état d'édition (modale) au bloc évite N modales pour N lignes.

**Vérifs.** Web 313/313, tsc/eslint 0, build + bundle 121,3 ≤ 122 Ko. (Suite : Lots 2-5 = enrichissements IA.)

---

## 2026-07-22 — Centre de correction : IA globale (tout analyser + tout appliquer) (Lot 2/5)

**Fait.** L'assistant IA était bloc par bloc (un bouton « IA » par type d'anomalie). Ajout d'une IA à
l'échelle de TOUTE la base : l'état des propositions (`suggByType`/`aiInfoByType`) est REMONTÉ du bloc au
`CorrectionCenter` (chaque bloc reçoit sa tranche via un setter par type, style dispatch). Deux commandes
globales : **« Analyser tout à l'IA »** (boucle sur chaque bloc éligible — hors nav/dedupe, dans les droits —
appelle `aiSuggestCorrections` + vérification adverse, alimente tous les blocs, toast récapitulatif) et
**« Appliquer toutes les vérifiées (N) »** (applique en un clic toutes les propositions fiables/vérifiées à
travers tous les blocs, un seul recalcul final). Prédicat d'éligibilité `aiBulkEligible` PARTAGÉ entre le lot
d'un bloc et l'application globale (cohérence stricte). Zéro backend nouveau — réutilise le callable existant ;
chaque écriture reste GOUVERNÉE (mêmes droits/audit/recalcul, l'IA propose, l'humain déclenche).

**Appris.** Remonter l'état IA au centre (au lieu de le dupliquer) est ce qui rend l'action « toute la base »
possible sans casser le bloc par bloc : le même `suggByType[type]` sert les deux. Un prédicat d'éligibilité
unique évite qu'« appliquer le bloc » et « appliquer tout » divergent.

**Vérifs.** Web 313/313, tsc/eslint 0, build + bundle 121,3 ≤ 122 Ko.

---

## 2026-07-22 — Centre de correction : nouvelles actions IA auto-applicables (décisions, pas d'invention) (Lot 3/5, ADR-078)

**Fait.** Extension de l'assistant IA à deux nouvelles actions AUTO-applicables — mais uniquement des DÉCISIONS /
valeurs déterministes, jamais une valeur devinée (garde-fou « n'invente aucune donnée » intact) :
- **Requalification opp fantôme/âgée** (`opps_fantomes`, `opps_agees`) → `patch_opportunity` avec `stage` borné
  à 7 (perdu) ou 9 (annulé) uniquement (`sanitizeField("stage")` rejette tout autre). Cap `pipeline`.
- **Solder un RAF ClickUp-clôturé** (`clickup_cloture_avec_raf`) → action `settle_raf` sans champ (RAF = 0
  déterministe ; fieldless ⇒ ne retombe pas en « review »).
Front : `applyAiSuggestion` gère stage + settle_raf ; type `AiCorrectionAction` élargi ; le gate IA passe de
« kind ≠ nav » à « kind ≠ dedupe » (l'IA couvre désormais aussi les blocs nav qui portent une action). Tests
domain ajoutés (stage 7/9 ok, stage 6 rejeté ; settle_raf fieldless reste actionnable). Montant/date/FP restent
non auto-applicables.

**Appris.** La frontière utile n'est pas « champ monétaire ou non » mais « valeur INVENTÉE vs DÉCISION/valeur
déterministe » : requalifier en perdu ou solder à 0 sont des décisions imposées par l'anomalie, pas des devinettes.

**Vérifs.** Functions 1378/1378 (+2), no-undef 167, node --check OK. Web 313/313, tsc/eslint 0, bundle 121,3 ≤ 122 Ko.

---

## 2026-07-22 — ClickUp : DC obligatoire pour l'éligibilité de synchro (Lot 6, ADR-079)

**Fait.** Sur demande (« exiger un DC lié au FP pour la synchro ClickUp ; sans DC, non éligible »), une commande
n'est synchronisable vers ClickUp que si un DC (identifiant du BC Odoo) est lié à son N° FP. Helper
`loadFpsWithDc()` (overlay `config/dcAliases` + bcLines portant un `dc`). Enforcement : `pushOrderToClickup`
rejette (failed-precondition), `pushAllOrdersToClickup` saute (`skippedNoDc`). Diagnostic : `clickupHealth`
(domaine pur) reçoit un prédicat `hasDc(fp)` → `unlinkedEligible`/`unlinkedNoDc` + `hasDc` par ligne. Cockpit :
colonne « DC lié », bouton « DC requis » (renvoi Assainissement) pour les non éligibles, « tout créer » ne
compte que les éligibles, note du nombre non éligible. Réversible : `config/clickup.requireDc === false`.

**Appris.** Le DC vit sur les **bcLines** (pas les commandes) : « FP a un DC » = union dcAliases (DC→FP) +
bcLines.dc. Garder le prédicat `hasDc` INJECTÉ dans le domaine pur (défaut `()=>true`) préserve la
rétro-compatibilité des tests et isole l'I/O.

**Vérifs.** Functions 1380/1380 (+2 clickupHealth), no-undef 167, deploy-targets 201, node --check OK. Web
313/313, tsc/eslint 0, bundle 121,3 ≤ 122 Ko.

---

## 2026-07-22 — Centre de correction : normalisation clients assistée IA (Lot 4/5)

**Fait.** Dans les outils de rapprochement du point unique (Assainissement), nouveau bloc « Normalisation
clients (IA) » qui **surface** les mêmes fusions de graphies clients que l'atelier Référentiels →
« Normalisation clients » : mêmes callables (`aiSuggestClientMerges` juge « même entité » ; `setClientAliases`
pose l'alias) et **même source unique** `config/clientAliases`. Flux compact « proposer → cocher → appliquer » :
fusions ≥ 90 % pré-cochées, application ADDITIVE (alias existants conservés hors graphies re-posées), renvoi
« Atelier complet → » vers l'écran clientnorm. Réservé à la direction (gate `useCan("habilitations")==="write"`,
comme la table d'alias de l'atelier). Zéro backend nouveau ; primitives réutilisées (`CorrSection`, `Table`,
`Busy`, `Badge`, `Tip`, `useNav`).

**Appris.** « Ne recrée pas ce qui existe » : l'atelier possède déjà l'IA de fusion + l'inventaire + la table
éditable. Le Lot 4 n'en **duplique pas la logique** — il en réexpose l'entrée là où le correcteur travaille
(un nom divergent est souvent la CAUSE d'un dossier client à rapprocher), en écrivant dans la **même** config.
La source unique reste `config/clientAliases` : les deux écrans y posent des alias à l'identique.

**Vérifs.** Web 313/313, tsc/eslint 0, build OK, bundle 121,4 ≤ 122 Ko. Aucun changement backend, aucune règle.

---

## 2026-07-22 — Centre de correction : synthèse IA « par où commencer » (Lot 5/5, ADR-080)

**Fait.** Dernier des 5 lots d'enrichissement du Centre de correction. Nouveau callable
`aiRemediationSummary` (secret ANTHROPIC_API_KEY, Opus `claude-opus-4-8`, thinking adaptatif, refusal géré) :
il NARRE le plan d'assainissement déterministe (`remediationPlan`, déjà priorisé par impact FCFA) en une
feuille de route « par où commencer ». Séparation pur/IO : `domain/aiRemediation` (prompt +
`normalizeSynthesis`, testé vitest) ; `lib/aiRemediation` (appel SDK). `normalizeSynthesis` écarte tout
`type` hors plan → l'IA ne peut ni inventer un chantier ni citer un chiffre non fourni. Lecture seule
(`requireRead("import")`), plan fourni par le front (parité) re-borné serveur, rateLimit IA partagé.
Front : la synthèse s'affiche AU-DESSUS du classement FCFA (qui reste la référence) dans
`RemediationPlanCard` ; chaque étape renvoie à son bloc via `onGo(type)`.

**Appris.** La frontière « n'invente aucune donnée » s'applique aussi à une IA de SYNTHÈSE : on ne lui laisse
narrer QUE les types/chiffres du plan (garde `normalizeSynthesis` + prompt sans autre chiffre). Un seul
passage suffit (narration, pas écriture) — pas de vérification adverse comme `aiCorrection`.

**Vérifs.** Functions 1384/1384 (+4 domain), no-undef 169, deploy-targets 202 (+1), node --check OK. Web
313/313, tsc/eslint 0, bundle 121,5 ≤ 122 Ko.

**Bilan programme.** Les 5 lots du Centre de correction sont livrés : tableaux alignés (1), IA globale (2),
actions IA auto-applicables (3, ADR-078), normalisation clients assistée IA (4), synthèse « par où
commencer » (5, ADR-080) — plus le sélecteur de PM ClickUp et le Lot 6 (DC obligatoire, ADR-079).

---

## 2026-07-23 — Reprise dev projet actuel (migration gelée) : perf overview, recensement dette, marge mnt réelle

**Contexte.** Migration vers projet dédié `neurones-360` **gelée** (compromission du compte Google
propriétaire — account takeover ; prod `propulse-business-87f7a` intacte, compte séparé). Workflow V2
désactivé (renommé `.disabled`, #590). On finalise sur le projet actuel ; backlog validé en interactif.

**Fait.**
- **Perf (#591)** : dérivations lourdes d'`overview.tsx` mémoïsées (`computeFilteredOverview`, `points`,
  `liveInvoices`, `projTiers`) selon le patron `finance.tsx` ; `useMemo` placés AVANT les early-returns
  (règle des hooks, ESLint CI). Comportement inchangé, 313 tests web verts.
- **Recensement dette (lecture seule)** : 0 `TODO`/`FIXME`/`HACK`/`@ts-ignore`, 0 bloc de code commenté.
  Dette balisée = 13 `eslint-disable react-hooks/exhaustive-deps` (idiome primitives design) + 179 `any`
  (idiome accesseurs de colonnes). Vraie dette = documentée (runbooks). **Pas de lot de nettoyage justifié.**
- **Marge maintenance réelle (ADR-081)** : `computeContratPnl` retient `max(coût planifié, coût réel
  fournisseur)` par FP (`supplierCostByFp`, enfin câblé). Deux appelants synchronisés (callable Rentabilité
  + recompute) ; `supplierInvoices` ajouté au gate `needCredit`. Additif : sans facture fournisseur, coût =
  planifié → chiffres identiques. Champ `coutPnlReel` exposé (droit `rentabilite`). 1385 tests functions verts.

**Décidé (interactif).** Odoo : lancer (dev Odoo dispo) ; source de vérité Odoo↔Excel : statu quo ;
astreintes → ligne de fiche affaire ; funnel win-rate en valeur : à ajouter ; découpe `index.js` : plus tard.

**Reste.** Astreintes objet porteur (fiche), funnel valeur, extension Odoo (émission côté Odoo) ; sécurité
ops (couper facturation `neurones-360` + secret `FIREBASE_SERVICE_ACCOUNT_V2`).
