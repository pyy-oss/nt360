# 03 — Accélérateurs

> Rempli par `/2-accelerateurs`. Chaque verdict est arbitré par un humain.
> **Un CRÉER non justifié est un échec de la phase.** Le biais par défaut est de créer ; on résiste.
> Prérequis : `01-EXISTANT.md` et `02-REGLES.md` validés (fusionnés #370/#371). ✅

## Synthèse

| Verdict | Nombre |
|---|---|
| RÉUTILISER | 21 |
| ÉTENDRE | 4 |
| CRÉER | 3 |
| ARBITRER | 2 |

## Inventaire

| # | Besoin du module | Existe dans l'ERP ? | Où (chemin) | Verdict | Justification / ce qui manque |
|---|---|---|---|---|---|
| 1 | Référentiel tiers / clients | Oui | `accounts`/`contacts` + normalisation `config/clientAliases`, `domain/clientName.js` | **RÉUTILISER** | Le client est déjà canonicalisé (`clientKey`) ; le module rattache par le même nom canonique |
| 2 | Adresses, contacts | Oui | `contacts` (→ `accounts`), module `accounts.tsx` | **RÉUTILISER** | Contacts CRM existants ; pas de besoin d'adresse structurée en v1 |
| 3 | Conditions de paiement | Partiel | `invoices.dueDate` + `paid` (`domain/receivables.js:46`, `relances.js:45`) | **RÉUTILISER** | Pas d'objet « conditions » formel : l'échéance est portée par `dueDate` de la facture. Le module suit la même convention pour `mnt_echeanceFacturation` |
| 4 | Factures de vente | Oui | `invoices` (montant **HT** `amountHt`), module `finance.tsx` | **RÉUTILISER** | Facturation existante en HT ; le module s'y adosse via `fp` (ADR-001), ne re-facture pas |
| 5 | Règlements et lettrage | Partiel | drapeau `invoices.paid` + `domain/receivables.js`, `relances.js`, `cashScenario.js` | **ARBITRER** | **Pas de lettrage/encaissement formel** : le règlement = un booléen `paid`, le cash est estimé (DSO/scénario). Le module a-t-il besoin de plus qu'un statut « facturé/réglé » ? → Q + arbitrage |
| 6 | Balance âgée / créances | Oui | `summaries/receivables`, DSO, `domain/receivables.js`, `relances.js` | **RÉUTILISER** | Balance âgée + relances existantes ; réutilisables pour l'échéancier contrat |
| 7 | Commandes / factures d'achat | Oui | `bcLines` (BC fournisseurs), `parsers/bcPdf.js`, `domain/fournisseurs.js` | **RÉUTILISER** | Pour les coûts de sous-traitance d'un contrat (éditeur/prestataire), si besoin |
| 8 | Fournisseurs / éditeurs | Oui | `bcLines.supplier`, `config/clickupBc*` | **RÉUTILISER** | Fournisseurs portés par les BC ; suffisant pour rattacher un coût éditeur |
| 9 | Plan comptable | Non | — (aucun GL ni SYSCOHADA — Phase 1 §E, agent §8) | **CRÉER — non, hors périmètre** | Aucun plan comptable dans l'ERP ; le module **n'en a pas besoin** (analytique par axes, cf. #10). Rien à créer |
| 10 | Axes analytiques (affaire / projet) | Oui | **N° FP** (`orders`/`fiches`), axes `bu`/`am`/`client`, `fpKey` (`lib/ids.js:8`) | **RÉUTILISER** | **Le crochet de rattachement.** ADR-001 : le contrat est clé sur le N° FP → coûts/factures/temps s'y rattachent déjà |
| 11 | Devises et taux | Oui | `lib/fx.js` (`toXof`, `FIXED_PEG`), `config/fxRates` | **RÉUTILISER** | Conversion XOF + peg EUR 655,957 existants ; aucun besoin de recréer |
| 12 | Employés, profils, coûts horaires chargés | Oui | `consultants`, `domain/{consultant,resourcePnl,preBilling}.js` (TJM) | **RÉUTILISER** | ADR-007 : marge v1 sur **TJM de vente** (déjà présent), pas de coût chargé → on réutilise le TJM, on ne crée aucun coût |
| 13 | Feuilles de temps / temps passé | Oui | `timesheets`/`assignments`, CRA, `domain/timesheet.js`, `activityKpi.js` | **RÉUTILISER** | Temps constaté (CRA) existant ; base du décompte d'effort/quota d'un contrat |
| 14 | Notes de frais / déplacements | Non | — (0 occurrence : `expense`, `note de frais`, `remboursement`) | **CRÉER — non, hors périmètre v1** | Absent de l'ERP ET absent du besoin contrat v1 ; rien à créer. À rouvrir si un contrat facture des frais refacturables |
| 15 | Projets / affaires | Oui | `orders`, `projectSheets`/`fiches`, clé `fp`, `domain/commandes.js`, `ficheAffaire.js` | **RÉUTILISER** | L'affaire est l'ancre du contrat (ADR-001) |
| 16 | Calendriers, jours ouvrés, jours fériés | Non (fériés) | jours ouvrés = calcul `Date.UTC` ; **aucun référentiel fériés** (Phase 0 §5) | **CRÉER** *(différé)* | ADR-002/006 : jours ouvrés Lun–Ven calculables sans donnée ; **fériés à créer** sous overlay `config/mntFeries` **seulement si** réclamé (v1 = ignorés). Cherché : `ferie`, `holiday`, `jour ouvré`, `calendar` → aucun moteur |
| 17 | Utilisateurs, rôles, permissions | Oui | matrice `config/permissions`, claim `nt360Role`, `requireWrite/Read`, record-level OWD, `firestore.rules` | **RÉUTILISER** | RBAC matriciel + record-level complets ; le module déclare son module dans la matrice |
| 18 | Moteur de workflow / validation | Oui | `approvals` (Lot 4), `domain/approval.js`, module `approvals.tsx` | **RÉUTILISER** | ADR-004 (proposé) : réutiliser pour renouvellements/décisions de contrat |
| 19 | Notifications | Oui | `lib/graphMail.js` (Microsoft Graph), digests planifiés, `config/emailNotify`/`notifications`, `domain/emailNotify.js` | **ÉTENDRE** | Moteur e-mail + digests existants ; il manque un **type de déclencheur « SLA à échéance/rompu »** → ajout additif d'une catégorie de notification |
| 20 | Ordonnanceur / tâches planifiées | Oui | `onSchedule` (Cloud Scheduler), 7 crons | **RÉUTILISER** | Un cron `mnt_*` (ex. balayage SLA) suit le même patron `onSchedule` |
| 21 | Journal d'audit | Oui | `auditLog` (schéma 6 champs), écrit partout | **RÉUTILISER** | Le module journalise ses écritures au même schéma `{uid,action,module,entity,entityId,detail,ts}` (H9) |
| 22 | Séquences de numérotation | Non | aucune séquence ; `fpKey` canonicalise seulement | **RÉUTILISER** *(via ADR-001)* | Le besoin est **résolu sans création** : le contrat est clé sur le N° FP existant. Aucune séquence à créer |
| 23 | Pièces jointes / GED | Partiel | Cloud Storage `imports/`/`exports/` (accès restreint), pas de GED généraliste | **ARBITRER** | Pas de mécanisme d'attachement libre. Un contrat a-t-il besoin de joindre le PDF signé ? → arbitrage (Storage dédié `mnt_docs/` vs pas de pièce jointe v1) |
| 24 | Recherche | Oui | `ListView` (`searchKeys`), filtres transverses `lib/filters.tsx` (BU/AM/PM/client) | **RÉUTILISER** | Recherche/filtre client-side existants ; suffisants pour les listes de contrats |
| 25 | Exports | Oui | `exceljs`/`pdfkit` (back), `exportCsv.ts`/`pptxgenjs` (front) | **RÉUTILISER** | Export CSV/Excel/PDF/PPTX réutilisables tel quel |
| 26 | Reporting / tableaux de bord | Oui | `summaries/*` + recompute `aggregate.js` ; `Card`/`Kpi`/report builder | **RÉUTILISER** | ADR-003 (proposé) : matérialiser les scores de risque dans `summaries/*` via le recompute existant |
| 27 | Bibliothèque de graphiques | Oui | **Recharts** (lazy, `design/charts.tsx`) | **RÉUTILISER** | Graphes de tendance SLA/risque avec la lib existante (lazy pour le budget bundle) |
| 28 | Composants d'interface | Oui | `design/*` : `Table`, `ListView`, `Card`, `Modal`, `Busy`, `DangerBtn`, `Select`, `DateField`, `Badge`, `Kpi`, `Tip`, tokens `T.*` | **RÉUTILISER** | Toutes les primitives nécessaires existent ; interdiction de recréer (H4/H6) |
| 29 | Multi-société / multi-pays | Partiel | axe **BU** + champ `country` (importé sur BC) ; pas de multi-entité juridique | **ÉTENDRE** | Le cloisonnement se fait par RBAC/record-level, pas par société. Le module reste dans ce cadre ; extension = porter `country`/BU sur `mnt_contrat` si utile |
| 30 | API / intégration | Oui | callables + API REST publique (`apiKeys`, Lot 7), webhooks sortants (`outboundQueue`), **ClickUp** bidirectionnel | **ÉTENDRE** | Surface d'intégration existante ; extension additive possible (exposer un contrat via l'API/champs custom `config/customFields`) |

### Briques transverses supplémentaires découvertes (hors liste des 30)

| Brique | Où | Verdict | Note |
|---|---|---|---|
| Autorités de calcul (`fpKey`, `plausibleYear`, `projectionWeight`, `mergeCommandes`) | `functions/domain/*`, `lib/ids.js` | **RÉUTILISER** | À ne jamais contourner (CLAUDE.md) |
| Recompute sérialisé (verrou à bail + coalescing) | `lib/aggregate.js`, `config/recomputeLock` | **RÉUTILISER** | Pour matérialiser `summaries/mnt_*` |
| Overlays de configuration `config/*` | Phase 0 §4.4 | **RÉUTILISER** | Patron du feature-flag `config/mntFeature` (ADR-009) |
| Hooks temps réel (`useDocData`/`useCollectionData`) | `web/src/lib/hooks.ts` | **RÉUTILISER** | `onSnapshot` pour les écrans contrat |
| Suivi d'écriture (`Busy`/`DangerBtn`/`trackWrite`/`ToastProvider`/`useConfirm`) | `design/components.tsx` | **RÉUTILISER** | Anti-double-envoi + retours utilisateur |
| Limitation de débit `rateLimit(uid, kind, max, windowMs)` | `functions/index.js:209` | **RÉUTILISER** | Pour tout callable sensible du module |
| Recompute différé (`requestRecompute` → `onRecomputeRequest`) | `functions/index.js:115` | **RÉUTILISER** | Déclencher le recalcul des scores après écriture |

## Les trois questions qui décident du coût du projet

### Q1 — Les jours fériés multi-pays existent-ils déjà ?
- **Trouvé / pas trouvé :** **PAS TROUVÉ.** Cherché : `ferie`, `jour férié`, `holiday`, `jour ouvré`,
  `calendar`, `workday` → aucun référentiel exploitable (Phase 0 §5, agent Phase 1 §9). La paie est
  **hors dépôt** (aucune collection paie).
- **Conséquence si absent :** ADR-002/006 tranchés → **v1 sans fériés** (jours ouvrés Lun–Ven bruts,
  base UTC). Si la précision devient un enjeu, création d'un overlay `config/mntFeries` (additif),
  **jamais** une recréation d'un calendrier de paie inexistant.

### Q2 — Les coûts horaires chargés existent-ils déjà ?
- **Trouvé / pas trouvé :** **PARTIELLEMENT.** Le **TJM de vente** existe (`domain/preBilling.js`,
  `resourcePnl.js`, parité TJM tâche #137) ; le **coût chargé** (coût de revient consultant) est
  évoqué par ces mêmes fichiers mais son emplacement de stockage exact n'est pas confirmé (agent §1).
- **Conséquence si absent :** ADR-007 tranché → **marge v1 sur le TJM de vente + temps (CRA)**, sans
  coût chargé. On **ne recrée aucun coût** ; une marge nette ultérieure branchera le coût chargé
  existant (nouvel ADR), jamais un doublon.

### Q3 — Existe-t-il un axe analytique « affaire » exploitable comme crochet de rattachement ?
- **Trouvé / pas trouvé :** **TROUVÉ, et c'est la clé de voûte.** L'axe = le **N° FP** (`orders`,
  `fiches`, `invoices`, `opportunities` s'y rattachent tous), canonicalisé par `fpKey` (`lib/ids.js:8`).
- **Conséquence :** **ADR-001 (accepté)** — le contrat de maintenance est **clé sur le N° FP** de
  l'affaire. Coûts, factures, temps et BC s'y rattachent déjà par la même clé. Le module n'invente
  aucun axe : il branche `mnt_contrat` sur l'affaire existante. C'est la décision qui économise le plus.

## Ce qu'on crée, et pourquoi on n'avait pas le choix

| Brique créée | Cherché sous les termes | Pourquoi l'existant ne convient pas | Coût estimé |
|---|---|---|---|
| **Objet contrat & engagements SLA** (`mnt_contrat`, `mnt_engagementSla`, `mnt_ticket`, `mnt_intervention`, `mnt_evenementSla`, `mnt_scoreRisque`) | `contrat`, `contract`, `sla`, `ticket`, `intervention`, `maintenance`, `entretien`, `astreinte`, `couverture`, `quota` | **Aucun objet métier équivalent** dans l'ERP (Phase 0 §9) ; « maintenance » n'est qu'un libellé de nature d'affaire (`backlog.tsx:756`). Le cœur du module est intrinsèquement neuf | élevé (cœur du module, lots 5+) |
| **Calcul SLA en jours ouvrés** (`domain/mntSla.js`, PUR) | `sla`, `heures ouvrées`, `délai`, `deadline`, `échéance` | Aucun moteur de délai ouvré ; règle métier PURE testable requise (règle B.1/B.4) | moyen |
| **Référentiel jours fériés** `config/mntFeries` | `ferie`, `holiday`, `jour ouvré` | Absent (Q1) ; **différé v1** (ADR-006) — créé seulement si réclamé | faible (différé) |

## Arbitrages en attente

| # | Question | Option A | Option B | Recommandation | Décidé par |
|---|---|---|---|---|---|
| A1 | **Règlements / lettrage** (#5) | S'appuyer sur le drapeau `paid` + relances existants (statut « facturé/réglé ») | Créer un suivi d'encaissement/lettrage propre au contrat | **Option A** — pas de 2ᵉ vérité cash ; le contrat lit le statut de facture | Direction |
| A2 | **Pièces jointes du contrat** (#23) | Pas de pièce jointe en v1 (le contrat référence l'affaire) | Storage dédié `mnt_docs/` (PDF signé) avec règles d'accès type `exports/` | **Option A** en v1, A2 si besoin métier confirmé | Direction |

*(Ces deux arbitrages recoupent ADR-005 — montant/facturation d'engagement — qui reste Proposé et sera tranché en Phase 3.)*

---

### Résumé de fin de phase

**Verdicts** : **21 RÉUTILISER · 4 ÉTENDRE · 3 CRÉER · 2 ARBITRER.**

- **RÉUTILISER (21)** : clients, contacts, factures HT, créances/relances, BC/fournisseurs, axe
  N° FP, devises/peg, TJM, CRA/temps, affaires, RBAC, approbations, ordonnanceur, audit,
  numérotation (via FP), recherche, exports, reporting/summaries, Recharts, primitives design, API —
  plus 7 briques transverses (autorités de calcul, recompute, overlays, hooks temps réel, suivi
  d'écriture, rateLimit, recompute différé).
- **ÉTENDRE (4)** : notifications (type « SLA »), multi-pays (porter BU/country sur le contrat),
  API/champs custom, conditions de paiement (échéancier via `dueDate`).
- **CRÉER (3, tous justifiés)** : l'objet contrat & engagements SLA (cœur neuf, absent de l'ERP) ;
  le calcul SLA jours ouvrés (règle PURE) ; le référentiel fériés `config/mntFeries` (différé v1).
- **ARBITRER (2)** : règlements/lettrage (A1) ; pièces jointes du contrat (A2).

**Les CRÉER coûtent, et ils sont tous inévitables** : le module *est* la brique « contrat de
maintenance » que l'ERP n'a pas. Tout le reste (données, socle, UI, calcul) est réutilisé. Le seul
risque de sur-création serait de recréer un coût, un calendrier ou une clé — écarté par ADR-001/006/007.

> **Phase 2 terminée. Chaque verdict est à arbitrer par vous, en particulier les CRÉER : ce
> sont eux qui coûtent. Validez avant `/3-plan`.**
