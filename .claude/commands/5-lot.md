---
description: "Implémenter un lot du plan. Usage : /5-lot 1"
argument-hint: "[numéro du lot]"
---

# Lot $1

Prérequis : phases 0 à 4 validées, filet vert.

## Avant d'écrire une ligne

1. Lis `04-PLAN-INTEGRATION.md` et **cite le périmètre exact du lot $1** : ce qu'il livre, ce
   qu'il touche, ce qu'il ne touche pas.
2. Lis `03-ACCELERATEURS.md` et **liste les briques existantes que ce lot réutilise**. Si tu
   t'apprêtes à écrire quelque chose qui figure en RÉUTILISER, tu te trompes.
3. Lis `02-REGLES.md`. **Tu écris comme l'ERP, pas comme toi.** Nommage, types, formats, tokens, libellés : tout y est. Une convention inventée est un écart, pas une amélioration.
4. Lis les dernières entrées de `06-JOURNAL.md`.
5. Crée la branche : `feat/mnt-lot-$1-<intitulé-court>`.
6. Lance `/verif`. **Si c'est rouge avant que tu commences, arrête-toi.**

## Pendant

- **Un commit par intention.** Message en français, à l'impératif, expliquant le pourquoi.
- **Test d'abord** quand tu touches à l'existant : caractérisation → modification → vérification.
- **Additif uniquement** sur le schéma. Une migration qui supprime ou renomme = ADR + arrêt.
- **Derrière le drapeau.** Rien de visible tant que le drapeau est à zéro.
- **Ne déborde pas.** Si le lot t'oblige à toucher un fichier hors périmètre : arrête-toi,
  explique, demande.
- **Ne corrige rien « au passage ».** Note-le dans le journal.
- Si tu découvres que `01-EXISTANT.md` est faux sur un point : **dis-le immédiatement**, ne
  contourne pas. Un document faux contamine tous les lots suivants.

## Après

1. `/verif`
2. Mets à jour `06-JOURNAL.md` : fait / appris / échoué / dette assumée / suivant.
3. Ajoute un ADR si une décision structurante a été prise en cours de route.
4. Produis un résumé de revue :
   - Ce que le lot livre, en une phrase compréhensible par un utilisateur
   - Fichiers créés / modifiés, avec le pourquoi de chaque modification hors périmètre s'il y en a
   - Briques existantes réutilisées
   - Points de contact touchés et leur couverture de test
   - Procédure de retour arrière
   - Ce qui reste incertain

## Fin de lot

> **Lot $1 terminé. Filet vert / rouge. À relire avant fusion.**

Arrête-toi. Tu n'enchaînes pas sur le lot suivant.
