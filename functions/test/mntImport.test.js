// Import EN MASSE des contrats de maintenance (Lot 8) : parseur (classeur → lignes) + plan
// (validation + création/mise à jour/erreurs). Cf. parsers/mntImport + domain/mntImport.
import { describe, it, expect } from "vitest";
const { parseMntContratsImport, MNT_TEMPLATE_HEADERS } = require("../parsers/mntImport");
const { planMntContratsImport } = require("../domain/mntImport");

// Classeur factice à la forme readWorkbook (exceljs) : { SheetNames, Sheets:{ nom: { _aoa } } }.
const wb = (aoa, name = "Contrats") => ({ SheetNames: [name], Sheets: { [name]: { _aoa: aoa } } });

describe("parseMntContratsImport", () => {
  it("mappe les en-têtes FR, normalise statut/périodicité et convertit les dates", () => {
    const { rows, report } = parseMntContratsImport(wb([
      MNT_TEMPLATE_HEADERS,
      ["FP/2026/1", "ACME", "ICT", "Dupont", "Actif", "Mensuel", "2026-01-01", "2026-12-31", "12000000", "XOF"],
      ["FP/2026/2", "BETA", "CLOUD", "", "Échu", "Annuelle", "01/03/2025", "", "5000000", ""],
      ["", "", "", "", "", "", "", "", "", ""], // ligne vide → ignorée
    ]));
    expect(report.rowsParsed).toBe(2);
    expect(rows[0].raw.statut).toBe("actif");
    expect(rows[0].raw.echeanceType).toBe("mensuel");
    expect(rows[0].raw.dateDebut).toBe("2026-01-01");
    expect(rows[1].raw.statut).toBe("echu");       // sans accent
    expect(rows[1].raw.echeanceType).toBe("annuel"); // « Annuelle » → annuel
    expect(rows[1].raw.dateDebut).toBe("2025-03-01"); // JJ/MM/AAAA → ISO
    expect(rows[0].line).toBe(2); // +2 (en-tête en ligne 1)
  });
});

describe("planMntContratsImport", () => {
  const mk = (fp, over = {}) => ({ raw: { fp, client: "ACME", statut: "actif", echeanceType: "mensuel", dateDebut: "2026-01-01", montantEngage: 1000000, ...over }, line: 2 });
  it("classe en création vs mise à jour selon les ids existants (id = safeId(fp))", () => {
    const { toCreate, toUpdate, errors } = planMntContratsImport(
      [mk("FP/2026/1"), mk("FP/2026/2")],
      new Set(["FP_2026_2"]), // FP/2026/2 déjà en base (id = safeId → underscores)
    );
    expect(errors).toHaveLength(0);
    expect(toCreate.map((r) => r.value.fp)).toEqual(["FP/2026/1"]);
    expect(toUpdate.map((r) => r.value.fp)).toEqual(["FP/2026/2"]);
  });
  it("remonte les lignes invalides en erreurs (sans planter l'import)", () => {
    const { toCreate, errors } = planMntContratsImport(
      [mk("FP/2026/1"), mk("", { fp: "" }), mk("FP/2026/3", { statut: "n_importe_quoi" })],
      new Set(),
    );
    expect(toCreate).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0].error).toMatch(/FP/);
  });
  it("dédoublonne intra-fichier par FP : la dernière occurrence gagne", () => {
    const { toCreate } = planMntContratsImport(
      [mk("FP/2026/1", { client: "ANCIEN" }), mk("FP/2026/1", { client: "NOUVEAU" })],
      new Set(),
    );
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].value.client).toBe("NOUVEAU");
  });
});
