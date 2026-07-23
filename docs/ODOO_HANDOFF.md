# Passation — branchement webhook Odoo → nt360

Message prêt à transmettre au **développeur Odoo**. Autoporteur : il contient le nécessaire
pour démarrer et renvoie au guide complet [`docs/ODOO_WEBHOOK.md`](./ODOO_WEBHOOK.md) pour le détail
(Server Action générique, mappers par modèle, backfill paginé, diagnostic des réponses).

> **Aucun secret dans ce fichier.** Le secret partagé se génère et se convient une fois, hors dépôt
> (cf. §2). Ne jamais committer sa valeur.

---

**Objet : Branchement webhook Odoo → nt360 (opportunités / commandes / factures / BC / clients)**

Bonjour,

nt360 est **prêt à recevoir** les données Odoo en temps réel via un endpoint HTTP signé. Côté nt360,
rien à installer : il te reste à **émettre** depuis Odoo. Le guide d'implémentation complet est dans le
dépôt : **`docs/ODOO_WEBHOOK.md`**. Résumé pour démarrer :

## 1. Endpoint

```
POST https://odoowebhook-hap6lozbqq-uc.a.run.app
Content-Type: application/json
X-Signature: <HMAC-SHA256 hex du corps BRUT, clé = secret partagé>
```

## 2. Secret partagé

Généré côté nt360 (`openssl rand -hex 32`), posé via le callable `setOdooWebhook({ secret, enabled: true })`,
puis communiqué par un canal sûr. À stocker dans Odoo en `ir.config_parameter` clé **`nt360.webhook_secret`**
(jamais en clair dans le code). L'URL va dans **`nt360.webhook_url`**.

## 3. Contrat (corps JSON)

```json
{ "object": "opportunity|order|invoice|bc|partner", "records": [ { … } ] }
```

Champs **requis** par objet : `fp` **ou** `odooId` (opportunity) · `fp` (order) · `numero` (invoice) ·
`bcNumber` (bc) · `name` (partner). Tout est **additif et idempotent** (upsert sur clé déterministe) —
rejouer un enregistrement ne crée jamais de doublon.

> **⚠️ Point critique — mapping des étapes CRM.** L'échelle nt360 est **1..9** :
> `1 Qualification · 2 Montage · 3 Transmise · 4 Négociation · 5 Contractualisation · 6 Gagné ·
> 7 Perdu · 8 Suspendu · 9 Annulé`. Un deal **perdu = 7** (jamais 5). Si Odoo marque le perdu par
> `active=False`, force `stage=7`. (Détail + helper `_stage()` dans le guide.)

## 4. Test AVANT de brancher (curl signé)

```bash
SECRET='<le-secret-partagé>'
URL='https://odoowebhook-hap6lozbqq-uc.a.run.app'
BODY='{"object":"order","records":[{"fp":"FP/2026/12","client":"ACME","cas":12000000,"bu":"ICT"}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')
curl -sS -X POST "$URL" -H 'Content-Type: application/json' -H "X-Signature: $SIG" --data "$BODY"
# Attendu : {"ok":true,"object":"order","written":1,...}
```

`printf '%s'` (sans saut de ligne) garantit que les octets signés = les octets envoyés.
**Piège n°1** : signer une chaîne différente de celle envoyée → `401`.

## 5. Mise en service (checklist)

- [ ] Secret posé des deux côtés + `nt360.webhook_url` renseignée.
- [ ] Test `curl` signé → `200 {ok:true}`.
- [ ] Champs custom mappés (`x_studio_fp`, `x_studio_bu`, `x_studio_dc`…).
- [ ] `STAGE_MAP` alignée → 1..9 (6 = gagné, **7 = perdu**, 8/9 suspendu/annulé).
- [ ] **4 Automated Actions** (`crm.lead` / `sale.order` / `account.move` / `purchase.order`) sur création
      **et** mise à jour, **+ `res.partner`** (`customer_rank>0`) si tu alimentes la base clients.
- [ ] Rejeu prévu sur erreur réseau/`5xx` (renvoi idempotent).
- [ ] Backfill initial paginé par lots ≤ 500 (Server Action, §4bis du guide).

Codes de réponse : `200 ok` (voir `errors[]` pour les lignes rejetées) · `401` signature ·
`503` webhook non configuré/désactivé · `400` corps vide · `405` méthode ≠ POST.

Dispo pour caler le secret et vérifier le premier envoi ensemble : l'écran **Admin → Intégration** côté
nt360 affiche le dernier envoi reçu (horodatage, objet, écrits/échecs).
