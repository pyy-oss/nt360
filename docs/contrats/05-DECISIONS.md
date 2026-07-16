# 05 — Registre des décisions d'architecture (ADR)

> Append-only. On ne modifie pas un ADR : on en écrit un nouveau qui le remplace.
> Une décision non écrite est une décision qui sera re-débattue dans trois mois, sans mémoire.

## ADR-023 — « Normalisation clients IA » est un référentiel séparé, always-on (hors kill-switch mntFeature)

- **Date :** 2026-07-16
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
La surcouche IA de suggestion de fusions clients (`aiSuggestClientMerges` + `lib/aiClientNorm.js` + le
bouton IA de `modules/clientnorm.tsx`) a été co-livrée avec le lot « valeur ajoutée » du module
maintenance (#398), **hors** préfixe `mnt_` et **hors** drapeau `config/mntFeature`. Un audit a relevé
l'absence d'ADR actant ce périmètre. L'écran « Normalisation clients » **pré-existe** au module (il édite
l'overlay `config/clientAliases`, ADR d'accélérateur) ; seul le **bouton IA** est nouveau, gardé par le
droit RBAC `import`, et l'application effective des alias reste réservée à la direction (droit
`habilitations`). L'IA **propose** un tableau de suggestions, elle **n'écrit rien**.

### Décision
« Normalisation clients IA » est un **référentiel transverse distinct** du module maintenance, **pas**
un livrable `mnt_` : il reste **always-on** (hors kill-switch `mntFeature`), gouverné par le droit
`import` (génération) + `habilitations` (application). On ne le place PAS derrière `mntFeature` : il ne
touche aucune donnée `mnt_` et l'éteindre avec le module maintenance n'aurait pas de sens métier.

### Conséquences
- Le périmètre est tranché et écrit : couper le module maintenance n'affecte pas la normalisation clients.
- Si un besoin de kill-switch propre émerge (ex. contrôler le coût Opus), il fera l'objet d'un drapeau
  dédié (`config/clientNormAi`) par un nouvel ADR — pas d'accrochage à `mntFeature`.

### Ce qu'on saura dans six mois
Si l'usage IA de normalisation explose en coût sans garde → ouvrir un drapeau dédié.

---

## ADR-022 — Une décision d'approbation de contrat APPROUVÉE mute le contrat (application automatique par trigger)

- **Date :** 2026-07-16
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Les décisions de contrat (renouvellement / résiliation) sont soumises au moteur d'approbation générique
(ADR-004). Un audit a relevé que `decideApproval` ne fait que passer le `status` à `approved` : **aucun
effet** n'était appliqué au contrat. Une résiliation approuvée laissait le contrat `actif` (toujours au
carnet de risque, générant échéances et revenu) ; un renouvellement approuvé ne repoussait pas `dateFin`.
La boucle « l'humain valide » restait **ouverte** (validation sans effet sur les données).

