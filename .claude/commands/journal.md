---
description: Consigner la session dans le journal
---

# Journal

Ajoute une entrée à `docs/contrats/06-JOURNAL.md`, en tête, au format :

```markdown
## AAAA-MM-JJ — <phase ou lot>

**Fait**
- …

**Appris sur l'existant**
- … (toute découverte qui contredit ou complète `01-EXISTANT.md` — et corrige le document)

**Échoué / abandonné**
- … (ce qui n'a pas marché, et pourquoi. C'est la section la plus utile dans six mois.)

**Dette assumée**
- … (ce qu'on a laissé sale sciemment, et la condition de son remboursement)

**Décidé**
- … (renvoi vers l'ADR)

**Suivant**
- …
```

Règles :
- **Écris les échecs.** Un journal qui ne contient que des succès n'est pas un journal, c'est
  une plaquette. La prochaine session a besoin de savoir ce qui a déjà été essayé en vain.
- **Sois précis sur l'existant.** « Le moteur de workflow ne gère pas les circuits parallèles
  (`app/Workflow/Engine.php:214`) » vaut mieux que « limitations du workflow ».
- Append-only. On n'efface pas une entrée passée, on en écrit une nouvelle.
