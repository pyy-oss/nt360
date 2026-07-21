import { describe, it, expect, vi } from "vitest";
const { wbFromRows, wbFromAoa, wbMulti } = require("./_wb");
const { parsePnl } = require("../parsers/pnl");
const { parseFacturationDf } = require("../parsers/facturationDf");
const { parseSalesData, normalizeStage } = require("../parsers/salesData");
const { parseFiche, parseFicheAll } = require("../parsers/ficheAffaire");

describe("parsePnl → orders + suppliers (§17.2)", () => {
  const wb = wbFromRows("P&L", [
    {
      "Opp ID": "FP/2026/1", Customer: "ACME", BU: "ICT", "Year PO": 2026,
      CAS: 1000, "RAF TOTAL": 400, "MB TOTAL": 210, "MB Réel": 999, AM: "DATCHA",
      Frns1: 300, "Frns1 N": "HIPERDIST", Frns2: 50, "Frns2 N": "COM", Frns3: 0, "Frns3 N": "WESTCON",
    },
    { "Opp ID": "FP/2026/2", Customer: "BETA", BU: "xxx", "Year PO": 2025, CAS: 0 }, // quarantaine CAS<=0
    { "Opp ID": "NOFP", Customer: "GAMMA", CAS: 500 }, // quarantaine FP invalide
  ]);
  const { rows, report } = parsePnl(wb);

  it("garde seulement les lignes valides", () => {
    expect(rows).toHaveLength(1);
    expect(report.rowsIn).toBe(3);
    expect(report.rowsOk).toBe(1);
  });
  it("utilise MB TOTAL (pas MB Réel) et RAF≥0", () => {
    expect(rows[0].mb).toBe(210);
    expect(rows[0].raf).toBe(400);
    expect(rows[0].bu).toBe("ICT");
  });
  it("RAF Total VIDE → raf null (≠ 0) pour autoriser le repli dérivé en aval", () => {
    const wb2 = wbFromRows("P&L", [{ "Opp ID": "FP/2026/7", Customer: "ACME", BU: "ICT", "Year PO": 2026, CAS: 1000, "RAF Total": "" }]);
    expect(parsePnl(wb2).rows[0].raf).toBeNull();
  });
  it("filtre le bruit fournisseurs (COM) et les montants nuls", () => {
    expect(rows[0].suppliers).toEqual([{ name: "HIPERDIST", amount: 300 }]);
  });
});

describe("dates sentinelles Excel rejetées", () => {
  it("P&L yearPo=1900 → 0", () => {
    const wb = wbFromRows("P&L", [{ "Opp ID": "FP/2026/1", CAS: 100, "RAF TOTAL": 0, "Year PO": 1900 }]);
    expect(parsePnl(wb).rows[0].yearPo).toBe(0);
  });
  it("LIVE closingDate 1899 → null", () => {
    const wb = wbFromRows("LIVE", [{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "D Prev": "1899-12-31" }]);
    expect(parseSalesData(wb).rows[0].closingDate).toBeNull();
  });
  it("FACTURE date/échéance 1899 → null (aging/DSO/cash non faussés)", () => {
    const wb = wbFromRows("Facturation DF", [
      { "Numéro": "INV9", "N° FP": "FP/2026/1", "Montant HT": 100, "Date": "1899-12-31", "Date d'échéance": "1899-12-30" },
    ]);
    const r = parseFacturationDf(wb).rows[0];
    expect(r.date).toBeNull();
    expect(r.dueDate).toBeNull();
  });
});

