# App Check — activation

App Check protège les Cloud Functions (callables) et Firestore contre les appels qui ne proviennent
pas de l'app légitime. Le **code est déjà en place** (front + back) ; il ne reste qu'à **provisionner
la clé** et **activer l'enforcement**, en **2 temps** pour ne jamais bloquer l'app.

## Ce qui est déjà câblé

- **Front** (`web/src/lib/firebase.ts`) : `initializeAppCheck` avec `ReCaptchaV3Provider`, activé
  **uniquement si** `VITE_APPCHECK_SITE_KEY` est fournie au build (sinon l'app démarre normalement,
  sans App Check). Jeton de debug automatique en émulateur.
- **Back** (`functions/index.js`, `onCallG`) : ajoute `enforceAppCheck: true` sur tous les callables
  **uniquement si** `APPCHECK_ENFORCE=true`. OFF par défaut.
- **CI** : `firebase-deploy.yml` et `firebase-preview.yml` injectent `VITE_APPCHECK_SITE_KEY` depuis le
  **secret** `APPCHECK_SITE_KEY` ; le déploiement écrit `functions/.env` avec `APPCHECK_ENFORCE` depuis
  la **variable de dépôt** `APPCHECK_ENFORCE`.

## Étape 1 — déployer les jetons (sans enforcement)

But : que l'app émette des jetons App Check valides **avant** d'exiger leur présence.

1. **Console Firebase → App Check → Apps** : enregistrer l'app Web avec le fournisseur
   **reCAPTCHA v3**. Créer/copier la **clé de site** reCAPTCHA v3 (console reCAPTCHA, domaine =
   `nt360.web.app` + domaines de preview `*.web.app`).
2. **GitHub → Settings → Secrets and variables → Actions** :
   - **Secret** `APPCHECK_SITE_KEY` = la clé de site reCAPTCHA v3.
   - (laisser la **variable** `APPCHECK_ENFORCE` absente ou à `false`.)
3. Pousser sur `main` (ou relancer le déploiement). L'app buildée porte désormais la clé et émet des
   jetons. Vérifier dans **Console → App Check → Métriques** que des requêtes **vérifiées** arrivent.

## Étape 2 — activer l'enforcement

Une fois les métriques App Check majoritairement « vérifiées » (trafic légitime qui envoie des jetons) :

1. **GitHub → Settings → Variables → Actions** : créer la **variable** `APPCHECK_ENFORCE` = `true`.
2. Relancer le déploiement `main`. Les callables exigent désormais un jeton valide.
3. (Optionnel mais recommandé) Activer l'**enforcement** aussi côté **Console Firebase → App Check**
   pour Cloud Functions et Firestore.

## Revenir en arrière

Mettre la variable `APPCHECK_ENFORCE` à `false` (ou la supprimer) et redéployer : l'enforcement
serveur est désactivé sans toucher au code. En cas d'urgence, on peut aussi désactiver l'enforcement
depuis la **Console Firebase → App Check** le temps de diagnostiquer.

## Dev local

En émulateur (`VITE_USE_EMULATORS=true`), un **jeton de debug** est activé automatiquement
(`FIREBASE_APPCHECK_DEBUG_TOKEN`). L'enregistrer dans **Console → App Check → Jetons de debug** si on
teste contre le back réel.
