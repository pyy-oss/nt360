# Webhook entrant Odoo → nt360

Reçoit les mises à jour Odoo sur les **opportunités**, **commandes** (carnet P&L), **factures** et **BC
fournisseurs**, et les applique dans nt360 (upsert idempotent). Odoo est **source autoritaire** : un objet
inconnu est **créé**, un objet connu est **mis à jour**. Un **backfill complet** se fait par le même endpoint,
côté Odoo (§4bis) — pas de client sortant côté nt360.

## Endpoint

```
POST https://odoowebhook-hap6lozbqq-uc.a.run.app
Content-Type: application/json
X-Signature: <hex HMAC-SHA256 du corps BRUT, clé = secret partagé>
```

URL de production (Cloud Run / Functions 2ᵉ gén., région `us-central1`). Elle se relit dans la console
Firebase → Functions → `odooWebhook` si elle change après un redéploiement.

## Authentification (HMAC)

Signature `X-Signature` = `HMAC_SHA256(secret, corps_brut)` en **hexadécimal**. Le secret partagé est posé
côté nt360 par la Direction via le callable `setOdooWebhook({ secret, enabled })` (jamais relu côté client).
Comparaison à temps constant. Une signature absente/invalide → `401`. Webhook non configuré → `503`.
`enabled: false` → `200 { ignored }` (kill-switch).

Exemple (Python, côté Odoo Automated Action) :

```python
import hmac, hashlib, json, requests
body = json.dumps(payload, separators=(",", ":")).encode()   # corps BRUT, exactement celui envoyé
sig  = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
requests.post(URL, data=body, headers={"Content-Type": "application/json", "X-Signature": sig})
```

> Le HMAC porte sur les **octets exacts** du corps. Signez la chaîne réellement transmise (ne re-sérialisez pas).

## Contrat (corps JSON)

```json
{ "object": "opportunity" | "order" | "invoice" | "bc" | "partner", "records": [ { … } ] }
```

`records` : jusqu'à **500** par requête (au-delà : tronqué, signalé par `truncated: true`). `record` (objet
seul) est accepté comme alias de `records: [record]`.

### object = "opportunity"  →  collection `opportunities`
Rapprochement : par **N° FP** (canonicalisé), sinon par **odooId**, sinon création. **`fp` ou `odooId` requis.**