### Décision
Un **trigger Firestore** `onMntApprovalDecided` (co-localisé à la base nommée, gaté `RECOMPUTE_REGION`
comme `onRecomputeRequest`, `retry:false`) applique l'effet **à la transition** vers `approved`, via la
fonction PURE `applyMntDecision(kind, contrat)` :
- **résiliation** → `statut = "resilie"` (sort du risque ET de la rentabilité, assiette vivante ADR-021) ;
- **renouvellement** → `dateFin` repoussée d'une **durée = terme initial** (`monthsBetween(dateDebut,
  dateFin)` mois) ; un contrat échu/résilié **renaît** `actif`.
Idempotent (n'agit qu'à la transition, pas sur les ré-écritures). Audité (`mnt_decision_apply`).

### Conséquences
- La validation humaine a enfin un **effet** ; plus de contrat « fantôme » au risque après résiliation.
- Un renouvellement approuvé étend la couverture d'un terme (les nouvelles échéances apparaissent).
- Le trigger est un **exclusion volontaire** du déploiement par défaut (activé par ops, comme le recompute).

### Ce qu'on saura dans six mois
Si le terme de reconduction souhaité diffère de la durée initiale (ex. renouvellement toujours annuel) →
paramétrer la durée de reconduction sur le contrat, nouvel ADR.

---

## ADR-021 — La rentabilité par contrat n'agrège que les statuts VIVANTS (actif/suspendu), comme le risque

- **Date :** 2026-07-16
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Un audit adverse (workflow) a relevé que `computeContratPnl` (Lot 4/7) itérait **tous** les contrats,
sans filtre de statut, alors que le moteur de risque (`mntRisque`, ADR-016) ne score que les statuts
**vivants** `{actif, suspendu}` via `RISK_STATUTS`. Le revenu étant dérivé de l'échéancier (dates
seules, aveugle au statut), un `brouillon` (montant spéculatif, non engagé) ou un contrat
`echu`/`resilie` remontait un revenu > 0 et gonflait la marge du portefeuille — deux populations
divergentes sur la **même** collection `mnt_contrats`, ce que l'« invariant fort » de CLAUDE.md
(« même métrique = même nombre ») interdit.

### Décision
La rentabilité **filtre la même assiette que le risque** : `computeContratPnl` ignore tout contrat
dont le statut n'est pas dans `RISK_STATUTS` (source **unique**, importée de `mntRisque` — pas de
liste dupliquée). Un brouillon/échu/résilié ne pèse ni sur le revenu, ni sur le coût, ni sur la marge.

### Conséquences
- Rentabilité et risque parlent du même périmètre de contrats → chiffres réconciliables.
- La rentabilité **historique** d'un contrat terminé (échu/résilié) n'est pas offerte en v1. Si ce
  besoin émerge, il fera l'objet d'un ADR dédié (et devra alors traiter la résiliation anticipée dans
  l'échéancier — aujourd'hui `dateFin` d'origine est conservée, cf. journal).

### Ce qu'on saura dans six mois
Si la direction réclame la marge des contrats clos (bilan de fin de contrat) → rouvrir l'assiette.

---

## ADR-020 — Création en masse depuis les suggestions : brouillon pré-rempli, échéance = date de commande + 12 mois

- **Date :** 2026-07-16
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Les suggestions (heuristique + IA, ADR-019) n'offraient qu'un « Créer » unitaire ouvrant une fiche vide
sauf l'en-tête (fp, client, bu, am). Pour industrialiser, il faut **cocher plusieurs affaires** et créer
les contrats **en une fois**, avec des valeurs par défaut sensées tirées de la commande.

### Décision
- **Helper PUR** `buildContratDraft(order, today, echeance?)` (`web/src/lib/mntSuggest.ts`, testé) construit
  un brouillon prêt à écrire :
  - `dateDebut` = **date de la commande** (`order.dateCommande`, overlay ClickUp) ; repli `AAAA-01-01` sur le
    **millésime PO plausible** (`yearPo` ∈ [2015, année+3]) ; dernier repli = aujourd'hui.
  - `dateFin` = **dateDebut + 12 mois** (`addMonths`, jour ramené au dernier du mois si dépassement).
  - `montantEngage` = **CAS de la commande** (entier FCFA, `Math.round`).
  - `statut` = **brouillon** (JAMAIS actif d'office — l'humain active après revue).
  - `echeanceType` = échéance suggérée par l'IA si dans l'énumération, sinon **annuel** (cohérent avec 12 mois).
  - `deviseEngage` = XOF ; `engagements` = [] (le SLA se saisit ensuite).
- **Sélection multiple** (case à cocher + « tout sélectionner ») sur les deux tables (heuristique + IA).
- **Écriture en masse** = **boucle client séquentielle sur `upsertMntContrat`** (l'écriture gouvernée
  existante : RBAC + drapeau + validation + audit + idempotence par `safeId(fp)`), **tolérante par ligne** —
  MÊME patron que « appliquer en lot » du Centre de correction. **Aucun nouveau callable** (surface minimale).
- **Rien inventé en silence** : la colonne **Échéance** (dateFin dérivée) est visible AVANT toute création ;
  l'utilisateur voit la date qui sera posée.

### Conséquences
- Additif, zéro nouvelle surface serveur, zéro dépendance. Les contrats créés sont des **brouillons**
  réversibles (suppression déjà offerte). Drapeau éteint ⇒ `upsertMntContrat` refuse ⇒ rien ne se crée.

### Ce qu'on saura dans six mois
Si le terme par défaut (12 mois) ou le repli de date ne correspond pas aux usages (contrats pluriannuels,
dates de commande souvent absentes) → paramétrer le terme / enrichir la source de date, pas coder en dur ailleurs.

---

## ADR-019 — Suggestions de contrats : jugement IA (Claude) en surcouche de l'heuristique, l'IA propose et l'humain valide

- **Date :** 2026-07-16
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Les suggestions de contrats (Lot 7) reposaient sur une **heuristique de mots-clés** côté client
(`web/src/lib/mntSuggest.suggestMntContrats`) : deux faiblesses connues — des **faux positifs** (un mot-clé
présent dans une affaire ponctuelle) et des **faux négatifs** (une affaire récurrente sans mot-clé évident,
ex. « support applicatif annuel »). L'ERP dispose déjà d'un patron IA éprouvé — l'assistant du Centre de
correction (`lib/aiCorrection.js` + `domain/aiCorrection.js`, Opus 4.8, réflexion adaptative, gestion du
`refusal`, normalisation défensive) — et d'un secret `ANTHROPIC_API_KEY` (Secret Manager).

### Décision
- Ajouter un **jugement IA** en **surcouche**, sans supprimer l'heuristique (elle reste l'affichage
  instantané par défaut ; l'IA se lance sur clic explicite « Doper à l'IA »).
- **Calquer strictement le patron du Centre de correction** : partie PURE `domain/mntSuggest.js`
  (construction du prompt + normalisation défensive), pont LLM `lib/mntSuggestAi.js`, callable
  `aiSuggestMntContrats` **double-gardé** (`requireWrite('maintenance')` + drapeau `config/mntFeature`) +
  `rateLimit` (20/min) + secret. Modèle `claude-opus-4-8`, `thinking:{type:"adaptive"}`, `refusal` géré.
- **« L'IA propose, l'humain valide »** : le callable **n'écrit rien** ; il renvoie des propositions
  (`{fp, confidence, reason, echeance?}`) affichées avec leur justification. Chaque « Créer » ouvre la fiche
  **pré-remplie** — aucune création automatique. La sortie brute est TOUJOURS re-validée
  (`normalizeMntSuggestions` : fp rapproché par `fpKey` — aucune hallucination, confiance bornée, échéance
  validée contre l'énumération ERP, dé-doublonnage par FP canonique).
- **Parité « même métrique = même nombre »** : les candidats (affaires SANS contrat) sont fournis par le
  FRONT depuis le carnet fusionné (seule autorité), jamais re-dérivés côté serveur ; le serveur re-borne
  (≤ 60) et re-filtre les affaires déjà sous contrat par `fpKey`.

### Conséquences
- Additif : aucune nouvelle collection, aucun schéma modifié, aucune dépendance ajoutée (SDK déjà présent).
  Drapeau éteint ⇒ callable refusé ⇒ ERP strictement inchangé.
- Coût borné : 1 requête Opus par clic, lot ≤ 60, `rateLimit` anti-abus, audit d'usage (jamais le contenu).

### Ce qu'on saura dans six mois
Si l'IA retient durablement des affaires non pertinentes (faux positifs) ou en manque (faux négatifs) →
ajuster le prompt (`buildMntSuggestPrompt`) ou le pool de candidats, pas la barrière de normalisation.

---

## ADR-018 — Interaction maintenance↔CRA : activité gatée par le drapeau, jamais valorisée au TJM

- **Date :** 2026-07-15
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
L'audit adverse a montré deux effets de bord de l'alimentation du CRA par les interventions (ADR-013,
docs `timesheets/mnt_*`) : **B1** — les docs subsistent drapeau éteint et continuent d'alimenter
TACE/marge (violation de « éteint = ERP d'avant ») ; **M1** — les jours de maintenance, couverts par le
forfait du contrat (`montantEngage`, ADR-005), étaient re-valorisés au TJM en marge (`resourcePnl`) et
proposés à la pré-facturation → double compte revenu.

### Décision
- **1A** — La contribution `source:"mnt"` compte pour l'**activité** (TACE/occupation : `timesheetKpis`,
  `taceHistory`) **uniquement quand le drapeau est allumé** ; drapeau éteint ⇒ elle est écartée (l'ERP
  redevient strictement celui d'avant).
- **2A** — Elle est **TOUJOURS écartée de la valorisation au TJM** (marge `resourcePnl` + pré-facturation
  `preBillingFromCra`), quel que soit le drapeau : le revenu de la maintenance est le forfait du contrat,
  jamais le TJM × jours (pas de double compte).
- Implémentation : helper PUR `excludeMaintenance` (`domain/timesheet.js`) ; lecture du drapeau
  `config/mntFeature` dans les 2 callables d'activité.

### Conséquences
- « Éteint = ERP d'avant » restauré pour les KPI CRA (B1 clos). Aucune double facturation (M1 clos).
- La rentabilité par ressource (`resourcePnl`) et la pré-facturation ne reflètent que le **temps régie**
  (projet), pas la maintenance forfaitaire — cohérent avec ADR-005 (le suivi maintenance = échéancier).
- La marge maintenance (coût réel des jours d'intervention) n'est pas suivie en v1 → si besoin, brancher
  le coût chargé (ADR-007bis) sur un P&L maintenance dédié.

### Ce qu'on saura dans six mois
Si la direction veut la marge nette maintenance (coût des interventions vs forfait) → P&L maintenance dédié.

---

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
