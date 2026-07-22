# Migration nt360 → neurones-360 — scripts

Outillage **versionné et idempotent** pour la migration (cf. `docs/MIGRATION_PROJET.md`). But : ne **rien
taper à la main** — lire, valider, exécuter dans l'ordre. Le projet cible `neurones-360` étant **vide**
(personne ne s'en sert), on va direct, sans répétition sur base jetable ; on garde les deux protections
gratuites : `--database=nt360` en dur (impossible de se tromper de base) et le **gate de parité** en fin.

## Séquence

| # | Commande | Ce que ça fait | Qui |
|---|---|---|---|
| 1 | `bash scripts/migrate/00-provision.sh` | APIs + PITR + buckets + secrets + **IAM rigoureux** (SA déploiement + SA Compute + agents) | ops (owner GCP) |
| 2 | *Actions → « Firebase Deploy V2 » → Run workflow* | déploie `neurones-360` à blanc (rules + indexes + functions + hosting) | ops (GitHub) |
| 3 | Smoke `https://neurones-360.web.app` | l'app charge (base **vide** — normal) | ops |
| 4 | `bash scripts/migrate/10-data.sh` | export→import Firestore + rsync Storage + export Auth | ops |
| 5 | compléter l'import **Auth** (params de hash, cf. commentaire du script) | comptes + mots de passe | ops |
| 6 | `… node seed/migrate-claims-cross.js` | transfère les claims `nt360Role` | ops |
| 7 | déclencher un **recompute** complet (app, Admin ▸ Exploitation) | reconstruit `summaries/*` | ops |
| 8 | `… node seed/verify-parity.js` | **GATE** : parité des comptes par collection ancien↔neuf | ops |
| 9 | couplages externes (webhooks ClickUp/Odoo) + cutover variables/DNS | bascule | ops |

Avant la 1re commande, renseigner en tête de `00-provision.sh` : `DEPLOY_SA`, `BILLING_ACCOUNT_ID`. Les
scripts Node (6, 8) veulent `GOOGLE_APPLICATION_CREDENTIALS_OLD` et `_NEW` (clés SA des deux projets).

## Le seul go/no-go : la parité (étape 8)

`verify-parity.js` compte les docs par collection des **deux** bases `nt360` et signale tout écart. Écart
attendu : `summaries/*` (recalculés côté neuf, étape 7). **Tout autre écart = import incomplet → on ne
bascule pas.** C'est ce gate qui rattrape un `config/*` manquant (alias FP/DC/clients, secrets HMAC des
webhooks), des claims perdus, un import partiel.

## Piège projet neuf : quotas Cloud Run / Cloud Build (étape 2)

Un projet GCP **vierge** a des quotas par défaut très bas. Déployer ~136 functions gen2 d'un coup les
dépasse : Cloud Run refuse la majorité des révisions (`Quota exceeded for total allowable CPU per project
per region`), Cloud Functions plafonne le débit de créations (`Per project mutation requests per minute
per region`, HTTP 429) et Cloud Build met les builds en file jusqu'à `EXPIRED`. Le workflow déploie donc
en **deux étapes** : hosting + Firestore d'abord (léger, insensible aux quotas → le smoke
`neurones-360.web.app` atterrit de façon fiable), puis les functions (tolérant, retry long).

Pour faire passer **toutes** les functions, demander la hausse des quotas AVANT de relancer l'étape 2 :

| Quota | Où | Cible indicative |
|---|---|---|
| Cloud Run — *Total CPU allocation, per project per region* (région des callables : `us-central1`) | Console → IAM & Admin → Quotas | ≥ 200 |
| Cloud Run — même quota en `europe-west1` (triggers recompute/ingest) | idem | ≥ 50 |
| Cloud Functions — *per project mutation requests per minute per region* | idem | valeur par défaut ok si le retry suffit |

Les projets Blaze récents voient souvent ces quotas relevés automatiquement après le 1er usage : un
**2ᵉ run** du workflow (les functions déjà créées sont ignorées) converge alors. Sinon, ouvrir la demande
d'augmentation (approbation Google usuellement rapide) puis relancer.

## Rollback

La bascule finale n'est que **variables GitHub + DNS/URL**. L'ancien projet `propulse-business-87f7a`
reste **servant** : rollback = repointer les variables. Ne pas supprimer l'ancien projet avant plusieurs
jours de fonctionnement validé du nouveau.

## Rappels qui évitent les fautes

- **Base nommée** : `--database=nt360` des deux côtés (un import dans `(default)` = app vide).
- **Firestore natif** : export/import LevelDB, **jamais** de dump JSON (préserve Timestamp/reference).
- **App Check** : `APPCHECK_ENFORCE` reste `false` tant que la clé reCAPTCHA du domaine `neurones-360`
  n'est pas déployée **et** vérifiée sur du trafic réel (sinon tous les callables sont rejetés).
- **Secrets Firestore** : `config/odooWebhook.secret` + config ClickUp voyagent avec les données ; s'ils
  manquent après import, régénérer via Admin ▸ Intégration (les webhooks refusent sinon, HMAC).