describe("parseFacturationDf → invoices (§17.3)", () => {
  it("dédup par Numéro et mappe Odoo", () => {
    const wb = wbFromRows("Facturation DF", [
      { "Numéro": "JV/2024/01/0002", "N° FP": "FP/2026/1", Client: "ACME", "Montant HT": 100, Date: "2024-01-15", BU: "ICT" },
      { "Numéro": "JV/2024/01/0002", "N° FP": "FP/2026/1", Client: "ACME", "Montant HT": 100, Date: "2024-01-15", BU: "ICT" },
      { "Numéro": "JV/2024/01/0003", "Référence": "FP/2026/1", "Nom d'affichage du partenaire": "ACME", "Total signé en devises": 250, "Date de facturation": "2024-02-01" },
      { Client: "SansNumero", "Montant HT": 99 }, // quarantaine
    ]);
    const { rows, report } = parseFacturationDf(wb);
    expect(rows).toHaveLength(2); // dédup + skip sans numéro
    expect(report.rowsSkipped).toBe(2);
    const byId = Object.fromEntries(rows.map((r) => [r._id, r]));
    expect(byId["JV_2024_01_0002"].amountHt).toBe(100);
    expect(byId["JV_2024_01_0003"].amountHt).toBe(250);
    expect(byId["JV_2024_01_0003"].client).toBe("ACME"); // mapping Odoo partenaire
    expect(byId["JV_2024_01_0002"].fp).toBe("FP/2026/1");
  });
  it("contrôle §18.3 : Σ factures d'un FP = son CAF", () => {
    const wb = wbFromRows("Facturation DF", [
      { "Numéro": "A1", "N° FP": "FP/2026/1", "Montant HT": 600 },
      { "Numéro": "A2", "N° FP": "FP/2026/1", "Montant HT": 400 },
    ]);
    const { rows } = parseFacturationDf(wb);
    expect(rows.reduce((s, r) => s + r.amountHt, 0)).toBe(1000);
  });
  it("multi-lignes : 2 lignes DISTINCTES de même montant/date sont SOMMÉES (pas sous-comptées)", () => {
    const wb = wbFromRows("Facturation DF", [
      { "Numéro": "INV1", "N° FP": "FP/2026/1", "Montant HT": 100, "Date": "2026-01-10", "Désignation": "Licence A" },
      { "Numéro": "INV1", "N° FP": "FP/2026/1", "Montant HT": 100, "Date": "2026-01-10", "Désignation": "Licence B" },
    ]);
    const { rows } = parseFacturationDf(wb);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountHt).toBe(200); // 2 lignes distinctes → 100 + 100
    expect(rows[0].lines).toBe(2);
  });
  it("multi-lignes : doublon d'export STRICTEMENT identique est ignoré (pas de double compte)", () => {
    const wb = wbFromRows("Facturation DF", [
      { "Numéro": "INV2", "N° FP": "FP/2026/1", "Montant HT": 100, "Date": "2026-01-10", "Désignation": "Licence A" },
      { "Numéro": "INV2", "N° FP": "FP/2026/1", "Montant HT": 100, "Date": "2026-01-10", "Désignation": "Licence A" },
    ]);
    const { rows } = parseFacturationDf(wb);
    expect(rows[0].amountHt).toBe(100); // ligne identique → dédupliquée
  });
});

