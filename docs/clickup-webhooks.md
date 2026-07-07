# Webhooks ClickUp temps réel (Lot 2)

Les webhooks remontent **en secondes** les changements ClickUp (statut projet, dates, champs, avancement
des bons de commande) vers Neurone360, sans attendre le tirage quotidien (`scheduledClickupPull` /
`scheduledBcPull`, qui restent le filet de sécurité).

## Architecture

- **Un seul webhook** au niveau *workspace* ClickUp pointe vers la fonction HTTP `clickupWebhook`.
- Le handler discrimine **commande vs bon de commande** par index inverse du `task_id`
  (`config/clickupLinks` vs `config/clickupBcLinks`), met à jour l'overlay concerné
  (`config/clickupSync` ou `config/clickupBcSync`) puis recalcule le sous-ensemble d'agrégats touché.
- Les tâches **non liées** à l'app sont ignorées silencieusement.
- La requête est authentifiée par **signature HMAC-SHA256** (en-tête `X-Signature`) du corps brut avec le
  secret du webhook. Toute requête non signée valablement est rejetée (401).

## Sécurité

- Le **secret HMAC** est renvoyé par ClickUp **à la création** du webhook et stocké côté serveur dans
  `config/clickupWebhook` (jamais exposé au client — hors de l'allowlist des règles Firestore).
- Le **token API** reste dans Secret Manager (`CLICKUP_TOKEN`).
- `clickupWebhook` est public (appel serveur-à-serveur ClickUp) mais **inerte sans signature valide** ;
  App Check ne s'applique pas (réservé aux appels `onCall` du front).

## Activation (Habilitations → Intégration ClickUp → « Temps réel »)

1. Déployez les fonctions (le webhook `clickupWebhook` est inclus dans l'allowlist CI).
2. Dans **Habilitations → Intégration ClickUp**, section **Temps réel**, vérifiez que l'URL affichée
   correspond bien à celle de la fonction `clickupWebhook` déployée
   (par défaut `https://us-central1-<projet>.cloudfunctions.net/clickupWebhook`).
3. Cliquez **« Activer le temps réel »** : l'app crée le webhook côté ClickUp et enregistre le secret.
   Le badge passe à **actif**.
4. Testez : changez un statut de tâche liée dans ClickUp → l'app se met à jour en quelques secondes.

## Réenregistrement / désactivation

- Après un **redéploiement** qui changerait l'URL de la fonction, ré-enregistrez le webhook (bouton
  **« Ré-enregistrer le webhook »**).
- **« Désactiver »** supprime le webhook côté ClickUp et repasse au tirage quotidien.

## Événements souscrits

`taskStatusUpdated`, `taskUpdated` (inclut les champs personnalisés), `taskDeleted`, `taskMoved`,
`taskCreated`. Une suppression de tâche liée retire le lien et l'overlay correspondants.

---

# Enrichissements croisés (Lots 3 & 4)

## Lot 3 — app → ClickUp (synthèse + sous-tâches + checklist + tag)

Le bouton *Habilitations → Intégration ClickUp → **« Enrichir les tâches »*** (et un entretien quotidien
`scheduledClickupEnrich`) pose sur **chaque tâche commande liée** :

- Un **commentaire de synthèse idempotent** (1re ligne = marqueur `🔄 Synthèse Neurone360`) : CA signé /
  facturé (%) / RAF, anomalies **qualité**, retard de livraison, + pointeurs de comptage vers les
  jalons/BC. Retrouvé et **mis à jour** à chaque passage → jamais de doublon.
- Les **jalons de facturation** éclatés en **vraies sous-tâches** (`Jalon i · … — montant XOF`, échéance
  = date du jalon). Réconciliées par **clé stable `Jalon i`** : les manquantes sont créées, les
  divergentes mises à jour, aucune n'est supprimée (un éventuel suivi manuel est préservé).
- Les **BC fournisseurs liés** éclatés en une **checklist** « Bons de commande (n360) », **recréée à
  l'identique** à chaque passage (idempotente).
- Un **tag « à risque (n360) »** posé/retiré selon les anomalies qualité ou le retard.

## Lot 4 — ClickUp → app (avancement, priorité, blocage, temps)

`readTaskSync` remonte désormais aussi, par tâche liée : **priorité**, **blocage** (tag « bloqué »),
**avancement %** (agrégé des checklists) et **temps passé** (h). Ces champs sont fusionnés dans les
lignes *Commandes* (colonnes de détail) et alimentent un bulletin d'Actualité **« projets bloqués ou en
priorité urgente »**. Alimentés en temps réel par les webhooks (Lot 2) et par le tirage quotidien.
