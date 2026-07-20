# 05 — Registre des décisions d'architecture (ADR)

> Append-only. On ne modifie pas un ADR : on en écrit un nouveau qui le remplace.
> Une décision non écrite est une décision qui sera re-débattue dans trois mois, sans mémoire.

## ADR-055 — Remédiation audit intégrité FP + systèmes de correction (6 correctifs H1→M4)

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (« audit d'intégrité, continuité, cohérence, unicité du FP + audit des systèmes de correction » → « tout corriger, HAUTE→MOYENNE »)

### Contexte
Audit transverse (5 auditeurs lecture seule + vérification). Le cœur de calcul FP est sain (fpKey + fpAliases appliqués partout, miroir front fidèle). Les défauts étaient dans les **systèmes de correction** et l'**ingestion Odoo**, pas dans l'agrégation.

### Décisions (correctifs)
- **H1 — Suppression d'alias FP/DC réellement effective.** `setFpAlias`/`setDcAlias` écrivaient `{map}` en `merge:true` → Firestore fusionne récursivement le champ `map` et la clé retirée SURVIVAIT (alias « supprimé » toujours appliqué au recompute — irrémédiable via l'UI). Passés en **`merge:false`** (ces docs ne portent que `{map, updatedAt}` → remplacement complet). Bug de prod PRÉ-EXISTANT sur `setFpAlias`.
- **H2 + M1 — Ingestion Odoo ADDITIVE STRICTE.** `mapBc`/`mapOpportunity`/`mapInvoice` gataient sur l'**input brut** (`present`) alors que `fpKey`/`isoDay` renvoient `null` (placeholder FP, date hors regex/plausibleYear). Le `null` écrasait au merge une valeur curatée (BC orphelin → coût SOA perdu ; date/`fp` de facture corrigés par `setInvoiceFp` écrasés). Désormais **gate sur le RÉSULTAT** (clé omise si null) — patron déjà en place dans `mapOrder`. Champs : `fp`, `etaReel`, `etaContrat`, `dateIn`, `updateDate` (BC) ; `closingDate`, `dateCreation` (opp) ; `fp`, `date`, `dueDate`, `dateCreation` (facture).
- **M2 — `dcAliases` RÉTROACTIF.** L'overlay n'agissait qu'à l'ingestion webhook → un BC déjà stocké sans FP n'était jamais rattaché. Désormais appliqué **au recompute** (`aggregate.js`, symétrique de `fpAliases`) ET dans `correctionQueue` (parité cockpit Qualité ↔ Centre de correction). `resolveBcFp` garde la primauté d'un FP existant.
- **M3 — `reconClient` (Dossier client) : assiette alignée.** Exclut désormais annulations (commandes par `safeId(fp)`, factures par id), fantômes (`stale`), périmées (`isAgedLost`) et déduplique inter-source (salesData > saisie) — MÊME population que `aggregate`/`correctionQueue`. Ne proposait plus de rapprocher vers un FP annulé ni de compter des opps que le reste du système ignore.
- **M4 — `capacity.js` : plus de `weighted` linéaire persisté.** Le repli de `demandDaysOf` réintroduisait `o.weighted` (interdit CLAUDE.md — deux vérités du pondéré). Retiré : `pw` (projectionWeight tiéré, toujours fourni par l'appelant) puis repli ultime `montant × IdC`.

### Conséquences
- H1 change un comportement de prod (la suppression d'alias devient effective) — surveiller qu'aucun alias légitimement présent ne disparaisse (le remplacement complet est fidèle à la map en mémoire, qui part de l'existant).
- H2/M1 : les docs Odoo n'écrivent plus de clés `null` → au merge, les valeurs curatées survivent. Tests mis à jour (assertions « clé omise » au lieu de « null »).
- M2 : un BC rétro-rattaché alimente le carnet coût/SOA au recompute suivant.
- Tests : `resolveBcFp`, gating additif (fp/date), `demandDaysOf` (weighted ignoré). Suite functions 1265/1265.

---

## ADR-054 — BC Odoo : champs additifs (etaContrat / updateDate / comment) + rapprochement DC → N° FP (overlay `config/dcAliases`)

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (« mettre à jour le webhook entrant pour les BC » — axes retenus : champs manquants, doc Odoo, rôle du DC dans le rapprochement)

### Contexte
Le webhook BC (ADR-051) capte les lignes `bcLines` d'Odoo mais laisse tomber des champs que le type `BcLine` de l'app connaît déjà (donc consommés en aval) : `etaContrat` (ETA contractuelle, distincte de l'ETA réelle `etaReel`, utilisée par `clickupBc.js`), `updateDate`, `comment`. Par ailleurs le DC (ADR-052) était capté **inerte** : aucun rôle fonctionnel. Le cas normal reste « Odoo envoie FP **et** DC », mais un BC dont le FP est absent/placeholder (rejeté par `fpKey`) ne se rattache alors à aucune affaire.

### Décision
- **Champs additifs** dans `mapBc` (PUR, patron ADR-049 « n'écrire que le fourni ») : `etaContrat`/`updateDate` (via `isoDay`, date invalide → `null`), `comment` (via `str`). Aucun champ existant réécrit.
- **Rapprochement DC → N° FP** = overlay CURÉ `config/dcAliases` (map `dc → FP`), **même esprit que `fpAliases`** : non destructif, survit aux ré-imports, humain dans la boucle. Helper PUR `resolveBcFp(doc, dcAliasMap)` (testé) : le **FP explicite d'Odoo PRIME toujours** ; l'overlay n'agit QUE si le FP est absent. Le handler `odooWebhook` charge l'overlay et l'applique avant l'upsert BC.
- Overlay alimenté par un **data-steward** (droit « import ») via le callable **`setDcAlias`** (miroir de `setFpAlias`, audité, recompute) et l'écran *Assainissement → Rapprochement DC → N° FP*. `config/dcAliases` lisible sous `canRead('import')` (les clés SONT des DC procurement).
- **Alternatives écartées** (proposées à la Direction) : (b) rattacher le BC à la commande CLIENT par DC = changement de modèle → écarté (additif seulement) ; (c) DC = sous-affaire d'un FP → écarté (spéculatif, aucune donnée). L'overlay curé est le choix réversible et conforme à « la règle de l'ERP gagne ».

### Conséquences
- **Additif et réversible** : overlay vide par défaut → **comportement strictement inchangé** (le cas Odoo FP+DC n'utilise jamais l'overlay). Retirer un alias annule le rattachement.
- Un BC nouvellement rattaché peut alimenter le carnet coût/SOA → `setDcAlias` déclenche un recompute complet, comme `setFpAlias`.
- `setDcAlias` ajouté à `deployed-functions.txt` (garde CI). Tests : `resolveBcFp` (FP prime / DC connu / DC inconnu) + champs additifs dans `odooSync.test.js`.

---

## ADR-053 — Bouton Admin « Purge des données » (table rase P&L / Opportunités), Direction-only et irréversible

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (« prévoir bouton purger P&L et Opportunité dans l'admin » — anciens fichiers incohérents, ~60% corrigés)

### Contexte
Les anciens fichiers d'import contiennent beaucoup d'incohérences ; l'import étant un **upsert delta** (n'efface jamais), les enregistrements devenus obsolètes RESTENT après un ré-import du fichier assaini. Un **purge** (table rase) est nécessaire pour repartir propre avant ré-import.

### Décision
- Callable **`purgeCollections`** (handler `sanitize.js`) — **DIRECTION uniquement** (`nt360Role === "direction"`, au-delà d'un simple droit « import »), **confirmation `« PURGER »`** obligatoire dans le payload, rate-limité, audité.
- **Périmètre = table rase (toutes sources)** ; deux cibles indépendantes (cases à cocher) : `orders` (P&L) et/ou `opportunities`.
- **Satellites + overlays purgés avec la cible** (choix Direction) : orders → `commandesRows` (chunks dérivés), `billingMilestones`, overlays `cancelOrders`/`orderCasOverride`/`fpAliases` ; opportunities → `oppHistory`/`oppDateHistory` + `fpAliases`. **`fpAliases` (partagé opp↔P&L) est dédupliqué** par la fonction PURE `purgePlan(targets)` (testée).
- Suppression **paginée** (400/lot, garde-fou `PURGE_MAX = 500 000`). **Recompute best-effort** derrière (régénère les dérivés ; un échec ne remonte pas en « internal »).
- **Satellites rattachés par enregistrement — suppression FILTRÉE** (anti-orphelins, ajout post-audit) : les
  `activities` (`relatedType == "opportunity"`) et `approvals` (`entityType == "opportunity"`) sont vidées avec
  les opportunités ; les `approvals` (`entityType == "order"`) avec le P&L. **Jamais** toute la collection : les
  activités de comptes et les approbations d'autres entités (`bcLine`/`mnt_contrat`/`astreinte`) sont préservées.
  Motif : les ids d'enregistrement étant déterministes, des activités/approbations orphelines se ré-attacheraient
  à un ré-import (timeline/approbations périmées sur une donnée fraîche).
- Front : carte **« Zone dangereuse › Purge des données »** (Admin), rendue Direction-only, bouton rouge n'apparaissant qu'après sélection d'une cible **et** saisie de `« PURGER »`, avec re-confirmation `DangerBtn`.

### Conséquences
- **Destructif et irréversible** : trois garde-fous (rôle Direction serveur + jeton `PURGER` + re-confirmation UI) ; tracé au journal d'audit (`purge_collections`).
- Les **factures** ne sont PAS dans le périmètre (ni leurs overlays `cancelInvoices`) — hors demande.
- Après purge, un **ré-import** du fichier assaini reconstruit le carnet ; les overlays ayant été effacés, les corrections d'annulation/alias/override seront à re-poser (choix « table rase » assumé).

---

## ADR-052 — Le « DC » Odoo est un identifiant PROPRE additif (attribut `dc`), le N° FP reste la clé de rapprochement

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (« DC = identifiant propre en plus du FP »)

### Contexte
Odoo porte un identifiant « DC/AAAA/NNNN » (ex. n° de commande client Odoo). La demande initiale parlait de
« rattachement DC → FP ». Après clarification, le DC **n'est pas** un alias ni un remplaçant du FP : c'est une
**référence externe propre** que chaque objet Odoo porte **en plus** de son N° FP.

### Décision
- Champ **`dc`** (string) capté **additivement** par les 4 mappers du webhook (`mapOpportunity`, `mapOrder`,
  `mapInvoice`, `mapBc`) quand Odoo le fournit ; **jamais** utilisé comme clé de rapprochement — le **N° FP
  (`fpKey`) reste l'unique clé d'affaire**, `plausibleYear`/dédup inchangés.
- Typé côté front (`Order`/`Invoice`/`Opportunity`.`dc?`) et **affiché en lecture** là où le FP est déjà mis
  en avant (modale « Corriger la commande » du backlog). Élargissement de l'affichage à d'autres vues au fil
  du besoin (non deviné).

### Conséquences
- **Strictement additif** : nouveau champ optionnel ; aucune logique de calcul/rapprochement modifiée ; à
  drapeau Odoo éteint, rien ne change. Le DC n'entre dans **aucun** agrégat (pas de 2ᵉ clé d'affaire).
- Si un jour un objet n'a QU'un DC sans FP, ce serait une décision distincte (cf. option écartée « le DC
  remplace le FP » → ADR dédié requis).

---

## ADR-051 — Le webhook Odoo alimente les BC fournisseurs (collection `bcLines`) avec priorité « comptable/ClickUp prime »

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (« BC fournisseurs via Odoo → bcLines »)

### Contexte
Le webhook Odoo gérait 3 objets (opportunity/order/invoice). La Direction veut qu'Odoo alimente aussi les
**BC fournisseurs**. Les BC vivent dans `bcLines`, déjà alimentée par la saisie/PDF (`addBcLine`,
`source:"bc_unitaire"`) et l'import ClickUp (`source:"clickup"`). **Piège** : `domain/fournisseurs.js`
`suppliers()` **somme TOUTES les lignes** `bcLines` par fournisseur (engagement/solde du SOA) — deux docs de
MÊME N° BC mais de sources différentes **double-compteraient** l'engagement (chiffre P&L sensible). L'import
ClickUp évite déjà ce piège en n'important pas un BC dont le N° BC est **déjà** connu d'une source comptable
(« import comptable prime »).

### Décision
- **4ᵉ type d'objet `bc`** au contrat webhook → collection `bcLines`. Payload nt360-shaped (le Server Action
  Odoo mappe `purchase.order` → champs nt360, comme les 3 autres objets). Mapper PUR `mapBc` (additif, patron
  ADR-049) ; la conversion FX (taux I/O) et l'id de stockage sont posés par le handler.
- **Id déterministe par N° BC canonique** : `bcLines/bc_odoo_<bcKey(bcNumber, safeId)>` → un renvoi Odoo du
  même BC converge (idempotent).
- **Priorité « comptable/ClickUp prime »** : avant d'écrire, le handler charge le `known` de tous les
  `bcNumber` de source **≠ odoo** (deux clés : stockage `bcKey`+safeId ET logique `idBcKey` sans séparateur).
  Si le N° BC y figure, le BC Odoo est **ignoré** (`action:"skipped"`) — pas de doublon d'engagement SOA.
  MÊME logique que l'import ClickUp.
- **Statut = ENGAGEMENT seulement** (`a_emettre`/`emis`/`livre`, défaut `emis`) : un BC Odoo ne pose **jamais**
  `facture`/`solde` — le solde du compte fournisseur reste un acte comptable (MÊME règle que ClickUp).
- Champ **`dc`** (identifiant DC propre Odoo) capté additivement ; le FP reste la clé de rapprochement (Lot DC).

### Conséquences
- **Strictement additif** : nouvelle valeur de `source` (`odoo`) dans `bcLines` ; aucune ligne existante
  modifiée ; le SOA ne bouge que si un BC Odoo **inédit** (N° BC jamais vu) entre. Réversible (kill-switch
  `config/odooWebhook.enabled`).
- **Zéro double-compte** de l'engagement fournisseur : la priorité amont garantit l'unicité par N° BC.
- Coût : un scan `bcLines` (bcNumber+source) par requête webhook `bc` (borné, comme l'import ClickUp).

### Point de revue
Odoo est placé en **plus basse priorité** (défère à comptable ET ClickUp). Si l'on veut au contraire qu'Odoo
supersède ClickUp (Odoo = PO source de vérité), inverser le filtre du `known` (exclure aussi `source:"clickup"`)
— à trancher en revue si le besoin émerge.

---

## ADR-050 — Odoo et l'import Excel sont deux sources LIVE de MÊME autorité sur une opportunité (dédup par FP + non-rétrogradation de source)

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (re-audit final, constats #3/#4 ; réponse « Odoo = source live égale »)

### Contexte
Une opportunité peut être alimentée par DEUX flux : l'import Excel Sales_Data (`source:"salesData"`, périodique)
et le webhook Odoo (`source:"odoo"`, temps réel). Le dédoublonnage par FP de `aggregate.js` (et son miroir
`overviewCalc.ts`) était scopé à `source==="salesData"` seul. Deux défauts en découlaient :
- **#3 (HIGH)** : si Odoo écrit une opp AVANT l'import Excel, on obtient DEUX docs pour le même FP
  (`odoo_<safeId>` source odoo ; `<hashId>` source salesData) → **double-compte du pondéré/funnel/conversion**.
- **#4 (MEDIUM)** : le handler du webhook réécrivait `source:"odoo"` sur une opp EXISTANTE (créée par l'Excel)
  → elle sortait du périmètre du marquage FANTÔME de `lib/sync.js` (`where source=="salesData"`) et restait au
  pipeline indéfiniment même après disparition du fichier LIVE.

### Décision
**Odoo et l'import Excel sont deux sources LIVE de même autorité** sur une opp. `isLiveSource(o) = o.source ∈
{salesData, odoo}`.
1. **Dédup par FP à travers les sources live** (`aggregate.js` + miroir EXACT `overviewCalc.ts`) : on ne garde
   que le représentant le PLUS RÉCENT (`updatedAt`) par `fpKey`, toutes sources live confondues
   (`bestLiveByFp`) ; le masquage des opps `saisie` de même FP s'appuie sur `liveFps` (⊇ salesData ∪ odoo).
   → ferme #3.
2. **Non-rétrogradation de source** (`index.js`, handler `odooWebhook`) : sur une opp EXISTANTE, le merge ne
   réécrit PLUS `source` (`delete doc.source`). Une opp co-alimentée créée par l'Excel RESTE `salesData` → elle
   demeure éligible au marquage fantôme de la synchro Excel ; une opp NOUVELLE créée par Odoo garde `odoo`
   (Odoo en est l'autorité). → ferme #4.

### Alternative écartée
« Inclure `odoo` dans le calcul des fantômes de `lib/sync.js` » (option brute du constat) : DANGEREUX — la
synchro Excel staliserait TOUTE opp `odoo`-only absente du fichier (elle n'y est jamais) à chaque import. La
non-rétrogradation atteint l'intention (une opp co-alimentée reste soumise à la vivacité Excel) SANS cet effet
de bord. Documenté ici pour mémoire.

### Conséquences
- **Strictement additif, aucune donnée supprimée** : dédup = calcul pur (le doc perdant reste en base) ;
  non-rétrogradation = un champ non réécrit. Réversible.
- Invariant de cohérence respecté : `overviewCalc.ts` est le miroir EXACT (même `isLiveSource`/`bestLiveByFp`/
  `liveFps`). Test de parité `overviewCalc.test.ts` (opp Odoo + Excel même FP → 1 représentant ; `saisie`
  masquée par une opp `odoo`).
- Ne modifie PAS le mapping commande (ADR-049, déjà en place) ni les factures.

---

## ADR-049 — Le mapping webhook Odoo → commande est ADDITIF : n'écrire que les champs fournis (merge:true non destructeur)

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (re-audit final, constat #5)

### Contexte
`mapOrder` (`functions/domain/odooSync.js`) façonnait un doc COMPLET (avec `raf:null`, `cas:0`,
`designation:""`, `suppliers:[]` quand Odoo ne les envoyait pas) et le handler l'upsertait en
`set(doc,{merge:true})` sur `orders/safeId(fp)` — le MÊME doc que l'import P&L Excel (convergence voulue).
Conséquence : un update Odoo (temps réel, souvent partiel) **écrasait la valeur curatée du P&L**, en premier
lieu le **RAF FIGÉ** (`raf:null` remplaçait un RAF importé) → `mergeCommandes` retombait sur le RAF dérivé
`max(CAS−Σfactures,0)` et le backlog changeait silencieusement. Même risque pour `cas` (→ 0), et pour
`designation`/`client`/`bu`/`suppliers` sur updates partiels.

### Décision
`mapOrder` construit un doc **ADDITIF** : chaque champ n'est posé QUE si Odoo l'a réellement fourni
(`present(v) = v != null && v !== ""`), en distinguant « absent » de « 0/vide » (un `cas:0` explicite est
posé ; un `cas` absent est omis). `fp` (clé de rapprochement) et `source:"odoo"` restent toujours écrits.
`merge:true` **préserve** alors la valeur curatée d'un champ qu'Odoo n'envoie pas ; le repli dérivé de
`mergeCommandes` continue de s'appliquer quand le champ manque partout.

### Conséquences
- **Strictement additif, aucune donnée inventée** : Odoo n'efface plus par omission. Un effacement
  volontaire (rare) devrait passer par un `FieldValue.delete` explicite — hors périmètre, non demandé.
- Contrat inchangé quand Odoo émet une commande COMPLÈTE (cas nominal) : tous les champs présents → doc
  identique à l'ancien. Seuls les updates partiels changent de comportement (préservation au lieu d'écrasement).
- Tests `odooSync.test.js` mis à jour : `raf`/`dateCommande` absents → clé OMISE (et non `null`) ; nouveau
  test « update partiel n'écrase pas les champs curatés ».
- **Ne couvre PAS** le double-compte opp Odoo/Excel (#3) ni le flip de `source` (#4) : ceux-ci relèvent de
  l'ADR d'autorité inter-sources (à suivre, décision « Odoo = source live égale »).

---

## ADR-048 — Un onglet Admin « Intégration » dédié regroupe les branchements externes (webhooks, API, notifications), sorti d'Habilitations

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (« un sous-onglet Intégration dédié dans Admin »)

### Contexte
La page Habilitations portait deux rubriques hétérogènes à sa vocation (rôles/droits) : « Intégrations API &
automatisation » (webhook entrant Odoo, webhook sortant, API REST publique + clés, champs custom,
automatisations) et « Notifications » (Slack/Teams, e-mail Office 365). Après le départ de ClickUp vers son
cockpit (ADR-047), ces cartes gagnent à vivre dans un point d'entrée dédié aux intégrations.

### Décision
- **Relocalisation présentationnelle** (patron ADR-037/044/045/047) : les 7 cartes (`OdooWebhookCard`,
  `OutboundWebhookCard`, `ApiKeysCard`, `CustomFieldsCard`, `AutomationCard`, `NotificationCard`,
  `EmailNotifyCard`) restent DÉFINIES dans `web/src/modules/admin.tsx` (désormais `export`) et sont rendues
  par un nouvel écran `web/src/modules/integration.tsx` (onglet Admin « Intégration »).
- **Garde direction-only STRICTEMENT conservée** : `integration.tsx` ne rend les cartes que si
  `useClaims().role === "direction"` (identique à l'ancienne garde d'Habilitations, qui portait déjà ces
  cartes sous condition direction). **Aucun élargissement** de qui configure les intégrations (URLs/secrets
  sensibles : webhooks Odoo/sortant, clés API). Callables et droits inchangés — l'onglet réutilise la clé de
  droit `habilitations`.
- Habilitations : les deux rubriques sont retirées (renvoi en commentaire vers Admin › Intégration). La
  rubrique « Réglages de calcul » (projection, seuils d'alerte, staffing, dédoublonnage) reste sur place.

### Conséquences
- **Strictement additif** : aucun callable/droit/schéma modifié ; seul l'emplacement de l'UI change. Le
  nouvel écran est lazy → le chunk d'entrée ne porte que l'entrée de nav.
- Budget bundle : l'accumulation d'entrées de nav (onglets Admin) porte le chunk d'entrée à ~120,1 KB. Le
  garde-fou `check-bundle.mjs` passe de 120→122 KB — **son rôle reste intact** (bloquer un import STATIQUE
  lourd qui devrait être lazy) ; la hausse ne vient pas d'un import lourd mais du cumul d'entrées de nav.

### Ce qu'on saura dans six mois
Si l'onglet « Intégration » se remplit de configs supplémentaires, le cumul d'entrées de nav pourrait
re-tendre le budget → surveiller `check-bundle.mjs` et découper si nécessaire.

---

## ADR-047 — La configuration + les actions ClickUp vivent dans le COCKPIT ClickUp, pas dans Habilitations

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (« déplacer l'intégration ClickUp dans le cockpit ClickUp »)

### Contexte
Le cockpit ClickUp (`clickupcockpit`, module `overview`) était 100 % lecture (KPI de pilotage) et renvoyait
en boucle vers **Habilitations → Intégration ClickUp** pour toute action. La grosse carte de config + actions
(`ClickupCard` : toggle, listes cibles, synchro/push/rattachement/dédoublonnage commandes & BC, webhooks
temps réel, diagnostic qualité) vivait dans Habilitations, loin de ses KPI.

### Décision
- **Relocalisation présentationnelle** (patron ADR-037/044/045) : `ClickupCard` + ses helpers (`ClickupHealthPanel`,
  `ClickupActionRow`, `CLICKUP_LISTS`, `CLICKUP_WEBHOOK_ENDPOINT`) déménagent de `web/src/modules/admin.tsx` vers
  un nouveau fichier `web/src/modules/clickupAdmin.tsx` (export `ClickupCard`), rendu DANS le cockpit ClickUp.
- **Garde direction-only STRICTEMENT conservée** : le cockpit ne rend `<ClickupCard/>` que si
  `useClaims().role === "direction"` (identique à l'ancien `isDirection` d'Habilitations). Le cockpit reste
  visible en lecture (module `overview`) aux autres rôles, **sans** la config/les actions. **Aucun
  élargissement** de qui configure/actionne ClickUp. Callables et droits inchangés.
- Habilitations : la carte est retirée (renvoi en commentaire) ; les redirections « → Habilitations » du
  cockpit deviennent « → carte de configuration ci-dessus ».

### Conséquences
- **Strictement additif** : aucun callable/droit/schéma modifié ; seul l'emplacement de l'UI change. Les
  deux chunks (admin, clickupcockpit) restent lazy → chunk d'entrée inchangé (119,9 KB).
- Le pilotage ET la configuration ClickUp sont enfin au même endroit.

## ADR-046 — Normalisation fournisseurs MINIMALE : clé `cleanName` + alias manuels (config/supplierAliases), consolidée dans le référentiel Fournisseurs

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (« consolider la normalisation des fournisseurs » ; profondeur « minimale : inventaire + alias manuels déterministes »)

### Contexte
Aucune infrastructure de normalisation fournisseur n'existait (contrairement aux clients : règles + alias + IA).
Seul `cleanName` (ADR-P20) regroupait déjà les graphies « à un espace/casse près » au recompute du SOA. La
Direction veut un **inventaire** des fournisseurs distincts et la possibilité de **fusionner manuellement** les
graphies que `cleanName` ne rattrape pas (ex. « SAMSUNG ELECTRONICS » ↔ « SAMSUNG »), **sans IA**.

### Décision
- **Clé canonique inchangée = `cleanName`** (ADR-P20). PAS de retrait de forme juridique / pays / bruit
  (ce serait un changement de sémantique du SOA — hors périmètre). La normalisation minimale n'ajoute QU'UN
  étage : une table d'**alias manuels déterministes** `config/supplierAliases` (overlay, survit aux ré-imports).
- **Domaine PUR** `functions/domain/supplierName.js` (`buildSupplierResolver`, `groupSupplierNames`), testé.
  Sans alias, `resolve(x) === cleanName(x)` — **identité**.
- **SOA additif** : `suppliers()` (`domain/fournisseurs.js`) accepte `opts.resolveSupplier` (défaut `cleanName`).
  `aggregate.js` lit `config/supplierAliases`, construit le résolveur, le passe. **Sans alias, sortie SOA
  byte-identique** (invariant de non-régression prouvé par la caractérisation `fournisseurs.test.js`, 9 tests
  au vert inchangés). L'édition d'alias déclenche un recompute.
- **Callables** : `setSupplierAliases` (droit `fournisseurs`, PAS direction-only — ne touche que des noms, pas
  de coût confidentiel) + `supplierNames` (inventaire, lecture `fournisseurs`). Rule `config/supplierAliases`
  lisible `fournisseurs`, écriture réservée aux Functions.
- **UI consolidée dans le référentiel Fournisseurs** (`fournisseursref`), en **section** — PAS un onglet séparé
  (évite un doublon de nav et respecte le budget bundle). Inventaire + table d'alias.

### Conséquences
- **Strictement additif** : le SOA ne change QUE si un alias est posé (décision humaine). `cleanName` reste
  l'autorité fournisseur (ADR-P20) ; ADR-046 ne fait qu'ajouter des fusions manuelles au-dessus.
- Étape 3/3 (dernière) de la consolidation des référentiels.

## ADR-045 — Les référentiels transverses (devises/FX, PM, BU, territoires, équipes) vivent dans RÉFÉRENTIELS, pas dans Habilitations

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (« à transférer dans Référentiels aussi »)

### Contexte
Les référentiels transverses — **taux de change** (config/fxRates), **Project Managers**, **Business Units**,
**Territoires**, **Équipes** (config/*) — s'éditaient depuis la page **Habilitations** (rubrique « Référentiels »,
gâtée `isDirection`). Or les autres référentiels (clients, normalisation clients, fournisseurs — ADR-044) sont
regroupés sous **Référentiels**. Deux endroits pour « paramétrer un référentiel » : friction et rangement
incohérent, signalés par l'utilisateur.

### Décision
- **Relocalisation présentationnelle** (patron ADR-037/ADR-044) : `FxRatesCard` + `RefListCard` (×4) déménagent
  de `web/src/modules/admin.tsx` vers un **nouvel écran** `web/src/modules/referentielsadmin.tsx`
  (`ReferentielsAdmin`), rangé dans le groupe **Référentiels**.
- **Garde direction-only STRICTEMENT conservée** : l'écran est gâté `useClaims().role === "direction"`
  (identique à l'ancien `isDirection`) et sa clé de module est `habilitations` (visibilité admin) → **aucun
  élargissement** de qui peut voir ou éditer ces référentiels, **le taux de change en particulier** (contrainte
  de gouvernance explicite). Un non-direction voit un état « Réservé à la Direction ».
- **Callables inchangés** (`setFxRates`, `setRefList`, `listClickupMembers`) ; **règles Firestore inchangées**
  (les docs config/* étaient déjà lisibles, l'écriture reste réservée aux Functions).

### Conséquences
- **Strictement additif** : aucun callable, droit, schéma ou règle modifié ; seul l'emplacement de l'UI change.
  Habilitations perd sa rubrique « Référentiels » (renvoi en commentaire).
- Étape 2/3 de la consolidation des référentiels (fournisseurs ADR-044 ; **référentiels Admin** ; puis
  normalisation fournisseurs minimale).

## ADR-044 — La saisie des lignes de crédit fournisseur vit dans RÉFÉRENTIELS (écran dédié), pas dans « Crédit Fournisseurs »

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (demande explicite : « consolider ici la création / normalisation des fournisseurs et clients »)

### Contexte
Le paramétrage fournisseur (plafond de crédit autorisé, solde d'ouverture SOA daté, migration des clés
canoniques) était **saisi** depuis l'écran de **suivi** « Crédit Fournisseurs » (Rentabilité › Fournisseurs).
Or les référentiels analogues (clients, normalisation clients, domaines) sont regroupés sous **Référentiels**.
Un référentiel qui s'édite dans un écran de pilotage crée deux endroits où « gérer un fournisseur » — friction
et incohérence de rangement signalées par l'utilisateur.

### Décision
- **Relocalisation présentationnelle** (patron ADR-037, Astreintes) : l'édition (`CreditEditor`) et la migration
  des clés (`MigrateCreditKeysBtn`) déménagent de `web/src/modules/operations.tsx` (`Fournisseurs`) vers un
  **nouvel écran** `web/src/modules/fournisseursref.tsx` (`FournisseursRef`), rangé dans le groupe **Référentiels**.
- **Callables inchangés** (`upsertCreditLine`, `migrateCreditLineKeys`) et **même droit d'écriture** `fournisseurs` :
  aucun élargissement de qui peut éditer. L'écran « Crédit Fournisseurs » **reste** (suivi SOA : solde, engagement,
  disponible, factures fournisseur) mais en **lecture seule** côté édition des lignes de crédit — il renvoie vers
  Référentiels › Fournisseurs via un `Tip`.
- **Cap `bySupplier` relevé à 500** (`functions/domain/fournisseurs.js`) : un référentiel doit lister TOUS les
  fournisseurs (pas seulement le top exposition), pour pouvoir éditer chaque ligne. Additif — n'affecte aucun
  agrégat (les totaux et listes critiques restent calculés sur l'ensemble). Reste très en deçà de la limite
  Firestore d'1 Mo.

### Conséquences
- **Strictement additif** : aucun callable, droit, schéma ou calcul modifié. Seul l'emplacement de l'UI d'édition
  change + le nombre de lignes remontées dans `summaries/suppliers`.
- La saisie fournisseur rejoint la saisie client sous une frontière visible (« Référentiels »).
- Étape 1/3 de la consolidation des référentiels (fournisseurs ; puis référentiels Admin ; puis normalisation
  fournisseurs minimale).

## ADR-041 — Fenêtre d'échéance proche unifiée à 90 jours (contrats de maintenance)

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (arbitrage explicite « 90 jours »)

### Contexte
Le moteur de risque signalait une « échéance proche » à **60 j** (`ECHEANCE_PROCHE_JOURS`, décision Lot 5),
tandis que le rappel de renouvellement travaille sur un horizon de **90 j** (buckets 30/60/90). Deux fenêtres
pour la même idée « le contrat arrive à échéance » → un contrat à 75 j apparaissait « à renouveler » sans être
« à risque d'échéance ». Incohérence de pilotage signalée en revue.

### Décision
- **Seuil unifié à 90 j** : `ECHEANCE_PROCHE_JOURS = 90` dans `functions/domain/mntRisque.js` (autorité unique)
  et son **miroir** `web/src/lib/mntDashboard.ts` (parité stricte `echeancesProches` front ↔ signal
  `echeance_proche` back — invariant « même métrique = même nombre »).
- Les **paliers de poids** du signal restent inchangés (dépassé 30 / ≤30 j 25 / sinon 15) : la fenêtre
  s'élargit, la gradation reste.
- Les **buckets tiérés** de `mntRenouvellements` (critique ≤30 / proche ≤60 / à venir ≤90) sont une échelle
  d'URGENCE distincte, **non** modifiée (ne pas confondre avec le seuil).

### Conséquences
- **Changement de comportement assumé** (pas purement additif) : un contrat entre 60 et 90 j déclenche
  désormais le signal → `counts`, `atRisk` et les items de `summaries/mnt_risque` évoluent. Caractérisation
  mise à jour (`mntRisque.test.js`, `mntDashboard.test.ts`).
- Alerte d'échéance et rappel de renouvellement parlent enfin du même horizon.

### Ce qu'on saura dans six mois
Si 90 j sature l'alerte (trop de contrats en fenêtre permanente), la Direction pourra reparamétrer — via
un overlay config plutôt qu'une constante, nouvel ADR le cas échéant.

## ADR-043 — Snapshot MRR/ARR quotidien des contrats de maintenance (tendance)

- **Date :** 2026-07-20
- **Statut :** Accepté
- **Décideur :** Direction (demande de tendance du revenu récurrent)

### Contexte
Le MRR/ARR récurrent était calculé **uniquement côté front** (`recurringRevenue`, à l'instant) : aucune
mémoire de son évolution. La Direction veut une **tendance** (le MRR monte-t-il ?).

### Décision
- **Historisation** dans `summaries/mnt_mrrSnapshot` : un point/jour (clé = `asOf`, écrase le point du jour),
  borné à **90 jours** — patron **identique** à `summaries/qualityHistory`.
- Calcul par un domaine **PUR** `functions/domain/mntRecurring.js` (`recurringTotals`), **miroir back exact**
  de `web/src/lib/mntDashboard.ts → recurringRevenue` : assiette **contrats actifs**, ARR = montant par
  échéance annualisé, MRR = round(ARR/12) au niveau agrégé. **Test de parité croisé** sur fixture partagée
  (`mntRecurring.test.js` ↔ `mntDashboard.test.ts`) — verrou de l'invariant « même métrique = même nombre ».
- Écrit dans le **bloc mnt déjà doublement gaté** (`want("maintenance")` + drapeau) → invariant « éteint =
  aucune écriture mnt_* » préservé. Rule `mnt_mrr.* → maintenance` + verrou drapeau (comme `mnt_risque`).

### Conséquences
- Le MRR **live** reste `recurringRevenue` (front) ; le snapshot ne sert que la **tendance** (delta ~30 j).
- Aucune deuxième vérité : back et front partagent la même règle, testée des deux côtés.

### Note — purge des CRA mnt_ à l'extinction du drapeau : REJETÉE
La tâche envisageait de **supprimer** les timesheets `source:"mnt"` quand le drapeau s'éteint. **Décision
humaine (2026-07-20) : ne pas purger.** Le read-guard (`handlers/timesheets.js`) neutralise déjà la
contribution TACE à drapeau éteint, **sans détruire** de donnée — l'extinction reste **réversible** (règle 6).
Une suppression aurait rendu l'extinction irréversible (perte de contribution jusqu'au prochain `refreshCra`).
Pas d'ADR de purge ouvert.

## ADR-040 — Reconnaissance de revenu à DEUX taux d'avancement (financier + opérationnel) → FAE/PCA, contrats de maintenance exclus

- **Date :** 2026-07-18
- **Statut :** Accepté
- **Décideur :** Direction des Opérations (« deux taux d'avancement : un financier — jalon de facturation — et un opérationnel — avancement ClickUp »)

### Contexte
La reconnaissance à l'avancement avait été **retirée** d'un lot précédent (double-compte : un « reconnu »
en euros calculé sur le périmètre maintenance se confrontait au « facturé » de l'affaire entière, quand
deux contrats partagent un `fpKey`). Refaire un **unique montant reconnu** rejouerait ce piège. La Direction
tranche pour **deux taux d'avancement** distincts plutôt qu'un chiffre reconnu.

### Décision
- **Deux taux par affaire (`fpKey`)**, jamais un « reconnu » agrégé :
  - **Financier** = `facturé / montant commande` (le jalon de facturation réalisé), lu du carnet existant.
  - **Opérationnel** = avancement ClickUp : progression **checklist réelle** (`cu.progress` 0..100, résolu/
    total) prioritaire ; à défaut, dérivée du **statut ordinal** de l'ERP (`4-/5-/9-…` livré → 1 ; `0-affecté`
    → 0 ; `1-/3-` en cours → **null**). `null` = **indéterminé** : on **n'invente aucun palier** (CLAUDE.md).
- **Écart op − fin, appliqué au montant** : op > fin → **FAE** (produit livré non facturé) ; fin > op →
  **PCA** (facturé d'avance). Calculé **uniquement** quand les deux taux sont connus.
- **Garde-fou double-compte (le cœur de l'ADR)** : une affaire portée par un **contrat de maintenance**
  (même `fpKey` — ADR-001) est **EXCLUE** de la reconnaissance projet ; sa facturation est déjà pilotée par
  l'échéancier du module maintenance (ADR-005). La liste des `fpKey` mnt n'est lue **que si le module
  maintenance est allumé** (sinon aucune collision possible ; invariant « éteint = aucune lecture mnt_* »).
- Matérialisé en **summary** (`summaries/recognition`, gaté `want("recognition")`, additif), gaté `rentabilite`
  dans les rules. Consommé au Bilan CODIR (chips FAE / PCA, gaté droit Rentabilité). **Encaissé : reste
  booléen** (décision Direction — aucun encaissé daté, pas de donnée de règlement ; cohérent ADR-037/A1).

### Conséquences
- Aucun euro « reconnu » unique n'est produit → le double-compte historique est structurellement impossible.
- La valeur décisionnelle est l'**écart** (FAE/PCA), pas un chiffre absolu contestable.
- Là où ClickUp ne donne aucun avancement (ni checklist ni statut exploitable), l'affaire est comptée en
  `nbOpUnknown` et **n'invente pas** de FAE/PCA — l'honnêteté prime sur la complétude.

### Ce qu'on saura dans six mois
Si trop d'affaires tombent en `nbOpUnknown` (avancement ClickUp indéterminé faute de checklist), envisager un
mapping **statut → % déclaré par la Direction** en config (comme `config/projection`) — décision explicite, pas
une invention silencieuse. Nouvel ADR le cas échéant.

## ADR-039 — Fusion de vues redondantes (revenu dédupliqué, risque & rétention réunis)

- **Date :** 2026-07-18
- **Statut :** Accepté
- **Décideur :** Direction (retour d'usage : « il y a peut-être des vues qu'on peut fusionner »)

### Contexte
Après la mise en onglets (ADR-036), plusieurs sujets restaient dispersés / redits : l'**ARR** apparaissait
deux fois (KPI de tête du Tableau de bord **et** carte « Revenu récurrent »), et le **churn IA** (rétention)
vivait dans l'onglet Surveillance alors qu'il analyse **exactement** les contrats à risque du moteur, carte
« Risque des contrats » (onglet Pilotage) — obligeant un aller-retour entre onglets pour lire « qui est à
risque » puis « pourquoi il partirait ».

### Décision
- **Revenu (dédup)** : l'ARR reste le KPI de tête du Tableau de bord ; la carte « Revenu récurrent » ne le
  redit plus — elle porte le **complément** (MRR mensuel + clients récurrents) et surtout la **ventilation**
  (par BU / client / périodicité). Un chiffre, un endroit.
- **Risque & rétention (réunion)** : la carte « Analyse de rétention IA » (churn) est rapatriée dans l'onglet
  **Pilotage**, immédiatement **après** la carte « Risque des contrats » (même population : les contrats à
  risque). Lecture d'un seul tenant. Aucun calcul modifié (churn ← mêmes contrats à risque).
- Front seul, additif, présentationnel. Aucun score re-calculé.

### Conséquences
- Moins de redondance, moins d'allers-retours. L'onglet Surveillance se recentre sur le Centre de surveillance
  + le Registre d'audit.
- **Restant (optionnel, non fait dans ce lot)** : réunir « Renouvellements » + « Lignées de renouvellement IA »
  (déjà tous deux dans l'onglet Contrats) et « Contrats par statut » (glance) + « Statut automatique IA »
  (proposition d'action) — fusions de moindre valeur (les vues IA concernées sont le plus souvent vides), à
  arbitrer si le besoin se confirme.

## ADR-038 — Le module respecte le filtre global BU/AM/Client (sous-ensemble de contrats visibles)

- **Date :** 2026-07-18
- **Statut :** Accepté
- **Décideur :** Direction (retour d'usage : les filtres BU/AM/Client s'affichaient mais n'agissaient pas)

### Contexte
La barre de filtre commune de l'ERP (BU / AM / Client / PM) était **affichée** au-dessus du module Contrats
mais **inerte** : le module ne la consommait pas (aucun `useFilters`), contrairement à Pipeline. Un directeur
ne pouvait pas restreindre le parc à une BU ou un client — il subissait tout le parc, table par table.

### Décision
- Le module consomme `useFilters()` et se restreint au **sous-ensemble de contrats visibles** (`vContrats`),
  dérivé par `match({bu, am, client})` avec canonicalisation du client via `useClientKey` (parité alias).
- **Toutes** les vues suivent ce même périmètre : les vues **dérivées client** (tableau de bord, revenu
  récurrent, conformité, renouvellements, maintenance par type, calendrier SLA, listes contrats/tickets)
  reçoivent les tableaux filtrés (`vContrats`/`vTickets`/`vInterventions`) ; les **lignes de summary backend**
  (risque, rentabilité, propositions de statut) sont **sous-filtrées** sur le même ensemble (par bu/am/client
  pour le risque qui les porte, par N° FP visible pour la rentabilité et le statut).
- **Invariant de parité PRÉSERVÉ par construction** : on ne **re-calcule aucun score** (le risque reste celui
  du recompute serveur) — on **compte** les lignes retenues. Un KPI filtré est donc toujours le décompte exact
  des lignes filtrées affichées, jamais une seconde dérivation divergente. `FilterNote` signale le périmètre actif.
- Additif, front seul (aucun backend, aucune règle, aucun `deployed-functions.txt`). Hooks tous appelés
  au-dessus du `return` ; `react-hooks/exhaustive-deps` respecté.

### Conséquences
- Un directeur peut piloter le parc contrat par BU / AM / client, cohérent avec le reste de l'ERP.
- Le filtre **PM** n'est pas appliqué (un contrat n'a pas de PM ; dimension non pertinente ici) — assumé.
- Le **Centre de surveillance** suit le filtre (ses événements portent bu/am/client ; comptes re-comptés) —
  cohérent avec le churn du même onglet. Les **badges d'onglet** reflètent le décompte filtré.
- Le **Registre d'audit** est **volontairement NON filtré** : c'est une trace de conformité opposable
  (inventaire de TOUTES les actions du module) — le filtrer par une dimension d'UI le trahirait ; il porte
  d'ailleurs un `entityId` sans BU/AM/N° FP, donc non filtrable proprement. Signalé à l'écran.

## ADR-037 — Les Astreintes vivent dans EXÉCUTION (écran dédié), pas dans Contrats

- **Date :** 2026-07-18
- **Statut :** Accepté
- **Décideur :** Direction (retour d'usage : « déplacer astreinte dans exécution, ça impacte à la fois les projets et les contrats »)

### Contexte
Les astreintes ont été livrées **dans le module Contrats** (ADR-035, carte sous l'onglet Tickets après CT1).
Or une astreinte est **imputée en charge par N° FP** (affaire) et **éventuellement** rattachée à un contrat :
elle pèse dans la rentabilité de **livraison** *et* de **contrat**. La ranger dans le seul module Contrats la
rendait invisible du pilotage de livraison et suggérait à tort qu'elle relève des contrats.

### Décision
- **Écran dédié « Astreintes »** dans la **section EXÉCUTION** (`web/src/modules/astreintes.tsx`, entrée de nav
  `id: "astreintes"`, groupe Exécution). Retiré du module Contrats.
- **Relocalisation présentationnelle uniquement** : mêmes callables `listAstreintes` / `submitAstreinte`,
  **inchangés**, toujours gouvernés côté backend par le **droit `maintenance` + le drapeau `mntFeature`**
  (`requireRead/requireWrite(req,"maintenance")` + `assertMntEnabled`). L'entrée de nav porte donc
  `key: "maintenance"` + `flag: "mntFeature"` : on change **où** l'écran apparaît, **pas qui** y accède.
- **Comptabilisation inchangée** : `astreinteCostByFp` alimente toujours `coutAstreintes` de la rentabilité
  contrat ET de la marge de livraison (ADR-035). Aucun backend, aucune règle, aucun `deployed-functions.txt` touché.

### Conséquences
- Les astreintes sont pilotées là où se pilote la livraison (Exécution), cohérent avec leur double portée.
- **Non décidé ici (dette assumée)** : un vrai **découplage RBAC** (droit `astreintes` propre, indépendance vis-à-vis
  de `mntFeature`) reste possible si les astreintes doivent survivre à un module Contrats éteint — ce serait un
  changement backend (rules + matrice + flag) à trancher par un ADR ultérieur. En l'état, la dépendance au droit
  `maintenance` est conservée (les gestionnaires concernés le portent déjà).

## ADR-036 — Navigation du module en 4 sous-onglets (Pilotage / Contrats / Tickets & SLA / Surveillance)

- **Date :** 2026-07-18
- **Statut :** Accepté
- **Décideur :** Direction (retour d'usage : « on se perd dans le module »)

### Contexte
Le module rendait ~18 cartes empilées sur **une seule page** en défilement vertical continu, sans
sous-navigation — alors que les autres modules de l'ERP (Partenariats, Pipeline) utilisent des sous-onglets
`Segmented`. Conséquences relevées à l'usage (surtout mobile) : scroll interminable, opérationnel (liste
contrats en 13ᵉ position, liste tickets en 17ᵉ) enterré sous le pilotage, thèmes (risque, renouvellement,
statut, revenu) dispersés sur plusieurs cartes, repères instables (cartes montées sous condition de données).

### Décision
- **4 sous-onglets** de premier niveau via la primitive `Segmented` (déjà utilisée dans l'ERP), atterrissage
  **Pilotage** par défaut :
  - **Pilotage** (lecture direction) : Tableau de bord, Revenu récurrent, Risque, Rentabilité, Conformité, Maintenance par type.
  - **Contrats** (gestionnaire) : liste des contrats, Renouvellements, Statut auto IA, Suggestions IA, Lignées IA, Import.
  - **Tickets & SLA** (support) : liste des tickets, Calendrier SLA. *(Astreintes y figure temporairement — voir ADR-037.)*
  - **Surveillance** : Centre de surveillance, Analyse de rétention IA, Registre d'audit.
- **Regroupement purement présentationnel** : les onglets ne gatent que le JSX (tous les hooks restent appelés
  au-dessus du `return`, aucune violation des règles de hooks). **Aucune logique `domain/mnt_*` ni calcul touché.**
- Reste sous `gate` (drapeau + droit) : drapeau éteint ⇒ ERP inchangé. Indiscernable (primitive + libellés maison).

### Conséquences
- Un clic d'onglet remplace un scroll complet ; les listes opérationnelles redeviennent atteignables.
- Le **dédoublonnage éditorial** des thèmes (revenu, risque, renouvellement, statut) et le **filtre global
  BU/AM/Client** sont des décisions distinctes (ADR ultérieurs), pas incluses dans ce regroupement.

## ADR-035 — Astreintes : première ligne de coût SAISISSABLE, imputée par FP, comptabilisée à la validation

- **Date :** 2026-07-18
- **Statut :** Accepté
- **Décideur :** Direction des Opérations (demande d'ajout : demande + validation + comptabilité des astreintes)

### Contexte
Le besoin : enregistrer des **astreintes** (on-call) et les **comptabiliser en charge** sur les **projets
(affaires) ET les contrats**, avec un cycle **demande → validation → comptabilisation**. Or l'ERP n'avait
**aucune ligne de coût saisissable à la main** : les coûts existants sont soit dérivés (jours CRA × CJM),
soit importés (P&L), soit portés par la fiche affaire. Il fallait donc introduire un coût *saisi*, sans
créer de deuxième vérité ni de fuite de confidentialité.

### Décision
- **Objet `mnt_astreintes`** (préfixe mnt_, additif, sous drapeau `config/mntFeature`). Une astreinte porte
  un **N° FP obligatoire** (l'affaire qui reçoit la charge), un `contratId` **optionnel**, une **période**,
  un **`montant`** (charge saisie, XOF entier) et un `statut` (`en_attente` / `validee` / `rejetee`).
- **Demande + validation = réutilisation du workflow d'approbation générique** (Lot 4) : nouvelles valeurs
  d'enum `kind:"astreinte"` / `entityType:"astreinte"` (extension additive de `domain/approval.js`).
  `submitAstreinte` crée l'objet **et** la demande d'approbation ; la décision passe par le `decideApproval`
  existant ; l'**effet** (statut → `validee`/`rejetee`) est porté par le trigger `onMntApprovalDecided`
  (même patron que les décisions de contrat). Aucun mécanisme d'approbation dupliqué.
- **Comptabilisation = SOURCE UNIQUE `astreinteCostByFp`** (`domain/mntAstreinte.js`) : agrège le `montant`
  des astreintes **validées** par `fpKey`. Ce même agrégat alimente **deux** vues sans recalcul :
  la **rentabilité contrat** (`computeContratPnl` → composante `coutAstreintes`) et la **marge de livraison**
  (`deliveryMargin` → retranchée en plus du labor). Couvre « projets ET contrats » avec un seul agrégat.
- **Pas de double-compte** : une astreinte n'est ni dans le P&L importé ni dans le CRA labor → charge
  **purement additive**, comme le sont déjà les deux rails de coût affaire (choix analogue à ADR-033).

### Conséquences / confidentialité
- Le `montant` est un **coût confidentiel** : `mnt_astreintes` est **callable-only en lecture**
  (`allow read: if false` — firestore.rules) ; `listAstreintes` **masque** le montant (null) sans le droit
  `rentabilite` ; `computeContratPnl`/`deliveryMargin` masquent `coutAstreintes` de la même façon. Aucune
  lecture directe ne peut exposer le montant brut (même logique qu'ADR-034).
- **Correctif d'audit (gardien)** : la demande copie le montant dans `approvals.amount` (nécessaire pour que
  l'approbateur décide) ; `listApprovals` **masque `amount` (null) pour les astreintes** dès que le lecteur
  n'a pas le droit `rentabilite`. Un approbateur `pipeline` seul voit donc la demande (libellé + motif) mais
  **pas** le montant ; il faut le droit `rentabilite` pour le chiffre. La promesse « montant masqué sans
  rentabilite » est ainsi tenue **de bout en bout**, y compris dans la boîte d'approbation.
- **Correctif d'audit (gardien)** : la marge de livraison (`deliveryMarginByAffaire`) ne lit `mnt_astreintes`
  et ne retranche la charge **que si le module est allumé** (`config/mntFeature`), comme les KPI d'activité
  du même fichier — sinon l'invariant « éteint = ERP d'avant » était rompu sur cette vue.
- Le score de risque intègre la charge d'astreinte via le **palier** de marge (ADR-034) : une astreinte
  validée qui fait plonger la marge d'un contrat le fait remonter en risque, **sans exposer le montant**.
- **Limite assumée** : une astreinte sur une affaire **absente du carnet et sans contrat** n'apparaît dans
  aucune des deux vues de marge (elle reste visible dans la liste des astreintes). Rattachée à un contrat ou
  à une affaire du carnet, elle est comptabilisée. À élargir si un besoin d'affaires hors-carnet émerge.
- **Éteint = ERP d'avant** : tout le bloc est sous `want("maintenance")` + drapeau ; aucune collection
  `mnt_astreintes` n'existe drapeau éteint.

## ADR-034 — La rentabilité entre dans le score de risque, sous forme de PALIER (jamais le montant)

- **Date :** 2026-07-18
- **Statut :** Accepté
- **Décideur :** Direction des Opérations (évaluation en profondeur — axe contrat)

### Contexte
Le moteur de risque des contrats (Lot 5, `mntRisque`) agrégeait 4 signaux (SLA rompu, échéance proche,
quota dépassé, sous-facturation) mais **ignorait la rentabilité** : un contrat qui ne couvre pas son coût
pouvait rester « Vert ». Or, du point de vue du Directeur des Opérations, un contrat en perte est un risque
d'exécution de premier ordre. Contrainte : le coût/CJM/marge sont **confidentiels** (droit `rentabilite`),
alors que `summaries/mnt_risque` est lu sous le droit `maintenance` (plus large). On ne peut donc pas y
matérialiser un montant de marge sans créer une fuite RBAC.

### Décision
- Ajout d'un **5e signal `marge_faible`** au score de risque, à deux sévérités : `negative` (marge < 0,
  poids **+30**) et `faible` (0 ≤ marge < **15 %**, poids **+15**).
- La marge est calculée **côté serveur** dans le recompute via `computeContratPnl` — **source unique de la
  marge** (même nombre que la vue Rentabilité, invariant « même métrique = même chiffre ») — puis **réduite à
  un palier** par `margeRisqueNiveau(row)`. Seul le **palier** (`negative`/`faible`) entre dans
  `summaries/mnt_risque`. **Le montant n'y transite jamais** : il reste dans le callable gaté `mntContratPnl`.
- Le domaine `mntRisque` ne calcule pas la marge : il **reçoit** le palier (`margeByContrat`) et reste pur,
  agnostique du coût.

### Conséquences / limite assumée
- **Divulgation qualitative assumée** : un détenteur du droit `maintenance` (sans `rentabilite`) voit
  désormais qu'un contrat a une « Marge négative / faible » — **pas le montant**. C'est l'objet même de la
  demande (rendre la rentabilité pilotable dans le risque) ; le chiffre exact reste à un clic, sous droit.
- **Signal prudent (hérite d'ADR-033)** : la marge est un plancher (revenu engagé à ce jour vs coût total).
  Un contrat jeune peut donc être signalé « négative » puis se redresser — acceptable pour un signal de
  *risque* (l'exposition de coût précoce EST un risque) ; le seuil de 15 % est ajustable sans changer le
  contrat de données. Si le coût est sous-estimé (jours sans CJM), le signal est conservateur (sous-alerte
  possible sur un « sain » qui serait en fait « faible »), jamais l'inverse.
- **Éteint = ERP d'avant** : bloc entièrement dans la garde `want("maintenance")` + drapeau `config/mntFeature`.

## ADR-033 — Rentabilité contrat : le coût inclut le P&L de l'affaire (carnet), pas seulement les interventions

- **Date :** 2026-07-18
- **Statut :** Accepté (corrige un comportement signalé en production)
- **Décideur :** Direction des Opérations (retour terrain)

### Contexte
En production, **tous** les contrats affichaient une **marge de 100 %** (Coût 0, Jours 0). Cause : `computeContratPnl`
(Lot 4/7) ne dérivait le coût **que** des interventions de maintenance (jours CRA × CJM). Or les interventions
sont rarement saisies au fil de l'eau → coût 0 → marge = revenu → 100 % mécanique, un chiffre trompeur qui
décrédibilise la vue. Le retour terrain : *« il faut puiser dans le P&L également, pas seulement en jour-homme ».*

### Décision
- Le coût d'un contrat = **coût des interventions** (main-d'œuvre TMA, jours CRA × CJM) **+ coût du P&L de
  l'affaire** porté par le carnet (achats BC + provisions), rapproché **par `fpKey`** (jamais un FP brut) depuis
  la collection isolée `commandesRowsMargin` (marge — même droit `rentabilite`).
- Les deux composantes sont **exposées séparément** (`coutInterventions`, `coutPnl`) et masquées sans le droit
  `rentabilite` (comme le reste). Confidentialité du CJM/coût préservée.
- **Additif, pas de double-compte** : on ADDITIONNE deux natures de coût distinctes (main-d'œuvre TMA vs
  achats/provisions du carnet) — on ne re-somme pas un coût déjà compté. Les interventions de maintenance
  (`source:"mnt"`) sont couvertes par le forfait et exclues de la valorisation TJM ailleurs (ADR-005/013),
  donc elles n'apparaissent pas dans le coût carnet : pas de recoupement.

### Conséquences / limite assumée
- **Marge prudente (plancher)** tant que le contrat n'est pas à terme : le revenu est *engagé à ce jour*
  (croît avec les échéances dues) alors que le coût P&L est le coût *total* de l'affaire (figé). Un contrat en
  début de vie peut donc afficher une marge basse/négative qui se redresse à mesure que le revenu s'engage.
  Signalé dans le Tip de la vue. Une reconnaissance du coût *à l'avancement* serait un ADR ultérieur.
- Un contrat dont le FP n'a **pas** de coût carnet retombe sur les seules interventions (comportement d'avant).

## ADR-032 — Détection de lignées : le signal « affaire » vient des commandes brutes, pas du carnet fusionné

- **Date :** 2026-07-17
- **Statut :** Accepté
- **Décideur :** Direction des Opérations (audit adverse du module)

### Contexte
L'audit a relevé une divergence de source pour la désignation d'affaire : la **détection** de lignées
(back, `aiMntLignees`) lit la collection **brute** `orders` (`.select("fp","designation")`) pour alimenter
le signal « affaire » de l'appariement successeur, tandis que la colonne « Affaire » **affichée** (front)
provient du **carnet fusionné** (`useCommandesRows`, autorité fiche > opp gagnée > P&L). Pour un FP dont la
désignation du carnet est surchargée par une fiche/opp, la chaîne vue par la détection peut différer du
libellé affiché.

### Décision
- **On garde les commandes brutes comme source de détection.** La désignation n'est qu'**un signal parmi
  plusieurs** (client normalisé + adjacence des dates + proximité des montants) et la lignée détectée est de
  toute façon **confirmée par l'IA puis validée par un humain** avant toute écriture. Reconstituer le carnet
  fusionné côté serveur (coûteux : lecture de plusieurs collections, `mergeCommandes`) pour un signal
  d'appariement heuristique n'est pas justifié.
- La colonne **affichée** reste sur le carnet fusionné (autorité ERP pour ce qui est montré à l'humain).

### Conséquences
- Écart de source assumé et tracé ici — à ne pas re-débattre. Si la détection devait un jour rater des
  reconductions à cause d'une désignation surchargée, l'humain le voit (il valide) et peut regrouper à la
  main ; ce n'est pas un défaut silencieux.

## ADR-031 — Conformité = complétude structurelle seule ; « échéance dépassée » bascule vers les renouvellements

- **Date :** 2026-07-17
- **Statut :** Accepté (prolonge ADR-029)
- **Décideur :** Direction des Opérations

### Contexte
Le contrôle de conformité (Lot 3/7, `mntCompliance`) comptait « échéance dépassée » (contrat actif dont la
`dateFin` est passée) parmi les **manques** de conformité, aux côtés de « sans SLA », « sans date de fin »,
« montant nul ». Or ADR-029 a déjà tranché que « `dateFin` passée ⇒ échu » est **opérationnellement faux** :
un contrat reconduit sans mise à jour de sa `dateFin` reste actif — c'est un signal de **cycle de vie**, pas
un **défaut de saisie**. Classé en conformité, il gonflait le compteur de non-conformités avec un cas qui
n'appelle pas une correction de fiche mais une **décision** (renouveler / revoir le statut), déjà couverte par
le statut auto (ADR-027/029) et les lignées (ADR-030). La même métrique portait ainsi deux sens.

### Décision
- **`mntCompliance` ne juge QUE la complétude STRUCTURELLE** : `sans_sla`, `sans_echeance` (aucune date de
  fin saisie), `montant_nul`. Le manque `echeance_depassee` est **retiré** ; la fonction devient indépendante
  de la date (plus d'`asOfIso`).
- **Les contrats actifs échus rejoignent `mntRenouvellements`** en nouveau palier `depasse` (jours < 0),
  affiché **en tête** (plus urgent), sous « Renouvellements & échéances à revoir ». L'action reste
  « Demander le renouvellement » (circuit d'approbation existant).

### Conséquences
- Vue front PURE, aucune I/O ni miroir back — aucun schéma ni callable touché. À drapeau éteint, l'ERP est
  strictement celui d'avant.
- Un contrat complet mais échu est désormais **conforme** (il l'est structurellement) et **listé en
  renouvellement** — une seule métrique par sens, plus de double-compte. Tests `mntDashboard.test.ts` mis à
  jour en conséquence.

## ADR-030 — Lignées de renouvellement : regrouper les reconductions sous un numéro généré, les contrats gardent leur FP

- **Date :** 2026-07-17
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Un même engagement de maintenance est souvent reconduit d'année en année sous des **contrats distincts**
(N° FP différents, périodes qui s'enchaînent). Rien ne matérialisait qu'ils forment **une seule lignée** —
impossible de suivre la valeur d'un client dans la durée, ni d'anticiper globalement un renouvellement.

### Décision
- **Détection PURE + confirmation IA** (« l'IA propose, l'humain valide ») : `domain/mntLignee` regroupe
  par client normalisé et chaîne les contrats adjacents (dateFin(N) ≈ dateDébut(N+1)) à montant et
  désignation proches (appariement successeur, gère l'entrelacement) ; `lib/mntLigneeAi` fait confirmer par
  le modèle que c'est bien une reconduction du **même** service. Le domaine re-valide toute sortie IA.
- **Numéro généré** `AAAAMM` (mois du plus ancien début) + 2–4 lettres du client + suffixe `-N` par
  collision. Ce numéro désigne le **GROUPE**.
- **Les contrats GARDENT leur N° FP** (ADR-001 « 1 contrat = 1 affaire » inchangé). Le rattachement est un
  champ **additif** `ligneeId` sur `mnt_contrats`, persisté par `applyMntLignee` (merge — upsert/import ne le
  clobbent pas). Le signal « désignation » vient de la **commande** adossée (par `fpKey`), le contrat ne la
  stockant pas.

### Conséquences
- Deux callables : `aiMntLignees` (détection + confirmation, AUCUNE écriture) et `applyMntLignee` (persiste
  `ligneeId`, geste humain, recompute scopé `maintenance`). Colonne « Lignée » sur la table Contrats.
- Additif : à drapeau éteint ou sans application, l'ERP est strictement celui d'avant. Aucun schéma
  existant modifié.

## ADR-029 — Statut automatique : « échéance dépassée → échu » n'est JAMAIS recommandée en masse (requiresReview)

- **Date :** 2026-07-17
- **Statut :** Accepté (durcit ADR-028)
- **Décideur :** Direction des Opérations (audit complet, avant migration)

### Contexte
ADR-028 a supprimé l'auto-application côté serveur (propose-only) après l'incident où tout le parc est
passé en `echu`. L'audit de juillet a montré que le risque n'était pas totalement clos : la règle marquait
encore la transition « `dateFin` passée → `echu` » comme **recommandée** (confiance 1.0), et le bouton
« Appliquer les recommandés » l'appliquait **en un clic, sans confirmation**. La prémisse « date de fin
passée ⇒ contrat échu » est mécaniquement vraie mais **opérationnellement fausse** : un contrat reconduit
sans mise à jour de sa `dateFin` reste actif. Le vecteur de réincidence subsistait donc.

### Décision
- La transition « échéance dépassée → échu » porte désormais `requiresReview: true` dans
  `proposeStatutRule`. `decideStatut` exclut toute proposition `requiresReview` de `apply` (« recommandé »),
  même à confiance 1.0. Elle reste **proposée** (visible) et **applicable à l'unité** par un humain.
- Le bouton « Appliquer les recommandés » demande en plus une **confirmation avec décompte** (garde-fou de
  masse générique).

### Conséquences
- L'application de masse ne peut plus rebasculer le parc en `echu`. Les fins échues restent signalées et
  se traitent au cas par cas. Aucune autre transition n'est affectée (dormant→suspendu etc. passent par
  l'IA, conservatrice, sous le seuil).

### Ce qu'on saura dans six mois
Si les utilisateurs demandent une application de masse des `→echu` (parc où la `dateFin` est fiable) →
rouvrir avec un garde-fou explicite (aperçu + double confirmation), pas en revenant au clic unique.

---

## ADR-028 — Statut automatique : SUPPRESSION de l'auto-application (incident) — propose seulement + rétablissement

- **Date :** 2026-07-17
- **Statut :** Accepté (corrige ADR-027)
- **Décideur :** Direction des Opérations (incident de production)

### Contexte — incident
L'auto-application d'ADR-027 (transitions de confiance ≥ 0.85 écrites automatiquement) a basculé **tout le
parc en `échu`**. Cause : la règle « `dateFin` dépassée → échu » avec confiance 1.0. Dans le parc réel,
**beaucoup de contrats conservent une date de fin passée tout en restant opérationnellement actifs**
(renouvelés sans mettre à jour `dateFin`). L'hypothèse « échéance dépassée = échu » était fausse pour leur
réalité, et l'avoir rendue **auto-appliquée** l'a propagée en masse et en silence — exactement ce que la
règle d'or « rien d'autre n'a bougé » interdit.

### Décision
- **Plus AUCUNE auto-application.** `aiMntContratStatut` ne fait plus que **PROPOSER** : il n'écrit aucun
  statut, quels que soient `apply`/`threshold` (paramètres ignorés pour l'écriture ; le seuil ne sert plus
  qu'à marquer les propositions `recommended`). Un changement de statut est **toujours** un geste humain
  (`setMntContratStatut`), à l'unité (« Appliquer ») ou en masse explicite (« Appliquer les recommandés »).
- **Rétablissement** : nouveau callable `revertMntAutoStatut` — lit la piste d'audit `auto_mnt_contrat_statut`
  (qui a tracé `from`/`to` par contrat), et **restaure le statut antérieur** UNIQUEMENT si le contrat porte
  encore le statut auto-appliqué. Idempotent, rejouable sans risque. Bouton « Rétablir (annuler l'auto) ».
- **Avertissement UI** : la carte signale que « échéance dépassée → échu » figure parmi les recommandés et
  invite à vérifier avant d'appliquer (contrats à date de fin passée mais toujours actifs).

### Conséquences
- Le module ne peut plus modifier un statut sans action humaine explicite : la classe d'incident est fermée.
- La règle « dateFin dépassée → échu » reste une **proposition** (utile pour repérer les vrais échus), pas
  une vérité auto-appliquée.

### Ce qu'on saura dans six mois
Si l'application manuelle en masse est jugée fastidieuse → prévoir une pré-visualisation + confirmation
avant une éventuelle ré-introduction très encadrée de l'auto (jamais sur `échu` dérivé d'une date).

---

## ADR-027 — Statut automatique : HYBRIDE règles déterministes + IA, auto-application au-dessus d'un seuil

- **Date :** 2026-07-17
- **Statut :** Accepté
- **Décideur :** Direction des Opérations (choix confirmés en session : « hybride règles + IA », « auto au-dessus d'un seuil, proposer sinon », interface **dans le module Contrats**)

### Contexte
Besoin : déterminer AUTOMATIQUEMENT le statut d'un contrat (brouillon/actif/suspendu/échu/résilié), à
l'unité et en masse. Le module modifie des contrats **en production** que d'autres utilisent — la règle d'or
« rien d'autre n'a bougé » interdit qu'un faux positif change un statut en silence. Une grande partie des
transitions est purement MÉCANIQUE (échéance dépassée = échu), donc exacte et testable sans IA ; seuls
quelques cas relèvent du JUGEMENT (suspendre un contrat dormant, réactiver un suspendu/échu prolongé).

### Décision
- **Moteur HYBRIDE.** `domain/mntStatutAuto.js` (PUR) tranche les transitions mécaniques par RÈGLES
  déterministes (échéance dépassée → échu avec confiance 1.0 ; date de début atteinte → actif proposé à
  0.7 ; résilié = terminal, jamais rétrogradé…) et n'isole pour l'IA que les cas de jugement (`needsAi`).
  `lib/mntStatutAi.js` interroge alors Claude Opus 4.8 (réflexion adaptative, gestion du refus) **sur ces
  seuls cas**. La sortie IA est TOUJOURS re-validée (`normalizeStatutProposals` : proposed ∈ énumération,
  jamais `resilie`, confiance bornée) — l'IA propose, le domaine vérifie.
- **Auto-application AU-DESSUS d'un seuil** (`STATUT_AUTO_THRESHOLD = 0.85`, réglable par appel, borné
  0.5–1). Le callable `aiMntContratStatut({ ids?, apply?, threshold? })` calcule, **auto-applique** les
  transitions dont la confiance ≥ seuil (journalisées `auto_mnt_contrat_statut`, recompute scopé), et
  **renvoie les autres comme propositions** à valider. En pratique seul l'échu mécanique (1.0) s'auto-
  applique ; les jugements IA restent quasi toujours des propositions — le comportement le plus sûr.
- **Unitaire ET en masse.** Bouton « Statut IA » par contrat (`ids:[id]`), action de sélection « Déterminer
  le statut (IA) », et « Analyser le parc » (tout le parc). Les propositions sous le seuil s'appliquent d'un
  clic (réutilise `setMntContratStatut`, Lot 3). Interface **dans le module Contrats de maintenance**
  (emplacement sémantique du statut), pas dans un référentiel clients.
- **Réutilisation** : signaux dérivés des collections déjà lues (tickets ouverts/activité) + du summary
  `mnt_risque` déjà matérialisé ; patron IA identique à `aiSuggestMntContrats`/`aiAnalyzeChurn` (clé Secret
  Manager, rate-limit `ai`, audit d'usage sans contenu). Aucune brique recréée.

### Conséquences
- Additif : un callable, deux fichiers de domaine/pont, aucun schéma ni statut existant modifié ; à drapeau
  `mntFeature` éteint, rien n'est atteignable. Les changements auto sont tracés (piste d'audit opposable).
- Exact et testable là où c'est mécanique (règles, 12 tests) ; conservateur là où il faut juger (l'IA
  défaut = aucun changement en cas de doute). Aucun statut fiable appliqué sans trace.

### Ce qu'on saura dans six mois
Si les utilisateurs relèvent le seuil pour tout laisser en proposition → l'auto-application ne servait pas,
repasser en « proposer seulement ». Si l'IA se trompe sur les jugements → durcir les règles (déplacer un cas
de l'IA vers une règle) plutôt que faire confiance au modèle.

---

## ADR-026 — Centre de surveillance : flux d'événements PROJETÉ du moteur de risque + abonnements ciblés par utilisateur

- **Date :** 2026-07-17
- **Statut :** Accepté
- **Décideur :** Direction des Opérations (choix confirmés en session : « flux unifié + abonnements ciblés », « centre in-app live »)

### Contexte
Besoin : un **centre de surveillance** des contrats — événements clés + alertes, globales ou ciblées,
« proactivité maximale ». Le module calcule DÉJÀ tous les signaux utiles dans le **moteur de risque**
(`domain/mntRisque.js` → `summaries/mnt_risque`) : SLA rompus, échéance proche, quota dépassé,
sous-facturation, par contrat, avec niveau et score. L'ERP diffuse déjà ses alertes par des documents
`summaries/alerts*` (RBAC-gated, temps réel via `onSnapshot`). Recréer un moteur d'événements ou une
brique de notification violerait « ne recrée pas ce qui existe » et créerait une 2ᵉ vérité du risque.

### Décision
- **Événements = PROJECTION du risque, pas un 2ᵉ calcul.** `domain/mntSurveillance.js` (PUR) aplatit
  les `items[]` de `mntRisque` en un flux d'événements ordonnés par sévérité : chaque `signal`
  (`sla_rompu`, `echeance_proche`, `quota_depasse`, `sous_facturation`) devient un événement portant le
  contrat (id, fp, client, am, bu), une **sévérité** (`high`/`medium`/`low` — vocabulaire de
  `domain/alerts.js`) et un message FR. Consistance garantie par construction avec le centre de risque
  (« même métrique = même nombre »).
- **Matérialisation** dans `summaries/mnt_surveillance`, écrit dans le MÊME bloc de recompute que
  `mnt_risque` (doublement gaté `want("maintenance")` + drapeau `mntFeature`). Rafraîchi après édition
  par le `requestRecompute(["maintenance"])` déjà en place (Lot 2). Lu via la règle `summaries` existante
  (ajout de `mnt_surveillance` à `summaryModule()` → `maintenance` + verrou drapeau).
- **Abonnements ciblés = état PAR UTILISATEUR**, doc dédié `mnt_watches/{uid}` (préfixe `mnt_`, isolé par
  `request.auth.uid == id`, lu en direct par `onSnapshot`). Forme : `{ global, contrats[], clients[], ams[] }`.
  Écrit par un callable gouverné `setMntWatch` (droit `maintenance`, drapeau, audité) — jamais en écriture
  cliente directe. « Global » = tout le parc ; « ciblé » = un contrat / un client / un AM.
- **Diffusion = in-app live uniquement** (réutilise `summaries` + `onSnapshot`). AUCUNE brique de
  notification externe (e-mail/push) en v1 : le ciblage se fait côté écran (filtre « Mes abonnements »
  sur le flux), pas par un envoi serveur. Pas de nouvelle infra de diffusion à sécuriser.

### Conséquences
- Additif pur : un summary nouveau (`mnt_surveillance`), une collection par-utilisateur (`mnt_watches`),
  un callable (`setMntWatch`). Aucun calcul de risque dupliqué, aucun signal existant modifié. Drapeau
  éteint ⇒ rien n'est écrit ni lisible (mêmes verrous que `mnt_risque`).
- Le flux est aussi juste que le moteur de risque : l'enrichir (nouveaux types d'événements) = enrichir
  `mntRisque`, une seule source.

### Ce qu'on saura dans six mois
Si les utilisateurs réclament une **notification hors-app** (mail/push) sur les événements critiques →
ouvrir une brique de diffusion (fonction d'envoi + dédup + préférences) par un ADR dédié. Si les
abonnements ciblés servent peu → le flux global + filtres suffisait (simplifier).

---

## ADR-025 — Type de maintenance (prédictive/corrective/évolutive/veille) + objectifs max par contrat

- **Date :** 2026-07-17
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
Besoin métier : suivre le **nombre de maintenances par nature** — prédictive, corrective, évolutive,
veille technologique — et les confronter à des **objectifs** (nombre max visé). La maintenance se
matérialise dans le module par deux objets déjà existants : les **tickets** (demandes sous contrat) et
les **interventions** (temps consultant). Il n'existait aucune classification par nature ni cible.

### Décision
- Une énumération unique `TYPES_MAINTENANCE = ["predictive", "corrective", "evolutive", "veille"]`
  (code applicatif anglais, libellés FR — ADR-010), miroitée back (`domain/mntContrat.js`) et front
  (`lib/mntContrat.ts`), sert de **source unique** des quatre types.
- **Classification à la source** : les tickets **et** les interventions portent un champ optionnel
  `typeMaintenance` (validé par `validateTicket`/`validateIntervention` ; absent → `null`, valeur hors
  énumération → **rejet** fail-loud, pas de coercition).
- **Objectifs embarqués dans le contrat** : `mnt_contrats.objectifsMaintenance` = map partielle
  `{ [type]: entier ≥ 0 }` (seuls les types renseignés sont écrits ; aucun → `null`). Entier (pas de
  subdivision) et **rejet** d'un objectif négatif, comme les autres montants du module (audit m1).
- **Comptage séparé** : tickets et interventions sont comptés **indépendamment** par type (jamais
  additionnés en un seul compteur) — un ticket « corrective » et son intervention « corrective » sont
  deux faits distincts. La vue pure `mntTypeStats` (`lib/mntDashboard.ts`) agrège par contrat + total,
  ignore les items non classés, et n'émet pas de ligne vide (ni activité ni objectif).
- **Double affichage** (demande utilisateur) : par contrat dans la **fiche en consultation** (colonne
  Objectif, dépassement signalé en clay), et **agrégé** dans une carte « Maintenance par type » du
  tableau de bord (sans colonne Objectif — les objectifs sont propres à chaque contrat).

### Conséquences
- Additif pur : trois champs optionnels (`typeMaintenance` ×2, `objectifsMaintenance`), aucun schéma
  existant modifié ; à drapeau `mntFeature` éteint, rien n'apparaît. Les données déjà saisies restent
  « non classées » (comptées nulle part par type) sans migration.
- La classification est **facultative** : ne pas remplir le type n'empêche aucune saisie ; l'objectif
  n'est qu'un repère (aucun blocage à le dépasser).

### Ce qu'on saura dans six mois
Si les utilisateurs classent peu (beaucoup d'items « non classés ») → soit le type doit devenir
obligatoire à la saisie, soit être déduit (ex. de la priorité/désignation) — nouvel ADR.

---

## ADR-024 — Le contrat de maintenance est XOF-only : une devise ≠ XOF est rejetée (pas de conversion en v1)

- **Date :** 2026-07-16
- **Statut :** Accepté
- **Décideur :** Direction des Opérations

### Contexte
`montantEngage` est traité comme un **entier XOF** partout dans le module (échéancier, rentabilité), sans
conversion. Le champ `deviseEngage` était accepté tel quel (juste mis en majuscules) : un import « Montant
1500 / Devise EUR » stockait `montantEngage=1500` **traité comme 1500 FCFA** — erreur d'unité silencieuse
contraire au pivot XOF de l'ERP (audit info).

### Décision
`validateMntContrat` **rejette** toute `deviseEngage ≠ "XOF"` (après normalisation de casse ; absent/vide →
`XOF` par défaut). Pas de conversion `fx.js` en v1 : le contrat est **XOF-only**. Fail-loud (erreur de
validation visible à l'import/saisie) plutôt que coercition silencieuse — cohérent avec le rejet du montant
négatif (audit m1).

### Conséquences
- Plus d'erreur d'unité silencieuse ; une ligne d'import en devise étrangère est signalée, pas avalée.
- Un besoin multi-devises (contrats facturés en EUR) nécessiterait une conversion au `FIXED_PEG`/`fxRates`
  et un nouvel ADR — non couvert en v1.

### Ce qu'on saura dans six mois
Si des contrats en devise étrangère se multiplient → ouvrir la conversion (fx.js) par un ADR dédié.

---

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
