# 05 — Registre des décisions d'architecture (ADR)

> Append-only. On ne modifie pas un ADR : on en écrit un nouveau qui le remplace.
> Une décision non écrite est une décision qui sera re-débattue dans trois mois, sans mémoire.

## ADR-017 — Définir l'horloge SLA `h24` en temps calendaire 24/7 (couverture de première classe)

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
`COUVERTURES = ["ouvre_lun_ven", "h24"]` (`domain/mntContrat.js`) est validé à l'écriture, mais l'audit
adverse du Lot 5 a montré que `slaState` ignorait `couverture` : tout était calculé en jours ouvrés,
rendant `h24` **inerte** (un engagement 24/7 sous-estimait ses ruptures le week-end).

### Décision
`slaState` (`domain/mntSla.js` + miroir `web/src/lib/mntSla.ts`) branche sur `couverture` :
`ouvre_lun_ven` (défaut) → horloge **jours ouvrés** (saute le week-end, ADR-002) ; `h24` → horloge
**calendaire 24/7** (le week-end consomme du délai). Testé des deux côtés (parité).

### Conséquences
- `h24` devient une couverture réelle ; les ruptures 24/7 remontent au bon moment.
- Toujours pas de jours fériés (ADR-006) : `h24` = 24/7 strict, sans exception de calendrier.

### Ce qu'on saura dans six mois
Si un contrat 24/7 conteste une rupture calculée un jour férié → déclenche `config/mntFeries` (ADR-006).

---

## ADR-016 — Scorer le risque contrat sur quatre signaux additifs, en quatre paliers

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Le moteur de risque (Lot 5, matérialisé par ADR-003) a besoin d'une formule stable et lisible. La
direction a arrêté **quatre signaux** (SLA rompus, échéance proche, quota dépassé, sous-facturation) et
**quatre paliers** de couleur (ADR-008 : Vert/Ambre/Rouge/Critique = emerald/gold/clay/plum). Il fallait
transformer ces signaux en un score [0..100] déterministe, sans introduire de pondération opaque.

### Décision
Score = somme bornée de contributions : SLA rompus `min(40, n×20)` ; échéance proche `30` (dépassée) /
`25` (≤ 30 j) / `15` (≤ 60 j) ; quota dépassé `20` ; sous-facturation `min(25, round(pct×50))`. Palier :
`0 → Vert`, `< 30 → Ambre`, `< 60 → Rouge`, `≥ 60 → Critique`. Seuls les contrats **actifs/suspendus**
sont scorés (brouillon pas engagé ; échu/résilié terminal). Rapprochement facture par `fpKey` (ADR-001).

### Conséquences
- Formule pure, testée (`functions/test/mntRisque.test.js`), miroir front des libellés/tons
  (`web/src/lib/mntRisque.ts`) sans recalcul de score (le score vient du summary — une seule vérité).
- Les poids sont une **hypothèse de départ** ; s'ils sous/sur-pondèrent un signal à l'usage, on les
  ajuste dans le domaine pur (nouvel ADR si le changement modifie la lecture métier des paliers).

### Ce qu'on saura dans six mois
Si des contrats « Critique » sans gravité réelle (ou l'inverse) apparaissent → recalibrer les poids.

---

## ADR-015 — Dériver l'état SLA en direct (fonction pure) plutôt qu'une collection matérialisée (v1)

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Le plan (`04-PLAN-INTEGRATION.md §2.1`) prévoyait une collection `mnt_evenementsSla`. Or l'état SLA
d'un ticket se calcule à partir de données déjà présentes (ouverture, transitions, engagement du
contrat) via une fonction PURE (`domain/mntSla.js`). Matérialiser des événements ajouterait un chemin
d'écriture et un risque de désynchronisation, sans besoin en Lot 3 (affichage seul).

### Décision
L'état SLA (respecté / rompu / en cours) est **dérivé en direct** par `slaState`, mirroré front
(`web/src/lib/mntSla.ts`) — aucune collection `mnt_evenementsSla` en v1. Le ticket gagne deux
horodatages de transition (`priseEnCompteLe`, `resoluLe`, posés une fois par le callable) pour un SLA
à la minute. La **matérialisation** (historique des ruptures) est reportée au **Lot 5**, où le
recompute agrège déjà le risque (ADR-003) — une seule occasion de matérialiser.

