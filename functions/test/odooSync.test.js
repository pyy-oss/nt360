import { describe, it, expect } from "vitest";
const { mapOdooRecord, mapOpportunity, mapOrder, mapInvoice, mapBc, resolveBcFp } = require("../domain/odooSync");

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
  it("facture sans numero → rejet ; date sentinelle 1899 → clé OMISE (additif, pas d'écrasement au merge)", () => {
    expect(mapInvoice({ fp: "FP/2026/3", amountHt: 100 }).ok).toBe(false);
    expect("date" in mapInvoice({ numero: "FA-1", date: "1899-12-31" }).doc).toBe(false);
    // fp illisible → clé omise (n'écrase pas une correction setInvoiceFp au merge) ; key.fp = null
    const mBadFp = mapInvoice({ numero: "FA-2", fp: "FP/2026/0000" });
    expect("fp" in mBadFp.doc).toBe(false);
    expect(mBadFp.key.fp).toBe(null);
  });

  it("BC : cible bcLines, canonicalise fp, doc additif, trace source odoo (ADR-051)", () => {
    const m = mapBc({ odooId: "purchase.order:55", bcNumber: "BC/2026/9", fp: "FP/2026/012", supplier: "  soustraitant  ", currency: "eur", amount: "1500", status: "emis", eta: "2026-04-10", dc: "DC/2026/77" });
    expect(m.ok).toBe(true);
    expect(m.collection).toBe("bcLines");
    expect(m.object).toBe("bc");
    expect(m.key.bcNumber).toBe("BC/2026/9");
    expect(m.key.fp).toBe("FP/2026/12"); // fpKey normalise les zéros de tête
    expect(m.doc.source).toBe("odoo");
    expect(m.doc.supplier).toBe("SOUSTRAITANT"); // cleanName (MAJUSCULES) comme les autres sources
    expect(m.doc.currency).toBe("EUR");
    expect(m.doc.amount).toBe(1500);
    expect(m.doc.statusRaw).toBe("emis"); // le handler valide/clampe contre BC_STAGES + fx
    expect(m.doc.etaReel).toBe("2026-04-10");
    expect(m.doc.dc).toBe("DC/2026/77"); // capté additivement, FP reste la clé
  });
  it("BC : doc ADDITIF — champs absents omis (pas d'écrasement au merge) ; bcNumber requis", () => {
    expect(mapBc({ supplier: "X", amount: 100 }).ok).toBe(false); // sans N° BC → rejet
    const d = mapBc({ bcNumber: "BC-1", status: "livre" }).doc; // update partiel (statut seul)
    expect(d.bcNumber).toBe("BC-1");
    expect(d.statusRaw).toBe("livre");
    expect("amount" in d).toBe(false);
    expect("supplier" in d).toBe(false);
    expect("fp" in d).toBe(false);
    expect("currency" in d).toBe(false);
  });
  it("BC : dispatch via mapOdooRecord + amountXof (contre-valeur saisie) capté", () => {
    const m = mapOdooRecord("bc", { bcNumber: "BC-7", amount: 1000, currency: "USD", amountXof: 600000 });
    expect(m.ok).toBe(true);
    expect(m.doc.amountXof).toBe(600000);
  });

  it("DC (ADR-052) : identifiant propre capté additivement sur opp/order/invoice/bc, FP reste la clé", () => {
    expect(mapOpportunity({ odooId: "crm.lead:1", fp: "FP/2026/1", dc: "DC/2026/5" }).doc.dc).toBe("DC/2026/5");
    expect(mapOrder({ fp: "FP/2026/1", cas: 100, dc: "DC/2026/6" }).doc.dc).toBe("DC/2026/6");
    expect(mapInvoice({ numero: "FA-1", dc: "DC/2026/7" }).doc.dc).toBe("DC/2026/7");
    expect(mapBc({ bcNumber: "BC-1", dc: "DC/2026/8" }).doc.dc).toBe("DC/2026/8");
    // DC absent → clé omise (doc additif, pas d'écrasement au merge) ; le FP reste la clé de rapprochement
    expect("dc" in mapOrder({ fp: "FP/2026/1", cas: 100 }).doc).toBe(false);
    expect(mapOrder({ fp: "FP/2026/1", cas: 100, dc: "DC/2026/6" }).key.fp).toBe("FP/2026/1");
  });

  it("BC : champs additifs etaContrat / updateDate / comment captés (ADR-054)", () => {
    const m = mapBc({ bcNumber: "BC-2", etaContrat: "2026-05-01", updateDate: "2026-05-10", comment: "  urgent  " });
    expect(m.doc.etaContrat).toBe("2026-05-01");
    expect(m.doc.updateDate).toBe("2026-05-10");
    expect(m.doc.comment).toBe("urgent"); // str() trim
    // absents → omis (doc additif, pas d'écrasement au merge)
    const d = mapBc({ bcNumber: "BC-3" }).doc;
    expect("etaContrat" in d).toBe(false);
    expect("updateDate" in d).toBe(false);
    expect("comment" in d).toBe(false);
    // date invalide → clé OMISE (isoDay null gaté sur le résultat) : n'écrase pas une valeur curatée au merge
    expect("etaContrat" in mapBc({ bcNumber: "BC-4", etaContrat: "pas-une-date" }).doc).toBe(false);
    // fp placeholder illisible → clé fp OMISE (H2 : n'écrase pas un bon FP au merge sur ré-envoi Odoo)
    expect("fp" in mapBc({ bcNumber: "BC-5", fp: "FP/2026/0000" }).doc).toBe(false);
  });

  it("objet inconnu → rejet explicite", () => {
    expect(mapOdooRecord("contact", {}).ok).toBe(false);
    expect(mapOdooRecord("order", { fp: "FP/2026/1", cas: 1 }).ok).toBe(true);
    expect(mapOdooRecord("bc", { bcNumber: "BC-1" }).ok).toBe(true);
  });
});

describe("resolveBcFp — rapprochement DC → N° FP du BC Odoo (overlay config/dcAliases, ADR-054)", () => {
  it("FP explicite fourni par Odoo → PRIME toujours (cas normal FP+DC)", () => {
    const doc = mapBc({ bcNumber: "BC-1", fp: "FP/2026/12", dc: "DC-9" }).doc;
    expect(resolveBcFp(doc, { "DC-9": "FP/2099/1" })).toBe("FP/2026/12"); // l'overlay ne détourne pas un FP explicite
  });
  it("FP absent + DC connu de l'overlay → FP de l'affaire (canonique)", () => {
    const doc = mapBc({ bcNumber: "BC-1", dc: "DC-9" }).doc; // pas de fp
    expect("fp" in doc).toBe(false);
    expect(resolveBcFp(doc, { "DC-9": "FP/2026/007" })).toBe("FP/2026/7"); // fpKey normalise les zéros de tête
  });
  it("FP absent + DC inconnu / overlay vide → null (aucun rattachement forcé)", () => {
    const doc = mapBc({ bcNumber: "BC-1", dc: "DC-9" }).doc;
    expect(resolveBcFp(doc, {})).toBe(null);
    expect(resolveBcFp(doc, { "DC-AUTRE": "FP/2026/1" })).toBe(null);
    expect(resolveBcFp(mapBc({ bcNumber: "BC-1" }).doc, { "DC-9": "FP/2026/1" })).toBe(null); // ni fp ni dc
  });
});
