import { describe, it, expect } from "vitest";
const { mapOdooRecord, mapOpportunity, mapOrder, mapInvoice } = require("../domain/odooSync");

describe("odooSync — mapping du contrat Odoo → docs nt360", () => {
  it("opportunité : canonicalise le FP, dérive stageLabel/weighted, trace odooId + source", () => {
    const m = mapOpportunity({ odooId: "crm.lead:42", fp: "FP/2026/007", client: "  ACME  ", am: "diallo", bu: "ict", amount: "1 000 000", stage: 6, probability: 90, closingDate: "2026-03-15" });
    expect(m.ok).toBe(true);
    expect(m.collection).toBe("opportunities");
    expect(m.key.fp).toBe("FP/2026/7");   // zéros de tête normalisés (fpKey)
    expect(m.doc.fp).toBe("FP/2026/7");
    expect(m.doc.bu).toBe("ICT");
    expect(m.doc.amount).toBe(1000000);
    expect(m.doc.stageLabel).toBeTruthy();
    expect(m.doc.weighted).toBe(900000); // 1M × 90%
    expect(m.doc.source).toBe("odoo");
    expect(m.doc.odooId).toBe("crm.lead:42");
  });
  it("opportunité : mappe la désignation (nom de l'affaire) et la date de création Odoo", () => {
    const m = mapOpportunity({ odooId: "crm.lead:8", client: "ACME", designation: "  Refonte SI  ", dateCreation: "2026-01-05" });
    expect(m.doc.designation).toBe("Refonte SI");
    expect(m.doc.dateCreation).toBe("2026-01-05");
    // alias : `name` et `createdDate` acceptés si l'émetteur Odoo les nomme ainsi
    const m2 = mapOpportunity({ odooId: "crm.lead:9", client: "X", name: "TMA", createdDate: "2026-02-01" });
    expect(m2.doc.designation).toBe("TMA");
    expect(m2.doc.dateCreation).toBe("2026-02-01");
  });
  it("opportunité sans fp NI odooId → rejet (clé de rapprochement manquante)", () => {
    expect(mapOpportunity({ client: "ACME", amount: 500 }).ok).toBe(false);
  });
  it("opportunité par odooId seul (sans fp) → acceptée, fp null", () => {
    const m = mapOpportunity({ odooId: "crm.lead:7", client: "ACME", stage: 2 });
    expect(m.ok).toBe(true);
    expect(m.doc.fp).toBeNull();
    expect(m.key.odooId).toBe("crm.lead:7");
  });

  it("commande : id déterministe safeId(fp) (converge avec l'import P&L), suppliers filtrés", () => {
    const m = mapOrder({ odooId: "sale.order:9", fp: "FP/2026/12", client: "BETA", designation: "TMA", bu: "cloud", yearPo: "2026", cas: "5000000", raf: "1000000", suppliers: [{ name: "SousTraitant", amount: 200000 }, { name: "", amount: 0 }] });
    expect(m.ok).toBe(true);
    expect(m.collection).toBe("orders");
    expect(m.id).toBe("FP_2026_12"); // safeId(fp)
    expect(m.doc.cas).toBe(5000000);
    expect(m.doc.raf).toBe(1000000);
    expect(m.doc.suppliers).toEqual([{ name: "SOUSTRAITANT", amount: 200000 }]); // cleanName MAJUSCULE (comme le parseur P&L)
  });
  it("commande sans fp → rejet ; raf absent → clé OMISE (merge:true préserve le RAF curaté P&L)", () => {
    expect(mapOrder({ client: "X", cas: 1000 }).ok).toBe(false);
    // Doc ADDITIF : raf non fourni → clé absente du doc (et non `raf:null`), sinon merge:true écraserait le
    // RAF figé importé du P&L. « repli dérivé » de mergeCommandes conservé côté carnet (o.raf != null → false).
    expect("raf" in mapOrder({ fp: "FP/2026/1", cas: 1000 }).doc).toBe(false);
  });
  it("commande : update Odoo PARTIEL n'écrase pas les champs curatés P&L (clés omises)", () => {
    // Odoo n'émet que fp + cas → aucune autre clé posée : merge:true préserve raf/designation/client/bu figés.
    const d = mapOrder({ fp: "FP/2026/1", cas: 5000 }).doc;
    expect(d.cas).toBe(5000);
    expect("raf" in d).toBe(false);
    expect("designation" in d).toBe(false);
    expect("client" in d).toBe(false);
    expect("bu" in d).toBe(false);
    expect("suppliers" in d).toBe(false);
    // cas explicitement à 0 → posé (present() distingue 0 fourni d'un cas absent)
    expect(mapOrder({ fp: "FP/2026/1", cas: 0 }).doc.cas).toBe(0);
    expect("cas" in mapOrder({ fp: "FP/2026/1", raf: 100 }).doc).toBe(false);
  });
  it("commande : mappe dateCommande + dateCreation ; dérive yearPo de la date si absent", () => {
    const m = mapOrder({ fp: "FP/2026/1", cas: 1000, dateCommande: "2026-03-15", dateCreation: "2026-03-01" });
    expect(m.doc.dateCommande).toBe("2026-03-15");
    expect(m.doc.dateCreation).toBe("2026-03-01");
    expect(m.doc.yearPo).toBe(2026); // dérivé de dateCommande faute de yearPo explicite
    // yearPo explicite prime sur la date
    expect(mapOrder({ fp: "FP/2026/2", yearPo: "2025", dateCommande: "2026-03-15" }).doc.yearPo).toBe(2025);
    // date sentinelle rejetée → clé dateCommande OMISE (doc additif) plutôt qu'écrite à null
    expect("dateCommande" in mapOrder({ fp: "FP/2026/3", dateCommande: "1899-12-31" }).doc).toBe(false);
  });

  it("facture : id déterministe safeId(numero), fp rapproché par fpKey, paid détecté", () => {
    const m = mapInvoice({ odooId: "account.move:100", numero: "FA-2026-0001", fp: "FP/2026/3", client: "ACME", amountHt: "750000", date: "2026-02-01", paid: "Payé" });
    expect(m.ok).toBe(true);
    expect(m.collection).toBe("invoices");
    expect(m.id).toBe("FA-2026-0001"); // safeId(numero) — pas de '/'
    expect(m.doc.fp).toBe("FP/2026/3");
    expect(m.doc.amountHt).toBe(750000);
    expect(m.doc.paid).toBe(true);
  });
  it("facture sans numero → rejet ; date sentinelle 1899 → null", () => {
    expect(mapInvoice({ fp: "FP/2026/3", amountHt: 100 }).ok).toBe(false);
    expect(mapInvoice({ numero: "FA-1", date: "1899-12-31" }).doc.date).toBeNull();
  });

  it("objet inconnu → rejet explicite", () => {
    expect(mapOdooRecord("contact", {}).ok).toBe(false);
    expect(mapOdooRecord("order", { fp: "FP/2026/1", cas: 1 }).ok).toBe(true);
  });
});
