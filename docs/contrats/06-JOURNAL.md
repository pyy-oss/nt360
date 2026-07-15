# 06 — Journal

> Append-only, plus récent en tête. Rempli par `/journal` à chaque fin de session.
>
> **Les échecs sont la partie utile.** Un journal qui ne contient que des succès n'est pas un
> journal, c'est une plaquette — et la session suivante réessaiera ce qui a déjà échoué.

## Format

```markdown
## AAAA-MM-JJ — <phase ou lot>

**Fait**
- …

**Appris sur l'existant**
- … (toute découverte qui contredit ou complète 01-EXISTANT.md — et corrige le document)

**Échoué / abandonné**
- … (ce qui n'a pas marché, et pourquoi)

**Dette assumée**
- … (ce qu'on a laissé sale sciemment, et la condition de son remboursement)

**Décidé**
- … (renvoi ADR)

**Suivant**
- …
```

---

## AAAA-MM-JJ — Phase 0

**Fait**
- [à remplir]
