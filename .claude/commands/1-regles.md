---
description: Phase 1 — Extraire toutes les règles de l'existant (base, ingénierie, tokens, UI/UX, métier)
---

# Phase 1 — Les règles de l'existant

**Aucun code applicatif.** Livrable unique : `docs/contrats/02-REGLES.md`.

Prérequis : `docs/contrats/01-EXISTANT.md` rempli et validé.

## L'idée

La phase 0 a dit **où** sont les choses. Cette phase dit **comment** elles s'écrivent.

Un module conforme à l'architecture mais qui invente ses noms de colonnes, son format de date,
ses couleurs de statut et sa façon de dire « Enregistrer » est un corps étranger. Il sera
reconnaissable au premier coup d'œil, contourné par les utilisateurs, et détesté par les
développeurs qui devront le maintenir.

> **La règle de l'ERP gagne. Toujours. Même laide, même datée, même contraire à l'état de l'art.**
> Tu n'es pas là pour élever le niveau. Tu es là pour être indiscernable.

## La méthode — trois principes

### 1. La règle est ce que le code fait, pas ce qu'un guide dit
Un `CONTRIBUTING.md` de 2019 décrit des intentions. Le code décrit la réalité. Quand les deux
divergent, **le code gagne**, et tu notes la divergence.

### 2. Toute règle porte son taux de dominance
Ne dis jamais « les tables sont au pluriel ». Dis : **« les tables sont au pluriel — 47 sur 52 ;
les 5 exceptions sont dans `legacy/`, toutes antérieures à 2021 »**. Compte. Une règle observée
dans 4 fichiers sur 200 n'est pas une règle, c'est un accident, et l'imiter serait une faute.

Compte mécaniquement quand c'est possible :
```bash
# exemple : casse des colonnes dans les migrations
grep -rhoE '^\s+[a-zA-Z_]+' migrations/ | sort | uniq -c | sort -rn | head
```

### 3. En cas de divergence, le code récent et testé l'emporte
Un ERP de plusieurs années contient toujours deux écoles. Arbitre en faveur de celle qui est
**à la fois la plus récente et la mieux couverte par les tests** — c'est celle que l'équipe
défend aujourd'hui. Utilise `git log --format='%ad' --date=short -- <fichier>` pour dater.
Note l'autre école en section F.

## Les sources de vérité, par ordre de force

1. **Les configurations mécaniques** — elles ne mentent pas et sont opposables :
   `.editorconfig`, `eslint`, `prettier`, `phpcs`, `checkstyle`, `ktlint`, `rubocop`, `.gitattributes`,
   `tailwind.config.*`, fichiers de thème, variables CSS, `tsconfig`, config du linter SQL.
2. **Les migrations** — la vérité du schéma, dans l'ordre chronologique.
3. **Le code récent et testé.**
4. **Les tests eux-mêmes** — ils disent ce que l'équipe considère comme le contrat.
5. **Le code ancien** — informatif, pas normatif.
6. **La documentation** — la plus faible des sources. Vérifie tout ce qu'elle affirme.

## Ce que tu extrais

Suis exactement la structure de `docs/contrats/02-REGLES.md` :

- **A — Base de données** : nommage, types, colonnes techniques, intégrité, migrations,
  multi-société, devises, **arrondi FCFA**, fuseau.
- **B — Ingénierie** : couches, formatage, erreurs, journalisation, validation, tests,
  sécurité, rituel git/CI, performance.
- **C — Tokens** : où vit la source, couleurs, typographie, espacement, formes, icônes, motion.
- **D — Interface** : gabarits, tableaux, formulaires, retours, **formats d'affichage**, voix,
  accessibilité.
- **E — Métier et réglementaire** : OHADA, exercices, TVA, numérotation légale, pays.
- **F — Contradictions** : obligatoire, jamais vide.
- **G — Règles absentes** : ce que le module devra trancher par ADR.
- **H — Les dix règles intouchables.**

## Les pièges qui trahissent un module étranger

Cherche-les explicitement, ce sont eux qui se voient en premier :

| Piège | Ce qu'il faut trouver |
|---|---|
| **L'arrondi FCFA** | Le franc CFA n'a pas de subdivision. Combien de décimales l'ERP affiche-t-il ? En stocke-t-il ? |
| **Le type des montants** | Décimal ou flottant ? Si l'ERP est en flottant, **le module aussi**. On ne corrige pas, on ouvre un ADR. |
| **Le format de date** | `JJ/MM/AAAA` ? `AAAA-MM-JJ` ? Un module qui affiche l'autre saute aux yeux. |
| **Le séparateur de milliers** | Espace insécable ? Point ? Rien ? |
| **Les couleurs de statut** | L'ERP a déjà un rouge « rejeté » et un vert « validé ». Le module a 4 couleurs de risque. Doivent-elles s'y aligner ? → **ADR**. |
| **La voix des boutons** | « Enregistrer » ou « Sauvegarder » ? Infinitif ou impératif ? Vouvoiement ? |
| **La densité des tableaux** | Une ligne de 32 px à côté d'une ligne de 48 px se remarque immédiatement. |
| **Le fuseau** | Abidjan est à UTC+0. Le SLA se calcule à la minute. Que stocke l'ERP ? |
| **La langue des identifiants** | `contrat` ou `contract` ? Suis l'ERP, pas la spécification. |

## La section H

Termine par les **dix règles dont la violation serait immédiatement visible**, chacune avec le
moyen de la vérifier mécaniquement (une commande `grep`, une règle de linter, un test). Ces dix
règles seront recopiées dans `CLAUDE.md` et contrôlées à chaque `/verif`.

## Interdits de la phase

- ❌ Ne juge pas. « Cette convention est dépassée » n'a pas sa place ici.
- ❌ Ne propose rien. La proposition, c'est la phase 3.
- ❌ N'affirme aucune règle sans dominance chiffrée et sans source.
- ❌ Ne laisse ni F ni G vides.

## Fin de phase

Résume : nombre de règles extraites par domaine, contradictions relevées, règles absentes,
et **les trois règles qui vont le plus contraindre le module**. Puis :

> **Phase 1 terminée. Relisez la section F (contradictions) et H (les dix intouchables) : c'est
> là que se jouera l'intégration. Validez avant `/2-accelerateurs`.**

Arrête-toi.
