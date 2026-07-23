import { describe, it, expect } from "vitest";
const { parNews } = require("../domain/parNews");

describe("parNews — bulletins d'Actualité partenariats (ADR-P09)", () => {
  it("aucun signal ⇒ aucun bulletin", () => {
    const r = parNews({ quotas: { partners: [] }, renouvellements: { counts: {}, total: 0 }, relances: { counts: { late: 0 } } });
    expect(r.bulletins).toEqual([]);
    expect(r.counts).toEqual({ total: 0, high: 0 });
  });
  it("non-conformité + expirées ⇒ bulletins high ; à risque/renouvellement/retard ⇒ medium", () => {
    const r = parNews({
      quotas: { partners: [
        { partnerId: "fortinet", name: "Fortinet", status: "non_compliant" },
        { partnerId: "cisco", name: "Cisco", status: "at_risk" },
        { partnerId: "dell", name: "Dell", status: "on_track" },
      ] },
      renouvellements: { counts: { expired: 2 }, total: 5 },
      relances: { counts: { late: 3 } },
    });
    const byId = Object.fromEntries(r.bulletins.map((b) => [b.id, b]));
    expect(byId.par_partenaires_non_conformes.severity).toBe("high");
    expect(byId.par_partenaires_non_conformes.detail).toContain("Fortinet");
    expect(byId.par_partenaires_a_risque.severity).toBe("medium");
    expect(byId.par_certifs_expirees.severity).toBe("high");
    expect(byId.par_certifs_a_renouveler.severity).toBe("medium");
    expect(byId.par_assignations_retard.severity).toBe("medium");
    // tous portent domain/module "partenariats" (routage/cloisonnement du fil)
    expect(r.bulletins.every((b) => b.domain === "partenariats" && b.module === "partenariats")).toBe(true);
    expect(r.counts).toEqual({ total: 5, high: 2 });
  });
  it("tolère des entrées absentes / tableau brut de quotas", () => {
    const r = parNews({ quotas: [{ status: "non_compliant", partnerId: "x" }] });
    expect(r.bulletins.map((b) => b.id)).toEqual(["par_partenaires_non_conformes"]);
    expect(parNews().bulletins).toEqual([]); // aucun argument
  });
});

// Bulletins de renouvellement du PARTENARIAT (PAR-P4) — additifs, absents quand rien à signaler.
describe("parNews — renouvellement du partenariat", () => {
  it("échu = high, à venir = medium, noms cités ; rien sans items", () => {
    const r = parNews({ renouvellementsPartenariat: { items: [
      { partnerId: "f5", name: "F5", bucket: "expired" },
      { partnerId: "cisco", name: "Cisco", bucket: "j30" },
      { partnerId: "dell", name: "Dell", bucket: "j90" },
    ] } });
    const byId = Object.fromEntries(r.bulletins.map((b) => [b.id, b]));
    expect(byId.par_partenariats_echus.severity).toBe("high");
    expect(byId.par_partenariats_echus.detail).toContain("F5");
    expect(byId.par_partenariats_a_renouveler.severity).toBe("medium");
    expect(byId.par_partenariats_a_renouveler.title).toContain("2");
    expect(byId.par_partenariats_a_renouveler.detail).toContain("Cisco");
    expect(parNews({}).bulletins).toEqual([]); // sans items : aucun bulletin (rétro-compat)
  });
});