### Conséquences
- Zéro chemin d'écriture d'événement, zéro désynchronisation ; miroir front/back exact (parité testée).
- L'historique des ruptures SLA n'est pas persisté avant le Lot 5 (acceptable : l'état courant suffit
  à l'affichage et au futur score).

### Ce qu'on saura dans six mois
Si un besoin d'audit/historique fin des ruptures apparaît avant le score → anticiper la matérialisation.

---

## ADR-013 — Alimenter le CRA depuis les interventions (8 h ouvrées = 1 jour), en doc CRA distinct

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Décision utilisateur (Lot 2) : le temps d'intervention doit **alimenter le CRA** (timesheets) — une
seule vérité du temps, pour la marge (ADR-007). Or les interventions sont en **heures** sur une date,
le CRA en **jours** par mois, et l'id du CRA manuel est `consultantId_mois` (`handlers/timesheets.js:16`).

### Décision
Le callable d'intervention recalcule, pour chaque (consultant × mois), la somme des heures des
interventions → **jours = heures / 8** (journée ouvrée standard), écrite dans un doc CRA **distinct**
`timesheets/mnt_<consultant>_<mois>` avec `source: "mnt"`. `computeConstat` (`domain/timesheet.js:46`)
sommant `billedDays` **par consultant sur tous les docs du mois**, la contribution maintenance s'ADDITIONNE
au CRA manuel **sans collision** (id différent). Drapeau éteint ⇒ aucune intervention ⇒ **TACE inchangée**.

### Conséquences
- Une seule vérité du temps (le CRA inclut la maintenance quand le module est allumé) ; le taux 8 h/jour
  est une **hypothèse** (pas de référentiel d'horaires dans l'ERP) — à paramétrer si un besoin apparaît.
- Un consultant très sollicité en maintenance peut voir son TACE dépasser 100 % (billed + maintenance) :
  signal de sur-service, cohérent, mais à surveiller côté qualité.

### Ce qu'on saura dans six mois
Si le taux 8 h/jour ou l'addition au TACE fausse la lecture d'occupation → paramétrer les horaires.

---

## ADR-014 — Quatre niveaux de priorité de ticket, alignés sur la palette de risque

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Décision utilisateur (Lot 2) : 4 niveaux de priorité réutilisant la palette de risque (ADR-008).

### Décision
Priorités = `basse / moyenne / haute / critique` (code applicatif), tons **emerald / gold / clay /
plum** (`web/src/lib/mntContrat.ts`, mêmes teintes que les 4 niveaux de risque). Statut de ticket =
`ouvert / en_cours / resolu / clos`.

### Conséquences
- Cohérence visuelle avec le futur score de risque ; aucune teinte nouvelle (règle C / H4).

### Ce qu'on saura dans six mois
Si les utilisateurs confondent priorité de ticket et niveau de risque de contrat (même palette).

---

## ADR-012 — Embarquer les engagements SLA dans le document contrat (v1)

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations (en cours de Lot 1)

### Contexte
Le plan (`04-PLAN-INTEGRATION.md §2.1`) prévoyait une collection séparée `mnt_engagementsSla`. En
pratique, un engagement SLA n'existe pas hors de son contrat, ils sont peu nombreux (1–3) et toujours
lus avec le contrat. Une collection séparée doublerait la surface (rules, index, callable) sans gain.

### Décision
Les engagements SLA sont **embarqués** comme tableau `engagements[]` sur `mnt_contrats` en v1
(validés par `domain/mntContrat.js`). La collection `mnt_engagementsSla` prévue au plan reste **non
utilisée** (son bloc de règles Lot 0 demeure, inoffensif : lecture refusée sur collection vide).

### Conséquences
- Écriture atomique (un seul doc), lecture en un seul `onSnapshot`, moins de règles/index.
- Si un besoin d'historique/lifecycle propre aux engagements apparaît (ex. suivi par événement SLA au
  Lot 3), on extraira vers une collection dédiée — nouvel ADR à ce moment.

### Ce qu'on saura dans six mois
Si les engagements doivent être requêtés indépendamment du contrat → l'embarquement aura ses limites.

---

## Format

```markdown
## ADR-NNN — <titre à l'impératif>

- **Date :** AAAA-MM-JJ
- **Statut :** Proposé | Accepté | Rejeté | Remplacé par ADR-NNN
- **Décideur :**

### Contexte
Ce qui est vrai et qui force une décision. Adossé à une observation de l'existant, avec référence.

### Options
| Option | Avantages | Inconvénients | Coût |
|---|---|---|---|

### Décision
Ce qu'on fait. Une phrase.

### Conséquences
Ce que ça implique, y compris ce que ça nous interdit désormais.

### Ce qu'on saura dans six mois
Le signal qui dira si la décision était bonne.
```

