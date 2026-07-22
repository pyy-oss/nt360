import { describe, it, expect } from "vitest";
import { mergeAtterrissageObjectifs } from "./atterrissage";

// VERROU du bloquant (audit métier) : Vue d'ensemble, Bilan CODIR et Cockpit commercial DOIVENT re-fusionner
// les objectifs isolés (doc gaté) par-dessus le doc public. Un écran qui oublie la fusion affiche objectifCaf=0
// et diverge des autres. Ces tests garantissent que le helper PARTAGÉ produit la même valeur partout.
describe("mergeAtterrissageObjectifs — parité des objectifs entre écrans", () => {
  const pub = { objectifCaf: 0, objectif: 0, cafProjete: 6500, factureN: 3000, next: { objectifCaf: 0, backlog: 100 } };
  const obj = { objectifCaf: 8000, objectif: 9000, next: { objectifCaf: 8500 } };

  it("re-fusionne objectifCaf (et next.objectifCaf) par-dessus le doc public purgé", () => {
    const att = mergeAtterrissageObjectifs(pub, obj)!;
    expect(att.objectifCaf).toBe(8000); // l'objectif du doc gaté PRIME sur le 0 purgé du doc public
    expect(att.objectif).toBe(9000);
    expect(att.cafProjete).toBe(6500); // valeur publique conservée
    expect(att.next.objectifCaf).toBe(8500); // fusion PROFONDE de next
    expect(att.next.backlog).toBe(100); // le reste de next (public) conservé
  });

  it("rôle sans droit objectifs (attObj null) : la cible se dégrade proprement (pas d'objectif inventé)", () => {
    const att = mergeAtterrissageObjectifs(pub, null)!;
    expect(att.objectifCaf).toBe(0); // reste 0 → l'UI masque la cible (« — »), ne l'invente pas
    expect(att.cafProjete).toBe(6500);
    expect(att.next.backlog).toBe(100);
  });

  it("doc public absent (chargement) : renvoie null (pas de fusion sur du vide)", () => {
    expect(mergeAtterrissageObjectifs(null, obj)).toBeNull();
    expect(mergeAtterrissageObjectifs(undefined, obj)).toBeUndefined();
  });
});
