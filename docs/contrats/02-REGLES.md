# 02 — Les règles de l'existant

> **[À REMPLIR — PHASE 1]**
> Rempli par `/1-regles`. C'est le document que le module doit **respecter**, pas améliorer.
>
> **Règle d'or : la règle de l'ERP gagne.** Toujours. Même quand elle est laide, datée, ou
> contraire à ce qui se fait ailleurs. Un module conforme à l'architecture mais qui invente ses
> propres noms de colonnes, ses formats de date et ses couleurs reste un corps étranger : il
> sera reconnaissable au premier coup d'œil, contourné, puis abandonné.
>
> **Une règle n'est pas ce qui est écrit dans un guide. C'est ce que le code fait majoritairement.**
> Chaque règle ci-dessous porte son **taux de dominance** (`N/M occurrences`) et sa source.
> Une règle observée dans 4 fichiers sur 200 n'est pas une règle, c'est un accident.

## Comment cette carte a été établie

| | |
|---|---|
| Périmètre lu | |
| Stratégie d'échantillonnage | |
| Poids donné au code récent et testé | *une divergence se tranche en faveur du code le plus récent ET couvert par des tests* |
| Sources de vérité mécaniques trouvées | *(.editorconfig, eslint, prettier, phpcs, checkstyle, tailwind.config, theme, tokens…)* |

---

# A. RÈGLES DE BASE DE DONNÉES

## A.1 Nommage

| Élément | Règle observée | Dominance | Exemple réel | Source |
|---|---|---|---|---|
| Nom de table | | | | |
| Casse (snake / PascalCase / MAJ) | | | | |
| Singulier ou pluriel | | | | |
| Préfixe de module | | | | |
| Nom de colonne | | | | |
| Clé primaire | | | | |
| Clé étrangère | | | | |
| Table de liaison | | | | |
| Index | | | | |
| Contrainte unique | | | | |
| Contrainte de vérification | | | | |
| Séquence | | | | |
| Vue | | | | |
| Langue des identifiants | | | | |

## A.2 Types

> **Le piège des montants.** Si l'ERP stocke les montants en flottant, on ne le corrige pas :
> on fait pareil, et on ouvre un ADR pour signaler le risque. Une divergence de type sur les
> montants entre deux modules produit deux totaux différents pour la même question.

| Donnée | Type observé | Précision / échelle | Dominance | Source |
|---|---|---|---|---|
| Identifiant technique | | | | |
| Montant | | | | |
| Pourcentage / taux | | | | |
| Quantité / durée | | | | |
| Date seule | | | | |
| Date + heure | | | | |
| Fuseau horaire stocké ? | | | | |
| Booléen | | | | |
| Énumération (table, contrainte, ou code applicatif ?) | | | | |
| Texte court / long | | | | |
| JSON / semi-structuré | | | | |
| Fichier / pièce jointe | | | | |

## A.3 Colonnes techniques

| Colonne | Nom exact | Type | Obligatoire ? | Alimentée par | Dominance |
|---|---|---|---|---|---|
| Création (date) | | | | | |
| Création (auteur) | | | | | |
| Modification (date) | | | | | |
| Modification (auteur) | | | | | |
| Suppression logique | | | | | |
| Verrouillage optimiste (version) | | | | | |
| Société / entité | | | | | |
| Exercice | | | | | |

## A.4 Intégrité et cycle de vie

| Sujet | Règle observée | Source |
|---|---|---|
| Suppression : logique ou physique ? | | |
| Clés étrangères : contraintes en base ou en applicatif ? | | |
| Comportement `ON DELETE` | | |
| Contraintes `NOT NULL` : usage réel | | |
| Valeurs par défaut : en base ou en applicatif ? | | |
| Transactions : où sont-elles ouvertes ? | | |
| Verrouillage concurrent | | |
| Archivage / purge | | |

## A.5 Migrations