---

## Décisions attendues au minimum

- **ADR-001** — Le contrat de maintenance est-il une entité nouvelle, ou une spécialisation
  d'une entité existante (affaire, projet, contrat de vente) ?
- **ADR-002** — Où vit le calcul SLA en heures ouvrées : base, application, ou batch ?
- **ADR-003** — Les scores sont-ils calculés à la volée ou matérialisés par un batch ?
- **ADR-004** — Réutilise-t-on le moteur de workflow existant pour la validation des
  renouvellements ?
- **ADR-005** — Qui est source de vérité du montant du contrat, sachant que l'ERP facture ?
- **ADR-006** — Les jours fériés multi-pays : réutilisation du calendrier de paie, ou table dédiée ?
- **ADR-007** — Les coûts horaires chargés : lecture de la paie, ou table dédiée ?

---

## ADR-000 — Poser le module dans l'ERP plutôt que le construire à côté

- **Date :** —
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Le module de pilotage des contrats a besoin des tiers, des factures, des règlements, des achats,
des coûts salariaux et des calendriers. Tout cela vit dans l'ERP maison. Un module externe
imposerait de synchroniser ces six domaines, donc de créer six occasions de divergence.

### Décision
Le module est construit **dans** l'ERP, en réutilisant ses briques, et non à côté avec une
intégration.

### Conséquences
- On hérite des contraintes de l'ERP : sa pile, ses conventions, son rythme de livraison.
- On hérite de sa dette.
- On s'interdit d'utiliser des outils qui n'y ont pas leur place.
- En échange, il n'y a **qu'une seule vérité** sur le client, la facture et le coût.

### Ce qu'on saura dans six mois
Si le module a dû dupliquer une donnée de l'ERP, la décision aura été mal appliquée.

---

## ADR-001 — Adosser le contrat au N° FP de l'affaire

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
L'ERP ne génère aucune séquence de numérotation : le N° FP (clé d'affaire canonique, `FP/AAAA/N`)
vient des imports (`functions/lib/ids.js:8`), et aucun compteur serveur n'existe (Phase 0 §5, agent
Phase 1 §8). Un contrat de maintenance porte sur une affaire.

### Options
| Option | Avantages | Inconvénients | Coût |
|---|---|---|---|
| Adossé au N° FP | Réutilise `fpKey`, rapprochement natif, une clé connue | Un contrat = une affaire (pas de multi-affaires) | faible |
| Séquence annuelle `mnt_` | Contrat multi-affaires possible | Invente une numérotation absente de l'ERP | moyen |
| Saisie libre | Comme les factures | Pas de garantie d'unicité | faible |

### Décision
Le contrat `mnt_contrat` est **une entité nouvelle mais clé sur le N° FP de l'affaire** ; le
rapprochement contrat ↔ affaire ↔ facture se fait via `fpKey`. Un contrat = une affaire.

### Conséquences
- On réutilise `fpKey` (autorité de calcul), on ne crée pas de deuxième clé d'or.
- Un besoin futur « un contrat couvrant plusieurs affaires » exigera un nouvel ADR.

### Ce qu'on saura dans six mois
Si des contrats ont dû être scindés/fusionnés faute de pouvoir couvrir plusieurs FP.

---

## ADR-002 — Calculer le SLA en jours ouvrés Lun–Ven, base UTC

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
L'ERP n'a **aucun fuseau explicite** (crons `onSchedule` sans `timeZone`) et calcule déjà le temps
en `Date.UTC` (`functions/domain/milestones.js:43`, `handlers/timesheets.js:135`). Abidjan = UTC+0.
Aucun référentiel de jours fériés (Phase 1 §E, agent §9).

### Décision
Le SLA se calcule **base UTC** (cohérent Abidjan UTC+0) sur **jours ouvrés Lun–Ven** ; les jours
fériés sont ignorés en v1 (voir ADR-006). Le calcul vit dans `functions/domain/` (PUR, testé),
conformément à l'architecture (règle B.1).

### Conséquences
- Pas de dépendance à un fuseau invisible ; testable sans I/O.
- L'absence de fériés surestime légèrement le temps ouvré restant — signalé, corrigé par ADR-006.