| Champ | Type | Notes |
|---|---|---|
| `odooId` | string | id Odoo (`crm.lead:42`) — tracé, clé de repli. |
| `fp` | string | N° FP `FP/AAAA/N` (canonicalisé par `fpKey`). |
| `client` | string | Nom client (normalisé). |
| `designation` | string | **Nom / objet de l'affaire** (alias acceptés : `name`, `affaire`). |
| `am` | string | Commercial. |
| `bu` | string | Business Unit (normalisée ; défaut `AUTRE`). |
| `amount` | number | Montant HT (entier XOF). |
| `stage` | number | Étape 1–6 (bornée). |
| `probability` | number | IdC en **%** (0–100) ; défaut selon l'étape. |
| `mbPrev` | number | **MB prévisionnel** = marge brute en **%** (0–100, bornée). Alias acceptés : `mb`, `margin`, `marge`. Miroir de la colonne « MB » du LIVE Excel — sert de repli de marge au carnet (ADR-056). Écrit **seulement si fourni ET numérique** (n'écrase pas une valeur saisie ; « N/A » ignoré). |
| `closingDate` | string | `AAAA-MM-JJ` (dates sentinelles rejetées). |
| `dateCreation` | string | Date de création Odoo (`create_date`), `AAAA-MM-JJ` (alias `createdDate`). |

### object = "order"  →  collection `orders`
Rapprochement : id **déterministe** `safeId(fp)` (converge avec l'import P&L). **`fp` requis.**

| Champ | Type | Notes |
|---|---|---|
| `odooId` | string | id Odoo (`sale.order:9`) — tracé. |
| `fp` | string | **requis**. |
| `client` | string | |
| `designation` | string | Objet de l'affaire. |
| `bu` | string | |
| `dateCommande` | string | **Date de commande** Odoo (`date_order`), `AAAA-MM-JJ` (alias `datePo`, `dateOrder`). |
| `yearPo` | number | Millésime (fenêtré par `plausibleYear`) ; **dérivé de `dateCommande`** si absent. |
| `cas` | number | Chiffre d'affaires signé (entier XOF). |
| `raf` | number | RAF figé (optionnel ; **absent → `null`** = repli dérivé conservé). |
| `suppliers` | array | `[{ name, amount }]` (noms vides/montants ≤ 0 ignorés). |
| `dateCreation` | string | Date de création Odoo (`create_date`), `AAAA-MM-JJ` (alias `createdDate`). |

### object = "invoice"  →  collection `invoices`
Rapprochement : id **déterministe** `safeId(numero)`. **`numero` requis** ; `fp` sert au rapprochement d'affaire.

| Champ | Type | Notes |
|---|---|---|
| `odooId` | string | id Odoo (`account.move:100`) — tracé. |
| `numero` | string | **requis** (n° de facture). |
| `fp` | string | N° FP rapproché (`fpKey`). |
| `client` | string | |
| `amountHt` | number | Montant HT. |
| `bu` | string | |
| `date` | string | `AAAA-MM-JJ` (sentinelles rejetées). |
| `dueDate` | string | Échéance. |
| `paid` | bool/string | `true` ou libellé (`payé`, `réglé`, `encaissé`…). |
| `dateCreation` | string | Date de création Odoo (`create_date`), `AAAA-MM-JJ` (alias `createdDate`). |

### object = "bc"  →  collection `bcLines` (bon de commande fournisseur)
Rapprochement : id **déterministe** par **N° BC canonique** (`bc_odoo_<bcKey>`). **`bcNumber` requis** ; `fp`
rattache l'affaire. **Priorité « comptable/ClickUp prime » (ADR-051)** : si un BC d'une autre source (saisie,
PDF, import comptable, ClickUp) porte **déjà** ce N° BC (au séparateur près), le BC Odoo est **ignoré** (`action:
"skipped"`) — sinon le SOA fournisseur double-compterait l'engagement. Doc **additif** : n'envoyez que les champs
connus (un `update` partiel ne réécrit pas le reste). Le **statut** ne pose QUE de l'engagement
(`a_emettre`/`emis`/`livre`) — jamais `facture`/`solde` (le solde du compte fournisseur reste un acte comptable).

| Champ | Type | Notes |
|---|---|---|
| `odooId` | string | id Odoo (`purchase.order:55`) — tracé. |
| `bcNumber` | string | **requis** (N° BC ; canonicalisé `bcKey`). |
| `fp` | string | N° FP rattaché (`fpKey`). |
| `supplier` | string | Fournisseur (`cleanName`, MAJUSCULES). |
| `customer` | string | Client final éventuel. |
| `country`, `expenseType`, `description` | string | Métadonnées. |
| `currency` | string | Devise ISO (`XOF` par défaut) ; convertie en XOF via `config/fxRates`. |
| `amount` | number | Montant en devise. |
| `amountXof` | number | Contre-valeur XOF **saisie** (prioritaire sur la conversion). |
| `status` | string | Engagement : `a_emettre`/`emis`/`livre`/`annule` (autre valeur → `emis`). `annule` sort le BC des engagements/du cash — la charge planifiée reste au P&L. |
| `eta` | string | ETA **réelle** `AAAA-MM-JJ` (alias `etaReel`). |
| `etaContrat` | string | ETA **contractuelle** `AAAA-MM-JJ` (engagement, distincte de l'ETA réelle). |
| `dateIn` | string | Date d'entrée `AAAA-MM-JJ`. |
| `updateDate` | string | Date de dernière mise à jour côté Odoo `AAAA-MM-JJ`. |
| `comment` | string | Note libre (miroir du champ `comment` des lignes BC). |
| `dc` | string | Identifiant DC propre (Odoo) — capté additivement ; le FP reste la clé de rapprochement. Voir **rapprochement DC** ci-dessous. |

**Rapprochement DC → N° FP (ADR-054).** Cas normal : Odoo envoie **`fp` ET `dc`** → le `fp` fait foi.
Filet pour les BC dont le `fp` est absent/placeholder (rejeté par `fpKey`) mais qui portent un `dc` connu :
un overlay curé côté nt360 (`config/dcAliases`, alimenté par un data-steward via l'écran *Assainissement →
Rapprochement DC → N° FP*) rattache alors le BC à l'affaire. Non destructif, survit aux ré-imports. Le `fp`
explicite d'Odoo **prime toujours** sur l'overlay.

### object = "partner"  →  base client de référence `config/clientsRef` (ADR-075)
Enregistre un **client** créé côté Odoo dans la **base de référence** (dénominateur du **taux de couverture**,
écran *Base Clients*). Aucune collection propre : on **additionne** la **clé canonique** du nom (mêmes règles que
le recompute : `canonicalKey` + alias `config/clientAliases`) à `config/clientsRef.keys` via `arrayUnion` — **additif,
jamais de retrait** (un client sans affaire y reste et compte en « inactif » jusqu'à sa 1ʳᵉ commande). Idempotent
(renvoi = même clé). Déclenche un recompute différé (le taux de couverture se rafraîchit).

| Champ | Type | Notes |
|---|---|---|
| `name` | string | **requis** — nom du client (alias `client`, `display_name`). Canonicalisé (MAJUSCULES, formes juridiques/pays retirées). |
| `odooId` | string | id Odoo (`res.partner:1234`) — tracé dans l'`auditLog`, non stocké dans la base. |

Un client **sans nom** est rejeté (`errors[]`). Le montant/le CA ne sont **pas** attendus ici (l'activité vient
des commandes/factures/opps) — l'objet `partner` ne fait qu'**élargir la base de référence**.

## Réponse

```json
{ "ok": true, "object": "order", "written": 3, "failed": 0, "truncated": false,
  "results": [ { "id": "FP_2026_12", "object": "order", "action": "created"|"updated", "fp": "FP/2026/12" } ],
  "errors":  [ { "error": "commande : 'fp' (N° FP) requis", "odooId": "sale.order:9" } ] }
```

Chaque écriture est journalisée (`auditLog`, action `odoo_create`/`odoo_update`). Un **recompute différé**
(coalescé) est déclenché une fois par lot. Les enregistrements invalides sont signalés sans faire échouer le
lot (`errors[]`) ; une erreur interne renvoie `500`.

## Champs communs écrits par nt360

Tout doc reçu porte `source: "odoo"`, `odooId`, `updatedAt` (et `createdAt` à la création). Les
normalisations (FP, client, BU, dates, montants) sont **identiques** à celles des imports Excel → Odoo et
Excel convergent sur les mêmes documents (pas de seconde vérité).

> `createdAt` (posé par nt360, `serverTimestamp`) = **quand nt360 a vu le doc pour la première fois**. Il ne
> faut pas le confondre avec `dateCreation`, la **date de création côté Odoo** (`create_date`) transmise dans
> le contrat : c'est cette dernière qui reflète l'antériorité métier de l'affaire/commande/facture.

---

# Guide d'implémentation — côté Odoo

Cette partie s'adresse au **développeur Odoo**. nt360 est déjà prêt à recevoir ; il reste à **émettre**
depuis Odoo (opportunités, commandes, factures, BC fournisseurs) vers l'endpoint `odooWebhook`, signé HMAC.
Deux modes : **temps réel** (Automated Actions, §4) et **backfill complet paginé** (Server Action, §4bis).

## 0. Prérequis (à récupérer auprès de nt360 / Direction)

| Élément | Où | Remarque |
|---|---|---|
| **URL** `odooWebhook` | console Firebase → Functions | `https://odoowebhook-hap6lozbqq-uc.a.run.app` |
| **Secret partagé** | posé côté nt360 via `setOdooWebhook({ secret })` | ≥ 16 caractères ; **la même valeur** doit être stockée côté Odoo. Générer p. ex. `openssl rand -hex 32`. |

Le secret est **write-only** côté nt360 (jamais relu). Convenez-le une fois, stockez-le des deux côtés.

## 1. Stocker le secret dans Odoo (jamais en clair dans le code)

Paramètre système (`Paramètres techniques → Paramètres système`), clé **`nt360.webhook_secret`**, valeur = le
secret partagé. Idem pour l'URL, clé **`nt360.webhook_url`**. Lecture dans le code :

```python
ICP    = env["ir.config_parameter"].sudo()
SECRET = ICP.get_param("nt360.webhook_secret")
URL    = ICP.get_param("nt360.webhook_url")
```

## 2. Server Action générique (signe + envoie)

Une **Server Action** (`ir.actions.server`, type *code Python*) réutilisable, appelée par les Automated
Actions de chaque modèle. Elle construit le corps, **signe les octets exacts** transmis, poste, et loggue.

```python
import hmac, hashlib, json
import urllib.request, urllib.error

def _nt360_send(env, obj, records):
    """obj: 'opportunity'|'order'|'invoice' ; records: list[dict] déjà mappés au contrat nt360."""
    ICP    = env["ir.config_parameter"].sudo()
    secret = ICP.get_param("nt360.webhook_secret")
    url    = ICP.get_param("nt360.webhook_url")
    if not secret or not url:
        raise UserError("nt360 : secret ou URL manquant (ir.config_parameter)")

    # Corps BRUT : ce sont CES octets qui sont signés ET envoyés (ne re-sérialisez pas ailleurs).
    body = json.dumps({"object": obj, "records": records},
                      separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    sig  = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()

    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "X-Signature":  sig,
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read() or b"{}")
            env["ir.logging"].sudo().create({
                "name": "nt360.webhook", "type": "server", "level": "INFO",
                "dbname": env.cr.dbname, "func": obj, "line": "0", "path": "nt360",
                "message": "nt360 OK: %s" % json.dumps(payload),
            })
    except urllib.error.HTTPError as e:
        # 401 signature, 503 non configuré, 400 contrat, 500 interne — voir « Réponse » plus haut.
        raise UserError("nt360 %s: %s" % (e.code, e.read().decode("utf-8", "ignore")))
```

> **Le piège n°1** : signer une chaîne différente de celle envoyée → `401`. Ici `body` est signé **et**
> passé tel quel à `data=` : garanti identique. N'utilisez pas une lib qui re-sérialise le JSON à l'envoi.

## 3. Mapper chaque modèle Odoo vers le contrat nt360

Renseignez **au minimum les champs requis** (`fp` **ou** `odooId` pour l'opportunité ; `fp` pour la
commande ; `numero` pour la facture). Adaptez les accès aux **champs personnalisés** de votre base (le N° FP
et la BU sont souvent des champs `x_studio_…` — remplacez les `TODO` par vos noms réels).

```python
def _fp(rec):        return rec.x_studio_fp or ""        # TODO: votre champ N° FP (FP/AAAA/N)
def _bu(rec):        return rec.x_studio_bu or ""         # TODO: votre champ Business Unit
def _dc(rec):        return rec.x_studio_dc or ""         # TODO: votre champ N° DC (réf. externe, EN PLUS du FP)
def _iso(d):         return d and str(d)[:10] or ""       # date/datetime Odoo → 'AAAA-MM-JJ'
STAGE_MAP = {"New": 1, "Qualified": 2, "Proposition": 3, "Négociation": 4, "Won": 6, "Lost": 5}  # TODO: vos étapes → 1..6

# crm.lead → opportunity
def map_lead(l):
    return {
        "odooId": "crm.lead:%s" % l.id,
        "fp": _fp(l), "client": l.partner_id.name or l.contact_name or "",
        "designation": l.name or "",                       # nom / objet de l'affaire
        "am": l.user_id.name or "", "bu": _bu(l),
        "amount": l.expected_revenue or 0,
        "stage": STAGE_MAP.get(l.stage_id.name, 1),
        "probability": l.probability or 0,                # IdC en % (0-100)
        "mbPrev": l.margin_percent or None,               # MB prévisionnel = marge brute en % (0-100), optionnel
        "closingDate": _iso(l.date_deadline),
        "dc": _dc(l),                                     # réf. externe DC (optionnel, en plus du FP)
        "dateCreation": _iso(l.create_date),              # date de création Odoo
    }

# sale.order → order  (cas = HT signé ; suppliers optionnel)
def map_order(o):
    return {
        "odooId": "sale.order:%s" % o.id,
        "fp": _fp(o), "client": o.partner_id.name or "",
        "designation": o.name or "", "bu": _bu(o),
        "dateCommande": _iso(o.date_order),               # date de commande (complète) — yearPo en est dérivé
        "yearPo": o.date_order.year if o.date_order else 0,
        "cas": o.amount_untaxed or 0,
        # "raf": ...,                                      # omettre → nt360 garde son RAF dérivé
        # "suppliers": [{"name": .., "amount": ..}],       # optionnel
        "dc": _dc(o),                                     # réf. externe DC (optionnel, en plus du FP)
        "dateCreation": _iso(o.create_date),              # date de création Odoo
    }

# account.move (facture client) → invoice
def map_invoice(m):
    return {
        "odooId": "account.move:%s" % m.id,
        "numero": m.name or "", "fp": _fp(m),
        "client": m.partner_id.name or "",
        "amountHt": m.amount_untaxed or 0, "bu": _bu(m),
        "date": _iso(m.invoice_date), "dueDate": _iso(m.invoice_date_due),
        "paid": m.payment_state == "paid",
        "dc": _dc(m),                                     # réf. externe DC (optionnel, en plus du FP)
        "dateCreation": _iso(m.create_date),              # date de création Odoo
    }

# purchase.order → bc  (bon de commande fournisseur ; N° BC requis ; statut d'ENGAGEMENT seulement)
def map_bc(p):
    # état Odoo → statut d'engagement nt360 (jamais 'facture'/'solde' : le solde reste un acte comptable).
    # 'cancel' → 'annule' : le BC sort des engagements, la charge planifiée reste au P&L (ADR-068).
    status = "annule" if p.state == "cancel" else ("livre" if p.state == "done" else ("emis" if p.state == "purchase" else "a_emettre"))
    return {
        "odooId": "purchase.order:%s" % p.id,
        "bcNumber": p.name or "",                          # N° BC (requis)
        "fp": _fp(p), "supplier": p.partner_id.name or "",
        "description": p.origin or p.name or "",
        "currency": p.currency_id.name or "XOF",           # converti en XOF côté nt360 (config/fxRates)
        "amount": p.amount_untaxed or 0,
        "status": status,
        # "eta": _iso(p.date_planned),                     # ETA RÉELLE (date d'arrivée) si dispo
        # "etaContrat": _iso(p.date_order),                # ETA CONTRACTUELLE (engagement) si dispo
        # "comment": p.notes or "",                        # note libre éventuelle
        "updateDate": _iso(p.write_date),                  # date de dernière MàJ Odoo
        "dc": _dc(p),                                      # réf. externe DC (en plus du FP ; sert de filet de rapprochement)
        "dateCreation": _iso(p.create_date),
    }
```

Exemple d'appel dans une Server Action déclenchée sur `sale.order` :

```python
_nt360_send(env, "order", [map_order(r) for r in records])   # `records` = recordset déclencheur
```

## 4. Déclencher l'envoi (Automated Actions)

Une *Automated Action* (`base.automation`) par modèle, **sur création et mise à jour** :

| Modèle | Déclencheur | Action |
|---|---|---|
| `crm.lead` | À la création & mise à jour | Server Action → `_nt360_send(env, "opportunity", [map_lead(r) for r in records])` |
| `sale.order` | À la création & mise à jour | `_nt360_send(env, "order", [map_order(r) for r in records])` |
| `account.move` | À la validation (`state == 'posted'`) & mise à jour | `_nt360_send(env, "invoice", [map_invoice(r) for r in records])` |
| `purchase.order` | À la confirmation (`state in ('purchase','done')`) & mise à jour | `_nt360_send(env, "bc", [map_bc(r) for r in records])` |

- **Idempotence** : renvoyer le même enregistrement est sans danger — nt360 fait un **upsert** sur un id
  déterministe (`fp`/`numero`/N° BC) ou par rapprochement `fp`→`odooId`. Aucun doublon.
- **Lots** : ≤ **500** `records` par requête (au-delà : `truncated: true`). Pour un backfill massif,
  paginez côté Odoo (voir §4bis).
- **Fiabilité** : `odooWebhook` est synchrone. En cas d'erreur réseau/`5xx`, prévoyez un **rejeu** (file /
  `queue_job`), le renvoi étant idempotent. Un `4xx` (401/400) est une erreur de configuration/contrat à
  corriger, pas à rejouer en boucle.

## 4bis. Rattrapage / re-synchronisation complète (backfill paginé)

Le webhook temps réel (§4) couvre les **créations & mises à jour** au fil de l'eau. Pour un **premier
chargement** ou une **re-synchro complète** (« tirer tout Odoo vers nt360 »), pas besoin de client sortant
côté nt360 : une **Server Action** côté Odoo itère les enregistrements et les POSTe **par lots de ≤ 500**
vers le même endpoint. Idempotent → rejouable sans créer de doublon. Lancez-la manuellement (bouton d'action)
ou via une **action planifiée** (`ir.cron`), p. ex. une fois par nuit en filet de sécurité.

```python
# Server Action « nt360 — backfill complet ». À exécuter sur un modèle quelconque (le recordset est ignoré).
BATCH = 500  # ≤ ODOO_MAX_RECORDS
PLAN = [
    ("crm.lead",       "opportunity", map_lead,    []),                                  # toutes les opps
    ("sale.order",     "order",       map_order,   [("state", "!=", "cancel")]),         # commandes non annulées
    ("account.move",   "invoice",     map_invoice, [("move_type", "=", "out_invoice"),   # factures CLIENT
                                                    ("state", "=", "posted")]),          # validées
    ("purchase.order", "bc",          map_bc,      [("state", "in", ("purchase", "done"))]),  # BC confirmés
]
for model, obj, mapper, domain in PLAN:
    Model  = env[model].sudo()
    ids    = Model.search(domain).ids            # ordre stable ; adaptez le domaine à votre besoin
    for i in range(0, len(ids), BATCH):
        recs = Model.browse(ids[i:i + BATCH])
        _nt360_send(env, obj, [mapper(r) for r in recs])   # signé + posté (cf. §2)
```

> **Delta au lieu de tout** : pour ne renvoyer que les enregistrements récents, ajoutez au `domain` un filtre
> sur `write_date`, p. ex. `("write_date", ">", last_sync_iso)` où `last_sync_iso` est mémorisé dans un
> `ir.config_parameter` (`nt360.last_backfill`) mis à jour en fin de run. Le renvoi restant idempotent, un
> chevauchement de fenêtre est sans danger.

## 4ter. Renvoi UNITAIRE d'un BC (par DC ou sélection)

Cas d'usage : nt360 vient de poser un **rapprochement DC → N° FP** (Centre de correction) et l'on veut que
le BC concerné soit rattaché **tout de suite**, sans attendre la prochaine mise à jour Odoo ni relancer le
backfill complet. Même principe que §4bis (c'est **Odoo qui pousse** — aucun client sortant côté nt360),
mais borné à un enregistrement (ou à la sélection courante). Idempotent → rejouable sans doublon.

```python
# Server Action « nt360 — renvoyer les BC sélectionnés » : à exécuter sur purchase.order.
# Depuis la vue liste Odoo : cochez le(s) BC → Action → « nt360 — renvoyer les BC sélectionnés ».
recs = records or env["purchase.order"].sudo().search([("name", "=", "DC00123")])  # repli : un DC précis
_nt360_send(env, "bc", [map_bc(r) for r in recs])
```

> Fonctionne pour n'importe quel objet du contrat (remplacez modèle + mapper : `map_lead`/`map_order`/
> `map_invoice`). Côté nt360, l'écran **Admin → Intégration** affiche le **dernier envoi reçu** (horodatage,
> objet, écrits/échecs) — le moyen de vérifier que le renvoi est bien arrivé.

### Contexte DC & seed initial de la table FP–DC

Dans Odoo, le **DC est généré depuis le FP** (bouton « Générer DC ») puis **toutes les dépenses du projet**
(BC fournisseurs, décaissements, astreintes…) sont rattachées au DC — la correspondance FP↔DC existe donc
**à la source** pour le flux courant (le webhook envoie `fp` + `dc`). Pour l'**historique** antérieur au
branchement : exportez la table de correspondance (deux colonnes FP / DC, ordre libre, .xlsx ou .csv) et
importez-la dans **Qualité & correction → Centre de correction → Rapprochement DC → « Seed initial »**
(aperçu dry-run, puis application). Règle de conflit : un rapprochement **déjà posé dans nt360 prime** —
le fichier ne l'écrase jamais, le conflit est signalé pour arbitrage manuel. Les BC historiques à DC connu
se rattachent au recalcul qui suit l'import.

## 5. Tester l'endpoint AVANT de brancher Odoo (curl signé)

```bash
SECRET='le-secret-partagé'
URL='https://odoowebhook-hap6lozbqq-uc.a.run.app'
BODY='{"object":"order","records":[{"fp":"FP/2026/12","client":"ACME","cas":12000000,"bu":"ICT"}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')
curl -sS -X POST "$URL" -H 'Content-Type: application/json' -H "X-Signature: $SIG" --data "$BODY"
# Attendu : {"ok":true,"object":"order","written":1,...}
```

`printf '%s'` (sans saut de ligne final) garantit que les octets signés = les octets envoyés.

## Diagnostic des réponses

| Code | Signification | À faire |
|---|---|---|
| `200 {ok:true, written, failed, errors[]}` | Traité (voir `errors[]` pour les lignes rejetées) | Vérifier `failed`/`errors` : champ requis manquant, objet inconnu… |
| `200 {ignored:"integration disabled"}` | Kill-switch `enabled:false` côté nt360 | Demander l'activation (`setOdooWebhook({ enabled:true })`) |
| `401 signature invalide` | HMAC faux | Même secret ? Octets signés = octets envoyés ? En-tête `X-Signature` en **hex** ? |
| `503 webhook non configuré` | Aucun secret posé côté nt360 | Direction : `setOdooWebhook({ secret })` |
| `400 aucun enregistrement` | `records[]` vide | Envoyer `records: [ {…} ]` (ou `record: {…}`) |
| `405` | Méthode ≠ POST | Utiliser `POST` |

## Checklist de mise en service

- [ ] Secret partagé généré, posé côté nt360 (`setOdooWebhook`) **et** dans `ir.config_parameter` Odoo.
- [ ] `nt360.webhook_url` renseignée (URL déployée de `odooWebhook`).
- [ ] Test `curl` signé → `200 {ok:true}`.
- [ ] Champs `x_studio_fp` / `x_studio_bu` (ou équivalents) mappés dans `_fp`/`_bu`.
- [ ] Table `STAGE_MAP` alignée sur vos étapes CRM → **1..6** (6 = gagné).
- [ ] 3 Automated Actions (lead / order / invoice) sur création **et** mise à jour.
- [ ] Rejeu prévu sur erreur réseau/`5xx` (renvoi idempotent).
- [ ] Backfill initial paginé par lots ≤ 500.
