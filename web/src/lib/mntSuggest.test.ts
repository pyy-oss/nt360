import { describe, it, expect } from "vitest";
import { suggestMntContrats } from "./mntSuggest";

// fpKey de test simplifié : normalise la casse/espaces (suffisant pour l'appariement du test).
const fk = (v?: string | null) => String(v || "").trim().toUpperCase();

describe("suggestMntContrats", () => {
  it("suggère les affaires à mots-clés maintenance sans contrat, triées par score puis montant", () => {
    const orders = [
      { fp: "FP/2026/1", client: "Alpha", affaire: "Contrat de maintenance TMA annuel", cas: 5_000_000 },
      { fp: "FP/2026/2", client: "Beta", affaire: "Support et hébergement infogérance", cas: 2_000_000 },
      { fp: "FP/2026/3", client: "Gamma", affaire: "Vente de licences bureautiques", cas: 9_000_000 }, // « licence » → 1 signal
      { fp: "FP/2026/4", client: "Delta", affaire: "Fourniture de serveurs", cas: 8_000_000 }, // aucun mot-clé → exclu
    ];
    // FP/1 et FP/2 ont chacun 3 signaux → départage par montant (FP/1 5M > FP/2 2M) ; FP/3 = 1 signal.
    const s = suggestMntContrats(orders, [], fk);
    expect(s.map((x) => x.fp)).toEqual(["FP/2026/1", "FP/2026/2", "FP/2026/3"]);
    expect(s[0].reasons).toContain("maintenance");
    expect(s.find((x) => x.fp === "FP/2026/4")).toBeUndefined();
  });

  it("exclut les affaires déjà sous contrat (rapprochement par fpKey)", () => {
    const orders = [{ fp: "fp/2026/9", client: "X", affaire: "Maintenance applicative" }];
    const withContract = suggestMntContrats(orders, [{ fp: "FP/2026/9" }], fk);
    expect(withContract).toHaveLength(0);
    const without = suggestMntContrats(orders, [], fk);
    expect(without).toHaveLength(1);
  });

  it("dédoublonne un même FP présent plusieurs fois dans le carnet et respecte le cap", () => {
    const orders = [
      { fp: "FP/1", client: "A", affaire: "maintenance" },
      { fp: "FP/1", client: "A", affaire: "maintenance" },
      { fp: "FP/2", client: "B", affaire: "support" },
    ];
    expect(suggestMntContrats(orders, [], fk)).toHaveLength(2);
    expect(suggestMntContrats(orders, [], fk, 1)).toHaveLength(1);
  });
});