### Ce qu'on saura dans six mois
Si des litiges SLA proviennent d'un jour férié compté comme ouvré.

---

## ADR-006 — Ignorer les jours fériés en v1 (pas de référentiel dans l'ERP)

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
L'ERP n'expose aucun calendrier de jours fériés exploitable (Phase 0 §5). Les recréer est interdit
(règle du kit : ne pas dupliquer une vérité). La paie — source plausible — est hors dépôt.

### Décision
La v1 **ne décompte pas les jours fériés** (jours ouvrés Lun–Ven bruts). Si un référentiel devient
nécessaire, il sera fourni sous overlay `config/mntFeries` (additif) — nouvel ADR à ce moment.

### Conséquences
- Aucune donnée fériés inventée. Précision SLA limitée mais honnête.

### Ce qu'on saura dans six mois
Si l'écart férié devient un motif de contestation récurrent → déclenche `config/mntFeries`.

---

## ADR-007 — Piloter la marge du contrat sur le TJM de vente (pas de coût chargé en v1)

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Le coût horaire chargé consultant existe dans l'ERP (`domain/resourcePnl.js`, `preBilling.js`,
`consultant.js`) mais son emplacement exact de stockage n'a pas été confirmé (Phase 0 §8, agent §1).
Recréer un coût créerait une deuxième vérité (interdit).

### Décision
La marge du contrat se pilote sur le **TJM de vente + temps constaté (CRA)**, **sans coût chargé**
en v1. On ne recrée aucun coût ; la rentabilité « coût réel » reste hors périmètre du lot 1.

### Conséquences
- « Marge » du module = engagement/revenu vs temps, pas marge nette. À nommer sans ambiguïté (voix D.6).
- Un besoin de marge nette exigera de brancher le coût chargé existant (nouvel ADR, ADR-007bis).

### Ce qu'on saura dans six mois
Si la direction réclame une marge nette → on branche le coût chargé existant, jamais un doublon.

---

## ADR-008 — Réutiliser la palette de statut existante pour le risque (+ plum = Critique)

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Le module a besoin de 4 niveaux de risque (Vert / Ambre / Rouge / Critique). L'ERP porte déjà une
sémantique couleur connue : `emerald` (succès/gagné), `gold` (attention), `clay` (danger/perdu),
`plum` (spécial) — tokens CSS-var (`web/src/design/tokens.ts`, `components.tsx:29,53`).

### Décision
Risque : **Vert = `emerald`, Ambre = `gold`, Rouge = `clay`, Critique = `plum`**. Aucune teinte
nouvelle ; on consomme les tokens `T.*` / CSS-vars (règle C, H4).

### Conséquences
- Le module est indiscernable ; un rouge veut dire « danger » partout.
- On accepte que « risque Rouge » et « opp perdue » partagent la teinte `clay` (contexte distinct).

### Ce qu'on saura dans six mois
Si les utilisateurs confondent risque et statut faute de teinte dédiée.

---

## ADR-009 — Éteindre le module par un overlay `config/mntFeature` (défaut annoncé)

- **Date :** 2026-07-15
- **Statut :** Accepté (défaut annoncé sans objection)
- **Décideur :** Direction des Opérations

### Contexte
Le kit impose que le module s'éteigne **sans redéploiement**, l'ERP redevenant *strictement* celui
d'avant. Aucun feature-flag générique n'existe (Phase 0 §9). L'ERP paramètre déjà tout par overlays
`config/*` survivant aux ré-imports (Phase 0 §4.4).

### Décision
Le drapeau vit dans **`config/mntFeature`** (overlay `config/*`). Drapeau éteint → aucune surface
`mnt_*` visible, aucun calcul, aucune écriture ; l'ERP est celui d'avant.

### Conséquences
- Cohérent avec le mécanisme de configuration existant ; testable (règles + front).

### Ce qu'on saura dans six mois
Si l'extinction laisse fuiter une surface `mnt_*` → le gating était incomplet.

---

## ADR-010 — Nommer en `mnt_` camelCase anglais, libellés en français (défaut annoncé)

- **Date :** 2026-07-15
- **Statut :** Accepté (défaut annoncé sans objection)
- **Décideur :** Direction des Opérations

### Contexte
L'ERP nomme ses collections/champs en **anglais camelCase**, avec le métier en français côté libellé
(règle A.1, dominance universelle). Le kit impose un préfixe de frontière visible.

