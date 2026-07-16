# Webhook entrant Odoo → nt360

Reçoit les mises à jour Odoo sur les **opportunités**, **commandes** (carnet P&L) et **factures**, et les
applique dans nt360 (upsert idempotent). Odoo est **source autoritaire** : un objet inconnu est **créé**, un
objet connu est **mis à jour**.

## Endpoint

```
POST https://<région>-propulse-business-87f7a.cloudfunctions.net/odooWebhook
Content-Type: application/json
X-Signature: <hex HMAC-SHA256 du corps BRUT, clé = secret partagé>
```

L'URL exacte de la fonction est donnée après déploiement (console Firebase → Functions → `odooWebhook`).

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
{ "object": "opportunity" | "order" | "invoice", "records": [ { … } ] }
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
| `am` | string | Commercial. |
| `bu` | string | Business Unit (normalisée ; défaut `AUTRE`). |
| `amount` | number | Montant HT (entier XOF). |
| `stage` | number | Étape 1–6 (bornée). |
| `probability` | number | IdC en **%** (0–100) ; défaut selon l'étape. |
| `closingDate` | string | `AAAA-MM-JJ` (dates sentinelles rejetées). |

### object = "order"  →  collection `orders`
Rapprochement : id **déterministe** `safeId(fp)` (converge avec l'import P&L). **`fp` requis.**

| Champ | Type | Notes |
|---|---|---|
| `odooId` | string | id Odoo (`sale.order:9`) — tracé. |
| `fp` | string | **requis**. |
| `client` | string | |
| `designation` | string | Objet de l'affaire. |
| `bu` | string | |
| `yearPo` | number | Millésime (fenêtré par `plausibleYear`). |
| `cas` | number | Chiffre d'affaires signé (entier XOF). |
| `raf` | number | RAF figé (optionnel ; **absent → `null`** = repli dérivé conservé). |
| `suppliers` | array | `[{ name, amount }]` (noms vides/montants ≤ 0 ignorés). |

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