describe("parseSalesData → opportunities (§17.5)", () => {
  it("normalise les étapes (accents/casse/variantes)", () => {
    expect(normalizeStage("4-Négociation")).toBe(4);
    expect(normalizeStage("negociation")).toBe(4);
    expect(normalizeStage("6 - Gagné")).toBe(6);
    expect(normalizeStage("Suspendu")).toBe(8);
    expect(normalizeStage("inconnu")).toBe(0);
  });
  it("proba = IdC sinon défaut ; pondéré = montant×proba", () => {
    const wb = wbFromRows("LIVE", [
      { Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", IdC: 0.5, "NEW AM": "DATCHA", "D Prev": "2026-03-01" },
      { Client: "BETA", "Montant (HT)": 2000, Statut: "2-Montage", "NEW AM": "KOUADIO" }, // IdC défaut étape 2 = 25 %
      { Client: "", "Montant (HT)": 0, Statut: "1-Qualification" }, // quarantaine
    ]);
    const { rows, report } = parseSalesData(wb);
    expect(rows).toHaveLength(2);
    expect(report.rowsSkipped).toBe(1);
    // IdC en % (0-100) : ACME 0,5 (source 0-1 historique) tolérée telle quelle ; pondéré = montant × p01(IdC).
    const acme = rows.find((r) => r.client === "ACME");
    expect(acme.probability).toBe(0.5);
    expect(acme.weighted).toBe(500);        // 1000 × p01(0.5) = 1000 × 0.5
    const beta = rows.find((r) => r.client === "BETA");
    expect(beta.probability).toBe(25);      // défaut étape 2 en % (0-100)
    expect(beta.weighted).toBe(500);        // 2000 × p01(25) = 2000 × 0.25
  });
  it("IdC en % (« 90 ») conservé tel quel ; source 0-1 historique tolérée", () => {
    const wb = wbFromRows("LIVE", [
      { Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", IdC: 90, "NEW AM": "DATCHA", "D Prev": "2026-03-01" },
      { Client: "BETA", "Montant (HT)": 1000, Statut: "4-Négociation", IdC: 0.9, "NEW AM": "KOUADIO", "D Prev": "2026-03-01" },
    ]);
    const { rows } = parseSalesData(wb);
    expect(rows.find((r) => r.client === "ACME").probability).toBe(90);  // « 90 » conservé (échelle %)
    expect(rows.find((r) => r.client === "BETA").probability).toBe(0.9); // 0.9 (0-1 historique) inchangé — p01 le normalise au calcul
  });
  it("oppId stable par hash quand extId absent (idempotence)", () => {
    const mk = () => parseSalesData(wbFromRows("LIVE", [{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "NEW AM": "DATCHA" }])).rows[0]._id;
    expect(mk()).toBe(mk());
  });
  it("oppId INDÉPENDANT de l'année d'exécution (borne glissante découplée de l'ID)", () => {
    const row = [{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "NEW AM": "DATCHA", "D Prev": "2029-06-01" }];
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z")); // fenêtre max 2028 → 2029 HORS fenêtre
    const a = parseSalesData(wbFromRows("LIVE", row)).rows[0];
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z")); // fenêtre max 2029 → 2029 DANS la fenêtre
    const b = parseSalesData(wbFromRows("LIVE", row)).rows[0];
    vi.useRealTimers();
    expect(a._id).toBe(b._id);              // même ID malgré le changement de fenêtre (raw date hashée)
    expect(a.closingDate).toBeNull();       // 2029 hors fenêtre en 2025 → date non stockée
    expect(b.closingDate).toBe("2029-06-01"); // mais l'ID reste identique → pas de doublon au ré-import
  });
});

describe("parseFiche → projectSheets + bcLines (§18.4, contrôle PAM-BF)", () => {
  // Reconstruit la structure de la fiche affaire (labels + valeurs) — cellules §18.4.
  const aoa = [
    [], [], [],
    [null, null, null, null, null, "N° DE FP :", "FP/2026/13542"],   // ligne 4 (index 3)
    [null, null, null, null, null, "CLIENT :", "PAM - BF"],           // ligne 5
    [null, null, null, null, null, "AFFAIRE :", "Fourniture serveurs"],
    [null, null, null, null, null, "COMMERCIAL :", "DATCHA"],
    [], [],
    [null, null, "N°BC FRNS", "DESCRIPTION", "FOURNISSEUR", "TYPE", "DEVISE", "CHARGES EN DEVISE", "CHARGES EN XOF"], // en-tête (ligne 15/idx? place row idx 9)
    [null, "Commande Frns 1", "BC001", "Serveur", "AITEK", "Matériel", "XOF", 1007500, 1007500], // ligne données
    [null, "TOTAL Commandes Frns", null, null, null, null, null, null, 1007500], // stop
    [], [],
    [null, "PRIX DE REVIENT", null, null, null, null, null, null, 1007500],
    [null, "PRIX DE VENTE NEURONES", null, null, null, null, null, null, 1085668],
    [null, "MARGE BRUTE NEURONES", null, null, null, null, null, null, 78168],
    [null, "% DE MARGE BRUTE", null, null, null, null, null, null, 7.2],
  ];
  const wb = wbFromAoa("Fiche", aoa);
  const { sheet, bcLines } = parseFiche(wb);

  it("entête : FP, client, commercial", () => {
    expect(sheet.fp).toBe("FP/2026/13542");
    expect(sheet.client).toBe("PAM - BF");
    expect(sheet.commercial).toBe("DATCHA");
  });
  it("récap chiffré (revient/vente/marge/%MB)", () => {
    expect(sheet.costTotal).toBe(1007500);
    expect(sheet.saleTotal).toBe(1085668);
    expect(sheet.margin).toBe(78168);
    expect(sheet.marginPct).toBeCloseTo(0.072, 5); // 7,2% → /100
  });
  it("ligne BC AITEK 1 007 500 en XOF, statut initial a_emettre", () => {
    expect(bcLines).toHaveLength(1);
    expect(bcLines[0].supplier).toBe("AITEK");
    expect(bcLines[0].amountXof).toBe(1007500);
    expect(bcLines[0].status).toBe("a_emettre");
    expect(bcLines[0]._id).toMatch(/^FP_2026_13542_h[a-z0-9]+$/); // FP sanitisé + clé métier hachée (plus positionnel)
  });
  it("id de ligne DÉTERMINISTE (ré-import → même id, idempotent)", () => {
    const again = parseFiche(wbFromAoa("Fiche", aoa)).bcLines[0]._id;
    expect(again).toBe(bcLines[0]._id);
  });
});

describe("parseFiche — montants : priorité XOF sur devise, ignore une cellule d'unité (audit F1/F2)", () => {
  // Fiche USD (labels réels Neurones) : ligne « (EN DEVISE) » AVANT « (XOF) », et une cellule d'unité
  // « XOF » APRÈS le montant. On doit retenir le montant EN XOF (converti), pas la devise, ni « XOF ».
  const aoa = [
    [null, "N° DE FP :", "FP/2026/777"],
    [null, "CLIENT :", "2ACI"],
    [null, "AFFAIRE :", "Licences"],
    [],
    [null, "PRIX DE REVIENT TOTAL NEURONES TECHNOLOGIES HT (EN DEVISE)", 7000],
    [null, "PRIX DE REVIENT TOTAL NEURONES TECHNOLOGIES HT (XOF)", 4399920],
    [null, "PRIX DE VENTE NEURONES TECHNOLOGIES HT (EN DEVISE)", 8000],
    [null, "PRIX DE VENTE NEURONES TECHNOLOGIES HT (XOF)", 4813043, "XOF"],
    [null, "MARGE BRUTE NEURONES TECHNOLOGIES (XOF)", 413123],
    [null, "% DE MARGE BRUTE NEURONES TECHNOLOGIES", 0.0858],
  ];
  const { sheet } = parseFiche(wbFromAoa("Fiche", aoa));
  it("saleTotal = montant XOF (converti), pas la valeur en devise ni l'unité", () => {
    expect(sheet.saleTotal).toBe(4813043);
  });
  it("costTotal = montant XOF", () => {
    expect(sheet.costTotal).toBe(4399920);
  });
  it("marge et %MB extraits", () => {
    expect(sheet.margin).toBe(413123);
    expect(sheet.marginPct).toBeCloseTo(0.0858, 4);
  });
});

describe("parseFiche — %MB calculé (marge/vente), pas la colonne % (anti-inversion faible marge, audit)", () => {
  // Fiche à FAIBLE marge (1 %). L'ancienne heuristique base-100 gardait « 1 » → 100 % (affiché « sain »).
  const aoa = [
    [null, "N° DE FP :", "FP/2026/1"],
    [null, "CLIENT :", "X"],
    [null, "PRIX DE REVIENT NEURONES TECHNOLOGIES HT (XOF)", 990000],
    [null, "PRIX DE VENTE NEURONES TECHNOLOGIES HT (XOF)", 1000000],
    [null, "MARGE BRUTE NEURONES TECHNOLOGIES (XOF)", 10000],
    [null, "% DE MARGE BRUTE NEURONES TECHNOLOGIES", 1], // colonne base-100 trompeuse
  ];
  const { sheet } = parseFiche(wbFromAoa("Fiche", aoa));
  it("%MB = marge/vente = 1 %, PAS 100 %", () => {
    expect(sheet.marginPct).toBeCloseTo(0.01, 5);
  });
});

describe("parseFicheAll — deux onglets de MÊME FP ne perdent plus de lignes (cf. audit intégral I3)", () => {
  // Fabrique une fiche cellulaire à une ligne BC (fournisseur/description/montant paramétrables).
  const fiche = (frn, desc, xof) => [
    [null, null, null, null, null, "N° DE FP :", "FP/2026/700"],
    [null, null, null, null, null, "CLIENT :", "ACME"],
    [], [],
    [null, null, "N°BC FRNS", "DESCRIPTION", "FOURNISSEUR", "TYPE", "DEVISE", "CHARGES EN DEVISE", "CHARGES EN XOF"],
    [null, "Cmd", "", desc, frn, "Matériel", "XOF", xof, xof],
    [null, "TOTAL Commandes Frns", null, null, null, null, null, null, xof],
  ];
  const twoSheets = (a, b) => wbMulti([{ name: "Fiche A", aoa: a }, { name: "Fiche B", aoa: b }]);

  it("lignes DISTINCTES (fournisseurs différents) → ids distincts, aucune perte", () => {
    const fiches = parseFicheAll(twoSheets(fiche("AITEK", "Serveur", 100), fiche("KUKUZA", "Routeur", 200)));
    const ids = fiches.flatMap((f) => f.bcLines.map((b) => b._id));
    expect(new Set(ids).size).toBe(2); // pas de collision `sid_0` → `sid_0`
  });
  it("lignes IDENTIQUES en double (onglet dupliqué) → même id → fusion (pas de double-compte)", () => {
    const fiches = parseFicheAll(twoSheets(fiche("AITEK", "Serveur", 100), fiche("AITEK", "Serveur", 100)));
    const ids = fiches.flatMap((f) => f.bcLines.map((b) => b._id));
    expect(new Set(ids).size).toBe(1); // même clé métier → même id → applyWrites fusionne
  });
});

describe("parsePnl : sélection de feuille + robustesse", () => {
  it("lit la feuille P&L même nommée différemment (détection par entête)", () => {
    const wb = wbFromRows("PnL 2026", [
      { "Opp ID": "FP/2026/9", Customer: "ZED", BU: "ICT", "Year PO": 2026, CAS: 1000, "RAF TOTAL": 100, "MB TOTAL": 50 },
    ]);
    const { rows } = parsePnl(wb);
    expect(rows).toHaveLength(1);
    expect(rows[0].fp).toBe("FP/2026/9");
    expect(rows[0].cas).toBe(1000);
  });
});

describe("parseFacturationDf : factures multi-lignes sommées", () => {
  it("somme le HT des lignes d'un même Numéro (au lieu d'écraser)", () => {
    const wb = wbFromRows("Facturation DF", [
      { "Numéro": "JVEXO/2026/0001", "Référence": "FP/2026/1", "Montant HT": 100, "Nom d'affichage du partenaire": "ACME" },
      { "Numéro": "JVEXO/2026/0001", "Référence": "FP/2026/1", "Montant HT": 250, "Nom d'affichage du partenaire": "ACME" },
      { "Numéro": "JVEXO/2026/0002", "Référence": "FP/2026/2", "Montant HT": 40, "Nom d'affichage du partenaire": "BETA" },
    ]);
    const { rows } = parseFacturationDf(wb);
    expect(rows).toHaveLength(2);
    const inv1 = rows.find((r) => r.numero === "JVEXO/2026/0001");
    expect(inv1.amountHt).toBe(350); // 100 + 250
    expect(inv1.lines).toBe(2);
  });
  it("2 lignes byte-identiques MAIS d'id de ligne distincts → SOMMÉES (plus de sous-compte CAF, I4)", () => {
    const wb = wbFromRows("Facturation DF", [
      { "Numéro": "JV/2026/9", "Montant HT": 500, "ID ligne": "L1" },
      { "Numéro": "JV/2026/9", "Montant HT": 500, "ID ligne": "L2" }, // même montant, autre ligne
      { "Numéro": "JV/2026/9", "Montant HT": 500, "ID ligne": "L2" }, // vrai artefact d'export (même id) → ignoré
    ]);
    const inv = parseFacturationDf(wb).rows.find((r) => r.numero === "JV/2026/9");
    expect(inv.amountHt).toBe(1000); // L1 + L2 (l'artefact L2 dupliqué n'est pas recompté)
    expect(inv.lines).toBe(2);
  });
});

describe("parseLogistics → bcLines (suivi BC fournisseurs)", () => {
  const { parseLogistics, mapBcStatus } = require("../parsers/logistics");
  const wb = wbFromRows("PO List", [
    { "Opp ID": "FP/2024/10855", Pays: "CI", Customer: "SICMA", "PO N°": "BC N° 06457", Fournisseur: "kukuza", Nature: "Hardware", Description: "Routeur", Montant: 370000, Currency: "XOF", Statut: "7-Livraison totale", "Montant XOF": 370000 },
    { "Opp ID": "FP/2024/1", Customer: "X", "PO N°": "BC/2024/2", Fournisseur: "FOUR", Nature: "Licence", Statut: "2- Commande placée", "Montant XOF": 1000 },
    { Pays: "CI" }, // ni n° BC, ni fournisseur, ni montant → ignorée
  ]);
  const { rows, report } = parseLogistics(wb);

  it("détectée comme kind logistics via buildWrites", () => {
    const { detectKinds } = require("../lib/ingest");
    expect(detectKinds(wb)).toContain("logistics");
  });
  it("ignore les lignes totalement vides", () => {
    expect(report.rowsIn).toBe(3);
    expect(rows).toHaveLength(2);
  });
  it("mappe les champs clés + fournisseur en MAJ", () => {
    const r = rows.find((x) => x.bcNumber === "BC N° 06457");
    expect(r.fp).toBe("FP/2024/10855");
    expect(r.supplier).toBe("KUKUZA");
    expect(r.expenseType).toBe("Hardware");
    expect(r.amountXof).toBe(370000);
    expect(r.status).toBe("livre");
    expect(r.source).toBe("logistics");
  });
  it("capte le DC (colonne « DC ») ADDITIVEMENT — clé de rattachement de secours via config/dcAliases", () => {
    const out = parseLogistics(wbFromRows("PO List", [
      { "PO N°": "BC/2026/1", Fournisseur: "ACME", "Montant XOF": 500, DC: "DC00123" },
      { "PO N°": "BC/2026/2", Fournisseur: "ACME", "Montant XOF": 700 }, // sans DC → champ NON écrit (merge préservé)
    ])).rows;
    expect(out.find((r) => r.bcNumber === "BC/2026/1").dc).toBe("DC00123");
    expect("dc" in out.find((r) => r.bcNumber === "BC/2026/2")).toBe(false);
    // Colonne FP absente → fp NON écrit (ni null) : le merge au ré-import PRÉSERVE un fp posé par
    // backfill DC / correction, et la ligne n'entre pas dans la garde anti-orphelins (gardien B1/B3).
    expect("fp" in out.find((r) => r.bcNumber === "BC/2026/1")).toBe(false);
  });
  it("deux lignes d'un même BC de MONTANTS différents ne se confondent plus (index d'occurrence)", () => {
    const rows2 = [
      { "Opp ID": "FP/2024/9", "PO N°": "BC/9", Fournisseur: "ACME", Description: "Switch", "Montant XOF": 100 },
      { "Opp ID": "FP/2024/9", "PO N°": "BC/9", Fournisseur: "ACME", Description: "Switch", "Montant XOF": 250 },
    ];
    const out = parseLogistics(wbFromRows("PO List", rows2)).rows;
    expect(out).toHaveLength(2); // conservées séparément (avant : « dernier gagne » → 1)
    expect(out.reduce((s, r) => s + r.amountXof, 0)).toBe(350);
    // Idempotence : ré-import (même corrigé sur le montant) → mêmes IDs (pas d'orphelin).
    const corrected = [{ ...rows2[0] }, { ...rows2[1], "Montant XOF": 999 }];
    const out2 = parseLogistics(wbFromRows("PO List", corrected)).rows;
    expect(out2.map((r) => r._id).sort()).toEqual(out.map((r) => r._id).sort());
  });
  it("mapBcStatus : cycle BC (a_emettre/emis/livre/facture/solde) + annule hors cycle", () => {
    expect(mapBcStatus("1- Non commandé")).toBe("a_emettre");
    expect(mapBcStatus("2- Commande placée")).toBe("emis");
    expect(mapBcStatus("6- Dedouanement")).toBe("emis");
    expect(mapBcStatus("Livrée")).toBe("livre");
    expect(mapBcStatus("2- Facturé")).toBe("facture");
    expect(mapBcStatus("Solde")).toBe("solde");
    expect(mapBcStatus("")).toBe("a_emettre");
    // ADR-068 : « Annulé » = statut PROPRE (plus a_emettre) — sort des engagements/du cash, aligné ClickUp.
    expect(mapBcStatus("Annulé")).toBe("annule");
    expect(mapBcStatus("Commande annulée")).toBe("annule");
  });
});

describe("désignation d'affaire : n'aspire pas une colonne identifiant / personne (audit #63)", () => {
  it("P&L : « Chargé d'affaires » n'est PAS pris pour la désignation", () => {
    const wb = wbFromRows("P&L", [{ "Opp ID": "FP/2026/1", Customer: "ACME", BU: "ICT", "Year PO": 2026, CAS: 1000, "Chargé d'affaires": "KOUAME" }]);
    expect(parsePnl(wb).rows[0].designation).toBe("");
  });
  it("P&L : une vraie colonne « Désignation » est captée malgré la présence du chargé d'affaires", () => {
    const wb = wbFromRows("P&L", [{ "Opp ID": "FP/2026/1", Customer: "ACME", BU: "ICT", "Year PO": 2026, CAS: 1000, "Désignation": "RESEAU CAMPUS", "Chargé d'affaires": "KOUAME" }]);
    expect(parsePnl(wb).rows[0].designation).toBe("RESEAU CAMPUS");
  });
  it("LIVE : « N° Opportunité » (identifiant) n'est PAS pris pour la désignation", () => {
    const wb = wbFromRows("LIVE", [{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "N° Opportunité": "OPP-123" }]);
    expect(parseSalesData(wb).rows[0].designation).toBe("");
  });
  it("LIVE : une vraie colonne « Désignation » est captée malgré le n° d'opportunité", () => {
    const wb = wbFromRows("LIVE", [{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "Désignation": "MIGRATION O365", "N° Opportunité": "OPP-123" }]);
    expect(parseSalesData(wb).rows[0].designation).toBe("MIGRATION O365");
  });
});

describe("commercial (AM) : un libellé numérique n'est pas un nom (audit #63/#3)", () => {
  it("LIVE : AM numérique (« 25.69 ») ignoré → vide", () => {
    const wb = wbFromRows("LIVE", [{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "NEW AM": 25.69 }]);
    expect(parseSalesData(wb).rows[0].am).toBe("");
  });
  it("LIVE : AM texte conservé", () => {
    const wb = wbFromRows("LIVE", [{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "NEW AM": "DATCHA" }]);
    expect(parseSalesData(wb).rows[0].am).toBe("DATCHA");
  });
  it("P&L : AM numérique (« 35 ») ignoré → vide", () => {
    const wb = wbFromRows("P&L", [{ "Opp ID": "FP/2026/1", Customer: "ACME", BU: "ICT", "Year PO": 2026, CAS: 1000, AM: 35 }]);
    expect(parsePnl(wb).rows[0].am).toBe("");
  });
});
