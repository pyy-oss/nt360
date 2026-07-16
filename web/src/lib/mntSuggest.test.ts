import { describe, it, expect } from "vitest";
import { suggestMntContrats, addMonths, buildContratDraft } from "./mntSuggest";

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

describe("addMonths — arithmétique de date ISO", () => {
  it("ajoute 12 mois (même jour, année +1)", () => {
    expect(addMonths("2025-03-15", 12)).toBe("2026-03-15");
  });
  it("ramène le jour au dernier du mois si dépassement (29/02 → 28/02)", () => {
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonths("2025-11-30", 3)).toBe("2026-02-28");
  });
  it("rejette une date illisible", () => {
    expect(addMonths("15/03/2025", 12)).toBeNull();
    expect(addMonths("", 12)).toBeNull();
  });
});

describe("buildContratDraft — brouillon pré-rempli depuis une commande", () => {
  const today = "2026-07-16";

  it("dateDebut = date commande, dateFin = +12 mois, montant = CAS arrondi (FCFA entier)", () => {
    const d = buildContratDraft({ fp: "FP/2026/1", client: "ACME", bu: "ICT", am: "DATCHA", cas: 4999999.6, dateCommande: "2026-02-10" }, today);
    expect(d.dateDebut).toBe("2026-02-10");
    expect(d.dateFin).toBe("2027-02-10");
    expect(d.montantEngage).toBe(5000000);
    expect(d.deviseEngage).toBe("XOF");
    expect(d.statut).toBe("brouillon");   // jamais actif d'office
    expect(d.echeanceType).toBe("annuel"); // défaut cohérent avec un terme de 12 mois
    expect(d.engagements).toEqual([]);
    expect(d.fp).toBe("FP/2026/1");
  });

  it("retient l'échéance suggérée si valide, ignore une valeur hors énumération", () => {
    expect(buildContratDraft({ cas: 0, dateCommande: "2026-01-01" }, today, "mensuel").echeanceType).toBe("mensuel");
    expect(buildContratDraft({ cas: 0, dateCommande: "2026-01-01" }, today, "hebdomadaire").echeanceType).toBe("annuel");
  });

  it("sans date de commande : repli sur le 1er janvier du millésime PO plausible", () => {
    const d = buildContratDraft({ fp: "FP/2025/9", cas: 100, yearPo: 2025 }, today);
    expect(d.dateDebut).toBe("2025-01-01");
    expect(d.dateFin).toBe("2026-01-01");
  });

  it("sans date ni millésime plausible : repli sur aujourd'hui", () => {
    const d = buildContratDraft({ cas: 100, yearPo: 1900 }, today);
    expect(d.dateDebut).toBe(today);
    expect(d.dateFin).toBe("2027-07-16");
  });

  it("montant négatif ramené à 0", () => {
    expect(buildContratDraft({ cas: -50, dateCommande: "2026-01-01" }, today).montantEngage).toBe(0);
  });
});
