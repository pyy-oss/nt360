import { describe, it, expect } from "vitest";
import { byEngineer, type EngCert, type EngAssign } from "./parEngineer";

const cert = (id: string, consultantId: string, status: string, name?: string, bu?: string): EngCert => ({ id, consultantId, consultantName: name, consultantBu: bu, partnerId: "fortinet", certName: "NSE", status });
const assign = (id: string, consultantId: string, name?: string): EngAssign => ({ id, consultantId, consultantName: name, partnerId: "fortinet", cert: "NSE7", status: "planifie" });

describe("byEngineer", () => {
  it("regroupe certifs + assignations par consultant, compte le total et les certifs actives", () => {
    const rows = byEngineer(
      [cert("c1", "u1", "active", "Awa", "Cyber"), cert("c2", "u1", "expired", "Awa"), cert("c3", "u2", "expiring_soon", "Koffi", "Réseau")],
      [assign("a1", "u1"), assign("a2", "u2")],
    );
    const awa = rows.find((r) => r.consultantId === "u1")!;
    expect(awa.consultantName).toBe("Awa");
    expect(awa.consultantBu).toBe("Cyber");
    expect(awa.certCount).toBe(2);
    expect(awa.activeCerts).toBe(1); // c2 expirée exclue
    expect(awa.assignCount).toBe(1);
  });

  it("le libellé prend la première valeur non vide (nom/BU dénormalisés partiellement)", () => {
    // La BU n'est portée que par les certifs ; l'assignation seule ne donne pas de BU.
    const rows = byEngineer([cert("c1", "u9", "active", "", "")], [assign("a1", "u9", "Binta")]);
    expect(rows[0].consultantName).toBe("Binta"); // nom via l'assignation
    expect(rows[0].consultantBu).toBe(""); // aucune BU disponible
  });

  it("tri par volume décroissant puis par nom ; robustesse aux entrées vides", () => {
    const rows = byEngineer([cert("c1", "u1", "active", "Zoe"), cert("c2", "u2", "active", "Ana"), cert("c3", "u2", "active", "Ana")], []);
    expect(rows.map((r) => r.consultantId)).toEqual(["u2", "u1"]); // u2 a 2 certifs
    expect(byEngineer(null, null)).toEqual([]);
    expect(byEngineer([{ id: "x", consultantId: "", status: "active", partnerId: "p" } as EngCert], [])).toEqual([]); // sans consultantId → ignoré
  });
});
