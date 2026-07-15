# 05 — Registre des décisions d'architecture (ADR)

> Append-only. On ne modifie pas un ADR : on en écrit un nouveau qui le remplace.
> Une décision non écrite est une décision qui sera re-débattue dans trois mois, sans mémoire.

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

## Décisions encore OUVERTES (à trancher en Phase 3)

- **ADR-003** — Scores de risque **à la volée ou matérialisés** par recompute (`summaries/*`) ?
  *Recommandation : matérialisés, cohérent avec l'invariant « même métrique = même nombre ».* — **Proposé**
- **ADR-004** — Réutiliser le **moteur d'approbation existant** (`approvals`) pour les
  renouvellements/décisions de contrat ? *Recommandation : oui (Lot 4 existant).* — **Proposé**
- **ADR-005** — Source de vérité du **montant facturé** du contrat, sachant que l'ERP facture déjà
  (`invoices`, en HT) : le contrat porte-t-il un montant d'engagement propre distinct du facturé ?
  — **Proposé**