| Sujet | Règle observée | Source |
|---|---|---|
| Outil | | |
| Nommage du fichier | | |
| Réversibilité exigée ? | | |
| Migrations de données : autorisées dans le même fichier ? | | |
| Comment on ajoute une colonne à une table volumineuse | | |
| Comment on renomme (si ça s'est déjà produit) | | |
| Qui joue les migrations en production | | |

## A.6 Multi-société, multi-pays, devises

| Sujet | Règle observée | Source |
|---|---|---|
| Cloisonnement par société | | |
| Cloisonnement par pays | | |
| Devise de stockage | | |
| Devise de restitution | | |
| Où sont les taux de change | | |
| Taux fixe XOF/EUR (655,957) : où est-il ? | | |
| **Arrondi FCFA** (le franc CFA n'a pas de subdivision : 0 décimale) | | |
| Fuseau horaire de référence (Abidjan = UTC+0) | | |

---

# B. RÈGLES D'INGÉNIERIE

## B.1 Architecture

| Sujet | Règle observée | Dominance | Source |
|---|---|---|---|
| Découpage en couches | | | |
| Qui a le droit d'appeler qui | | | |
| Un contrôleur peut-il toucher la base ? | | | |
| Où vit la règle métier | | | |
| Injection de dépendances | | | |
| Structure interne d'un module | | | |
| Communication inter-modules | | | |
| Événements / hooks disponibles | | | |

## B.2 Écriture du code

| Sujet | Règle observée | Source mécanique |
|---|---|---|
| Formateur (outil, config) | | |
| Linter (outil, règles activées) | | |
| Indentation, longueur de ligne | | `.editorconfig` ? |
| Casse des classes / fichiers / fonctions / variables | | |
| Langue des identifiants de code | | |
| Langue des commentaires | | |
| Commentaires : attendus où ? | | |
| Typage : strict, partiel, absent ? | | |

## B.3 Erreurs, journalisation, validation

| Sujet | Règle observée | Source |
|---|---|---|
| Exceptions : hiérarchie maison ? | | |
| Erreurs métier vs techniques | | |
| Que renvoie une API en erreur (format, code) | | |
| Journalisation : bibliothèque, niveaux, format | | |
| Ce qu'on ne journalise jamais (données personnelles, montants ?) | | |
| Validation des entrées : où, comment | | |
| Messages d'erreur : où sont-ils stockés, en quelle langue | | |

## B.4 Tests

| Sujet | Règle observée | Source |
|---|---|---|
| Moteur | | |
| Commande | | |
| Emplacement et nommage | | |
| Types pratiqués (unitaire / intégration / bout en bout) | | |
| Jeux de données (fixtures, usines, base de test) | | |
| Base de test : réelle, en mémoire, transactionnelle ? | | |
| Couverture réelle du dépôt | | |
| Couverture attendue d'un nouveau module | | |
| Doublures : bibliothèque utilisée | | |

## B.5 Sécurité

| Sujet | Règle observée | Source |
|---|---|---|
| Authentification | | |
| Déclaration d'une permission | | |
| Vérification d'une permission (où, comment) | | |
| Cloisonnement des données par utilisateur | | |
| Protection injection SQL | | |
| Protection CSRF / XSS | | |
| Téléversement de fichier : contrôles | | |
| Secrets : où, comment | | |
| Chiffrement de colonnes sensibles | | |
| **Qui a le droit de voir un coût ou une marge** | | |

## B.6 Rituel

| Sujet | Règle observée | Source |
|---|---|---|
| Nommage de branche | | |
| Format des messages de commit | | |
| Langue des commits | | |
| Revue de code : obligatoire ? combien de relecteurs ? | | |
| CI : ce qu'elle exécute, ce qui bloque | | |
| Environnements | | |
| Ajout de dépendance : procédure | | |

## B.7 Performance

| Sujet | Règle observée | Source |
|---|---|---|
| Pagination : mécanisme standard | | |
| Chargement des relations (N+1) | | |
| Cache : existe-t-il ? où ? | | |
| Traitements lourds : synchrone ou file ? | | |
| Volumétrie des plus grosses tables | | |

---

# C. RÈGLES DE TOKENS ET DE DESIGN

> **La question qui précède toutes les autres : où vit la source des tokens ?**
> Variables CSS, fichier SCSS, `tailwind.config`, thème JS, table de configuration, ou nulle
> part (tout en dur) ? La réponse détermine tout le reste.
>
> **Si des tokens existent : aucune valeur en dur dans le module. Aucune.**
> **Si aucun token n'existe : on ne profite pas de l'occasion pour en créer un système.**
> On relève les valeurs dominantes, on les documente ici, et on ouvre un ADR pour proposer —
> pas imposer — leur centralisation.

| | |
|---|---|
| Source des tokens | |
| Format | |
| Mécanisme de thème (clair/sombre ?) | |
| Valeurs en dur constatées dans l'existant | |

## C.1 Couleurs

| Rôle | Token / valeur | Dominance | Source |
|---|---|---|---|
| Fond de page | | | |
| Fond de panneau / carte | | | |
| Bordure / séparateur | | | |
| Texte principal | | | |
| Texte secondaire | | | |
| Texte désactivé | | | |
| Primaire / action | | | |
| Primaire survolé / actif | | | |
| Succès | | | |
| Avertissement | | | |
| Erreur / danger | | | |
| Information | | | |
| Focus | | | |
| **Couleurs de statut métier existantes** (validé, en attente, rejeté, soldé…) | | | |

> **Le module a besoin de 4 couleurs de risque (Vert / Ambre / Rouge / Critique).**
> Ces couleurs doivent-elles reprendre les statuts existants de l'ERP, ou constituer une échelle
> nouvelle ? Un utilisateur qui voit du rouge dans l'ERP doit-il comprendre la même chose partout ?
> → **ADR obligatoire.**

## C.2 Typographie

| Rôle | Famille | Taille | Graisse | Interlignage | Source |
|---|---|---|---|---|---|
| Titre de page | | | | | |
| Titre de section | | | | | |
| Corps | | | | | |
| Libellé de champ | | | | | |
| Légende / aide | | | | | |
| **Chiffres et montants** (famille tabulaire ?) | | | | | |
| Code / référence | | | | | |

## C.3 Espacement, formes, élévation

| Élément | Valeur | Source |
|---|---|---|
| Échelle d'espacement | | |
| Gouttière de grille | | |
| Padding d'un panneau | | |
| Padding d'une cellule de tableau | | |
| Rayon des angles | | |
| Épaisseur des bordures | | |
| Ombres / élévation | | |
| Hauteur d'un champ | | |
| Hauteur d'une ligne de tableau (densité) | | |

## C.4 Autres tokens

| Élément | Valeur | Source |
|---|---|---|
| Points de rupture (responsive) | | |
| Échelle de `z-index` | | |
| Bibliothèque d'icônes | | |
| Tailles d'icônes autorisées | | |
| Durées d'animation | | |
| Courbes d'accélération | | |
| Respect de `prefers-reduced-motion` | | |

---

# D. RÈGLES D'INTERFACE ET D'EXPÉRIENCE

## D.1 Gabarits et navigation

| Sujet | Règle observée | Source (écran de référence) |
|---|---|---|
| Gabarit d'une page de liste | | |
| Gabarit d'une page de détail | | |
| Gabarit d'une page de formulaire | | |
| Gabarit d'un tableau de bord | | |
| Navigation principale : où, comment on y ajoute une entrée | | |
| Fil d'Ariane | | |
| Titre de page et onglet du navigateur | | |
| Retour arrière / annulation | | |

## D.2 Tableaux

> Le module est fait de tableaux. Cette section est la plus utilisée.

| Sujet | Règle observée | Source |
|---|---|---|
| Composant de tableau existant | | |
| Densité (hauteur de ligne) | | |
| Tri : où, comment il s'affiche | | |
| Filtres : emplacement, persistance | | |
| Recherche | | |
| Pagination : mécanisme, taille de page par défaut | | |
| Actions de ligne : où, comment | | |
| Sélection multiple | | |
| Colonnes figées, défilement horizontal | | |
| Alignement des nombres (à droite ?) | | |
| Tableau vide | | |
| Export depuis un tableau | | |

## D.3 Formulaires

| Sujet | Règle observée | Source |
|---|---|---|
| Position du libellé | | |
| Marquage de l'obligatoire | | |
| Aide contextuelle | | |
| Validation : à la saisie, à la sortie, à la soumission ? | | |
| Affichage de l'erreur de champ | | |
| Affichage de l'erreur globale | | |
| Position et libellé des boutons | | |
| Protection contre le double envoi | | |
| Brouillon / sauvegarde automatique | | |
| Sortie avec modifications non enregistrées | | |

## D.4 Retours, états, confirmations

| Sujet | Règle observée | Source |
|---|---|---|
| Notification de succès (mécanisme, durée) | | |
| Notification d'erreur | | |
| Confirmation d'une action destructive | | |
| État de chargement (squelette, indicateur, blocage ?) | | |
| État vide | | |
| État d'erreur d'une page | | |
| Absence de droit : masquer ou désactiver ? | | |

## D.5 Formats — le détail qui trahit un module étranger

| Donnée | Format observé | Exemple réel | Source |
|---|---|---|---|
| Date | | | |
| Date + heure | | | |
| Date relative (« il y a 3 j ») : utilisée ? | | | |
| Durée | | | |
| Séparateur de milliers | | | |
| Séparateur décimal | | | |
| **Montant FCFA** (décimales, position du symbole, sigle utilisé) | | | |
| Montant en devise étrangère | | | |
| Grands montants : abrégés (12,4 M) ou complets ? | | | |
| Pourcentage | | | |
| Valeur nulle / vide | | | |
| Valeur négative (signe, couleur, parenthèses ?) | | | |

## D.6 Voix de l'interface

| Sujet | Règle observée | Exemple réel |
|---|---|---|
| Vouvoiement ou tutoiement | | |
| Libellé de bouton (infinitif « Enregistrer » ou impératif ?) | | |
| Casse des titres et des libellés | | |
| Ton des messages d'erreur | | |
| Terminologie métier maison (le glossaire de l'ERP) | | |
| Abréviations tolérées | | |

## D.7 Accessibilité, responsive, impression

| Sujet | Règle observée | Source |
|---|---|---|
| Niveau d'accessibilité pratiqué | | |
| Focus visible | | |
| Navigation au clavier | | |
| Contraste | | |
| Comportement mobile / tablette | | |
| Feuille de style d'impression | | |
| Export PDF | | |

---

# E. RÈGLES MÉTIER ET RÉGLEMENTAIRES

| Sujet | Règle observée | Source |
|---|---|---|
| Référentiel comptable (OHADA / SYSCOHADA) | | |
| Rétention documentaire (10 ans OHADA) : comment appliquée ? | | |
| Exercices comptables : ouverture, clôture, impact | | |
| TVA : taux, par pays | | |
| Retenues à la source | | |
| Numérotation légale des factures | | |
| Réglementation BCEAO applicable | | |
| Pays gérés et leurs spécificités | | |
| Calendrier des jours fériés : par pays ? versionné ? | | |

---

# F. CONTRADICTIONS RELEVÉES DANS L'EXISTANT

> **Section obligatoire, jamais vide.** Un ERP de plusieurs années contient toujours deux
> écoles. Les nommer, dire laquelle domine, et dire laquelle le module suit.

| # | Sujet | École A (où, combien) | École B (où, combien) | Laquelle domine | Le module suit | Pourquoi |
|---|---|---|---|---|---|---|

---

# G. RÈGLES ABSENTES

> Ce sur quoi l'ERP n'a pas de règle. Le module devra trancher — **par ADR, pas par défaut**.
> Et la règle qu'il pose devient un précédent pour les autres.

| # | Sujet sans règle | Ce que le module doit décider | ADR |
|---|---|---|---|

---

# H. LES DIX RÈGLES QUE LE MODULE NE DOIT JAMAIS ENFREINDRE

> Extrait à la fin de la phase 1 : les dix règles dont la violation serait immédiatement visible
> par un utilisateur ou un développeur de l'ERP. Elles sont recopiées dans `CLAUDE.md` et
> vérifiées à chaque `/verif`.

| # | Règle | Comment la vérifier mécaniquement |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |
