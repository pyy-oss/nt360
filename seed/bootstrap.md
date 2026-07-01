# Bootstrap — amorçage du socle (BUILD_KIT §14, §15 F0)

## 1. Écrire la matrice de droits dans `config/permissions`

La matrice (`seed/permissions.json`, conforme §8) doit exister **avant** toute règle
Firestore (les rules lisent `config/permissions`). Deux façons :

**Émulateur (dev) :**
```bash
firebase emulators:start          # dans un terminal
# puis, dans un autre terminal, script d'amorçage (Admin SDK ciblant l'émulateur) :
node seed/seed.js                 # créé en F1 ; écrit config/permissions + 1er direction
```

**Production :** exécuter le même script avec un compte de service (`GOOGLE_APPLICATION_CREDENTIALS`).

## 2. Créer le premier utilisateur `direction`

`setUserRole` exige déjà un appelant `direction` — impossible pour le tout premier admin.
Amorçage hors-ligne via l'Admin SDK (compte de service ou émulateur) :

```js
const { getAuth } = require("firebase-admin/auth");
await getAuth().setCustomUserClaims(uid, { role: "direction" });
```

Ensuite, tous les autres rôles se posent via la Cloud Function `setUserRole`
(callable, réservée `direction`, audités dans `auditLog`).

## 3. Vérification F0

- `firebase emulators:start` lève auth + firestore + functions + storage + hosting + UI.
- `config/permissions` présent (matrice §8).
- SPA vide servie sur le port hosting.

> Le script `seed/seed.js` (écriture matrice + 1er admin) est livré en **F1** (Auth & RBAC).