### Décision
Collections/champs du module en **anglais camelCase préfixés `mnt_`** (ex. `mnt_contrats`,
`mnt_engagementSla`) ; **libellés UI en français** (vocabulaire du kit). Statuts en **code
applicatif** (comme `stage`, règle A.2), pas de table d'énumération.

### Conséquences
- Frontière du module visible à l'œil (`mnt_`), conventions indiscernables du reste.

### Ce qu'on saura dans six mois
Si un `mnt_` en snake_case ou un libellé anglais a échappé au contrôle `/verif`.

---

## ADR-003 — Matérialiser les scores de risque dans `summaries/mnt_risque`

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
L'ERP matérialise déjà toutes ses métriques d'agrégat dans `summaries/*` via le recompute sérialisé
(`lib/aggregate.js`) et impose l'invariant « même métrique calculée à deux endroits = même nombre »
(CLAUDE.md). Un calcul front dupliqué diverge (piège de cohérence récurrent, cf. `overviewCalc.ts`).

### Décision
Les scores de risque sont **matérialisés** dans `summaries/mnt_risque`, calculés par le recompute
existant (gate `want("maintenance")`), recalcul différé après écriture (`requestRecompute`).

### Conséquences
- Une seule vérité du score ; lecture rapide ; toucher `aggregate.js` (point de contact C3, risque
  majeur) impose un test d'identité octet-pour-octet des summaries existants, drapeau off.
- Le score n'est pas « temps réel à la milliseconde » : il suit le rythme du recompute (acceptable).

### Ce qu'on saura dans six mois
Si un score affiché diverge d'un recalcul → le miroir front/back n'était pas exact.

---

## ADR-004 — Réutiliser le moteur d'approbation pour les décisions de contrat

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Un moteur d'approbation générique existe (`approvals`, `domain/approval.js`, module `approvals.tsx`,
Lot 4) : soumission → décision hiérarchique + suivi. Recréer un circuit dédié créerait une 2ᵉ voie.

### Décision
Les renouvellements/résiliations de contrat sont soumis via **`approvals`** (un type d'objet
`mnt_renouvellement`), pas un circuit dédié.

### Conséquences
- On hérite du suivi et de la hiérarchie existants ; ajouter un type ne doit pas casser le listing
  des approbations existantes (point de contact C6, test de caractérisation requis).

### Ce qu'on saura dans six mois
Si un besoin de circuit spécifique (multi-niveaux propres au contrat) apparaît → nouvel ADR.

---

## ADR-005 — Le contrat porte un montant d'engagement propre ; l'ERP reste la source de la facturation

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
L'ERP facture déjà (`invoices`, en HT, rattachées par `fp`). Le contrat a besoin d'un montant
d'engagement (annuel/mensuel) pour piloter le « reste à facturer », mais ne doit pas re-facturer.

### Décision
`mnt_contrats.montantEngage` = **engagement propre** du contrat ; la **facturation réelle reste
l'ERP** (`invoices` par `fp`). L'échéancier compare engagé vs facturé.

### Conséquences
- Aucune double facturation, aucune 2ᵉ vérité de facture ; le suivi « reste à facturer sur
  engagement » est possible. Le lettrage/encaissement reste celui de l'ERP (ADR-011).

### Ce qu'on saura dans six mois
Si l'engagement saisi diverge durablement du facturé sans explication → donnée de contrat obsolète.

---

## ADR-011 — S'appuyer sur le statut `paid` de l'ERP (pas de lettrage propre) ; pas de pièce jointe en v1

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
L'ERP n'a ni lettrage/encaissement formel (règlement = booléen `invoices.paid` + relances/DSO,
Phase 1 §A) ni GED généraliste (Storage limité à `imports/`/`exports/`, Phase 0). Arbitrages A1/A2
de la Phase 2.

### Décision
- **A1** : le contrat lit le statut `paid` des factures de l'affaire (via `fp`) ; **aucun suivi
  d'encaissement/lettrage propre** (pas de 2ᵉ vérité cash).
- **A2** : **aucune pièce jointe en v1** ; le contrat référence l'affaire. Storage `mnt_docs/`
  (règles type `exports/`) seulement si un besoin métier est confirmé (nouvel ADR).

### Conséquences
- Surface minimale, rien à sécuriser côté GED en v1 ; le règlement reste piloté par les relances
  existantes.

### Ce qu'on saura dans six mois
Si les utilisateurs joignent les PDF ailleurs (mail, ClickUp) faute de `mnt_docs/` → rouvrir A2.
