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
