# Accès STRICT à la base Firestore `nt360` — verrous et gestes ops

> But : la base nommée **`nt360`** (projet Firebase **partagé** `propulse-business-87f7a`) n'est accessible
> que par **cette application** (le cockpit nt360 et ses Cloud Functions), de manière stricte.

Le projet Firebase est **partagé avec une autre application** (« app sœur »). C'est le point dur : la clé
API navigateur, l'auth Firebase et l'accès Firestore sont communs au projet. Le cloisonnement repose donc
sur plusieurs couches, dont une seule (les règles) vit dans ce dépôt.

## Couche 1 — Security Rules (DANS ce dépôt, `firestore.rules`) ✅ en place

- **Aucune écriture cliente** : toutes les collections sont `allow write: if false`. Toute mutation passe
  par un **callable** (Admin SDK, qui bypass les règles) — jamais le SDK client.
- **Lectures gouvernées par la matrice opposable** (`config/permissions`) via `canRead`/`canWrite`.
- **Cloisonnement de l'app sœur** : `canRead`/`canWrite`/`isNt360()` exigent le **claim namespacé
  `nt360Role`**. Un compte authentifié par l'app sœur satisfait `signedIn()` mais **n'a pas** `nt360Role`
  → il ne lit **rien** de la base nt360. Couvert par les tests `test-rules/rules.test.js` (§ « Cloisonnement
  app sœur »).
- **Défaut = deny** : toute collection non `match`ée est refusée (comportement Firestore).

C'est la garantie « seuls les **utilisateurs provisionnés nt360** accèdent aux données ». Vérifié :
`pnpm test:rules` (77 tests, émulateur).

## Couche 2 — App Check (CONSOLE Firebase — à activer) ⏳

Les règles n'attestent pas que la requête vient du **vrai binaire de l'app** : un script muni de la clé API
publique et d'un compte nt360 valide passerait les règles. **App Check** ferme cela (attestation reCAPTCHA
Enterprise/v3 côté web).

1. Déployer la clé reCAPTCHA au client (`VITE_APPCHECK_SITE_KEY`) et initialiser App Check dans l'app web.
2. Console Firebase → **App Check** → enregistrer l'app web, puis **Enforce** sur **Cloud Firestore** ET
   **Cloud Functions** (callables).
3. Côté callables, le drapeau `APPCHECK_ENFORCE=true` (déjà câblé, `onCallG`) active l'enforcement serveur.
   ⚠️ N'activer qu'**après** (1), sinon tous les appels sont rejetés (cf. CLAUDE.md § Sécurité).

## Couche 3 — Restriction de la clé API navigateur (CONSOLE GCP) ⏳

Console GCP → **APIs & Services → Credentials → clé API du navigateur** :
- **Application restrictions** : *HTTP referrers* → limiter au domaine de hosting nt360
  (`nt360.web.app`, `nt360.firebaseapp.com`, domaine custom). Empêche l'usage de la clé depuis un autre site.
- **API restrictions** : n'autoriser que les APIs réellement utilisées (Identity Toolkit, Firestore,
  App Check, éventuellement Storage). Réduit la surface si la clé fuit.

## Couche 4 — IAM (CONSOLE/`gcloud` — audit) ⏳

L'accès **serveur** (Admin SDK) bypass les règles ; il est gouverné par IAM. À auditer :
- Seuls le **compte de service des Cloud Functions** du projet + les comptes ops strictement nécessaires
  doivent porter `roles/datastore.user` (ou `datastore.owner`) sur le projet.
- Retirer tout principal humain/externe superflu. `gcloud projects get-iam-policy propulse-business-87f7a`
  pour lister ; ne rien **modifier** sans revue de la liste exacte (cf. règles du RUNBOOK-COUTS).
- Base **nommée** `nt360` : l'IAM Firestore est au niveau **projet** (pas par base nommée) — d'où
  l'importance des couches 1–3 pour isoler la base au sein du projet partagé.

## Récapitulatif

| Couche | Où | Verrou | État |
|---|---|---|---|
| Security Rules | `firestore.rules` (dépôt) | write=false ; lecture RBAC ; **nt360Role requis** (anti app sœur) | ✅ |
| App Check | Console Firebase + client | seul le vrai binaire de l'app | ⏳ à activer |
| Clé API navigateur | Console GCP | referrers + APIs restreints | ⏳ à poser |
| IAM Firestore | Console/`gcloud` | seuls SA functions + ops | ⏳ à auditer |
