---
description: Phase 0 — Cartographier l'ERP existant avant d'y toucher
---

# Phase 0 — Empreinte de l'existant

**Tu ne dois écrire aucun code applicatif dans cette phase. Aucun. Le seul fichier que tu
produis est `docs/contrats/01-EXISTANT.md`.**

Ta mission : comprendre l'ERP mieux que ne le ferait un développeur qui y arrive. Tu n'es pas
là pour juger le code, ni pour proposer des améliorations. Tu es là pour établir une carte
exacte, y compris de ce que tu n'as pas compris.

## Méthode

Procède dans cet ordre, sans sauter d'étape.

### 1. Le squelette
- Lance `./scripts/empreinte.sh` et lis sa sortie.
- Fichiers de manifeste : `package.json`, `composer.json`, `pom.xml`, `requirements.txt`,
  `*.csproj`, `Gemfile`, `go.mod`. Identifie **langage, framework, ORM, moteur de tests,
  outil de build, gestionnaire de migrations**.
- Lis le `README`, tout `docs/`, tout `CONTRIBUTING`, et les commentaires d'en-tête des
  fichiers les plus anciens : c'est souvent là que sont les intentions.
- `git log --format='%an' | sort | uniq -c | sort -rn | head` : qui a construit quoi.
- `git log --format='%ad' --date=short | tail -1` et `| head -1` : l'âge du projet.

### 2. Les couches
Identifie et nomme, avec les chemins réels :
- Où sont les **modèles / entités**
- Où sont les **services / logique métier**
- Où sont les **contrôleurs / points d'entrée**
- Où sont les **vues / composants d'interface**
- Où sont les **migrations**
- Où sont les **tests**
- Où sont les **tâches planifiées / batchs**
- Où est la **configuration**

### 3. Le schéma de données
- Reconstitue la liste des tables depuis les migrations ou les entités ORM.
- Repère en priorité : **tiers/clients**, **factures**, **règlements**, **achats/commandes**,
  **plan comptable et analytique**, **devises et taux**, **employés et coûts**, **projets ou
  affaires**, **temps passé**, **documents joints**, **utilisateurs et droits**, **journal
  d'audit**, **séquences de numérotation**, **calendriers**.
- Pour chacune : nom exact, clé primaire, colonnes structurantes, relations.
- Note les **conventions de nommage** : casse, préfixes, singulier/pluriel, langue.

### 4. Les mécanismes transverses
Cherche activement, avec plusieurs vocabulaires (fr/en/abrégé maison) :
- Authentification et **moteur de droits** — comment une permission est déclarée et vérifiée
- **Workflow / validation / approbation** — existe-t-il un moteur générique ?
- **Notifications** — mail, SMS, in-app
- **Ordonnanceur** — cron, queue, jobs
- **Journal d'audit** — qui a changé quoi, quand
- **Numérotation** — comment une facture obtient son numéro
- **Gestion documentaire** — comment une pièce jointe est stockée
- **Exports et reporting** — quel outil, quel format
- **Internationalisation** et gestion multi-pays
- **Multi-devises** — où sont les taux, comment ils sont appliqués

### 5. Les zones dangereuses
- Quels fichiers sont les plus modifiés (`git log --format=format: --name-only | sort | uniq -c | sort -rn | head -20`) ? Ce sont les zones sensibles.
- Quels fichiers n'ont aucun test ?
- Y a-t-il des tables sans contrainte d'intégrité, des colonnes fourre-tout, des champs JSON ?
- Y a-t-il du code manifestement contourné (`// ne pas toucher`, `TODO`, `HACK`, code commenté) ?

### 6. Le rituel de développement
- Comment on lance les tests ? Comment on lance une migration ? Comment on démarre en local ?
- Y a-t-il une CI ? Que fait-elle ?
- Y a-t-il un environnement de recette ?

## Livrable

Remplis `docs/contrats/01-EXISTANT.md` en suivant exactement sa structure. Règles :

- **Chaque affirmation est adossée à un chemin de fichier réel.** Pas de généralité.
- **La section « Ce que je n'ai pas compris » est obligatoire et ne doit pas être vide.**
  Un audit sans zone d'ombre est un audit qui n'a pas cherché.
- **Aucune recommandation.** Tu décris, tu ne conseilles pas. Le conseil, c'est la phase 2.
- Si l'ERP est trop gros pour être lu entièrement, dis-le et explique ta stratégie
  d'échantillonnage.

## Fin de phase

Termine par un résumé de 10 lignes maximum, puis :

> **Phase 0 terminée. `01-EXISTANT.md` est à relire et à corriger — il contient forcément des
> erreurs, notamment sur les règles métier que le code ne dit pas. Validez-le avant `/1-regles`.**

Puis arrête-toi.
