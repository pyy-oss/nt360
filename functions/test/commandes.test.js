import { describe, it, expect } from "vitest";
const { mergeCommandes, illegibleOrders } = require("../domain/commandes");
const { buildFpAliasResolver } = require("../lib/ids");

describe("illegibleOrders — lignes P&L au N° FP illisible (perte de CA autrement invisible)", () => {
  it("retient les lignes à FP non canonique ET CAS>0 ; écarte les FP valides et les lignes vides", () => {
    const raw = [
      { fp: "FP/2024/7", client: "OK", cas: 1000 },       // canonique → écarté (pas une perte)
      { fp: "FP/2024", client: "A", cas: 50000 },         // séquence absente → retenu
      { fp: "FP/20244/3", client: "B", cas: 999 },        // année à 5 chiffres → retenu
      { fp: "FP/2024/0000", client: "C", cas: 1 },        // séquence factice → retenu
      { fp: "SANS-FP", client: "D", cas: 0 },             // illisible mais CAS 0 → écarté (ligne vide)
    ];
    const out = illegibleOrders(raw);
    expect(out.map((o) => o.client)).toEqual(["A", "B", "C"]);
  });
  it("ces lignes sont RÉELLEMENT écartées du carnet par mergeCommandes (d'où l'anomalie)", () => {
    const merged = mergeCommandes([{ fp: "FP/2024", client: "A", cas: 50000 }], [], [], []);
    expect(merged).toEqual([]); // la ligne à FP illisible n'entre pas dans le carnet
  });
});

describe("mergeCommandes — P&L strict : commande = ligne P&L ; opp/fiche réconcilient", () => {
  const orders = [
    { fp: "FP/2026/1", client: "PNL", bu: "ICT", am: "X", cas: 500, raf: 200, mb: 50, yearPo: 2026, source: "pnl", suppliers: [{ name: "S", amount: 100 }] },
    { fp: "FP/2026/9", client: "PNLONLY", bu: "CLOUD", cas: 300, raf: 300, mb: 30, yearPo: 2026, source: "pnl" },
    { fp: "FP/2026/5", client: "PNLMB", bu: "ICT", am: "Z", cas: 600, raf: 100, mb: 120, marginPct: 0.2, costTotal: 480, yearPo: 2026, source: "pnl" },
  ];
  const opps = [
    { fp: "FP/2026/1", client: "OPP", am: "AM1", bu: "ICT", amount: 800, stage: 6, closingDate: "2026-05-01" }, // gagnée sur P&L → réconcilie
    { fp: "FP/2026/2", client: "BETA", am: "AM2", bu: "CLOUD", amount: 1000, stage: 6, closingDate: "2026-06-01" }, // gagnée SANS P&L → ignorée
    { fp: "FP/2026/3", client: "GAMMA", amount: 400, stage: 4, closingDate: "2026-07-01" }, // pas gagnée → ignorée
    { fp: "FP/2026/5", client: "OPP5", am: "AM5", bu: "ICT", amount: 700, stage: 6, closingDate: "2026-08-01" }, // gagnée sur P&L : garde la marge P&L
  ];
  const sheets = [
    { fp: "FP/2026/1", client: "SAFINE", commercial: "AF", affaire: "RESEAUX", saleTotal: 900, margin: 90, costTotal: 810, marginPct: 0.1 }, // enrichit la ligne P&L
  ];
  const invoices = [{ fp: "FP/2026/2", amountHt: 250 }]; // facturé sur un FP sans commande
  const cmd = mergeCommandes(orders, opps, sheets, invoices);
  const byFp = Object.fromEntries(cmd.map((c) => [c.fp, c]));

  it("fiche enrichit une ligne P&L existante (CAS=vente, marge, client, AM, affaire)", () => {
    const c = byFp["FP/2026/1"];
    expect(c.source).toBe("fiche");
    expect(c.cas).toBe(900);
    expect(c.mb).toBe(90);
    expect(c.client).toBe("SAFINE");
    expect(c.am).toBe("AF");
    expect(c.affaire).toBe("RESEAUX");
  });
  it("opp gagnée SANS ligne P&L → aucune commande créée (P&L strict)", () => {
    expect(byFp["FP/2026/2"]).toBeUndefined();
  });
  it("opp gagnée sur un P&L : CAS=opp mais marge/coût P&L CONSERVÉS (pnlSource=manuel)", () => {
    const c = byFp["FP/2026/5"];
    expect(c.source).toBe("opp_won");
    expect(c.cas).toBe(700); // CAS = montant de l'opp gagnée
    expect(c.mb).toBe(120); // marge P&L conservée
    expect(c.marginPct).toBe(0.2);
    expect(c.costTotal).toBe(480);
    expect(c.pnlSource).toBe("manuel");
  });
  it("opp NON gagnée ignorée", () => expect(byFp["FP/2026/3"]).toBeUndefined());
  it("P&L conservé si ni fiche ni opp gagnée ; RAF Excel conservé (pnlSource=manuel)", () => {
    const c = byFp["FP/2026/9"];
    expect(c.source).toBe("pnl");
    expect(c.cas).toBe(300);
    expect(c.raf).toBe(300); // RAF Excel du P&L conservé
    expect(c.pnlSource).toBe("manuel");
  });
  it("fiche affaire → pnlSource=fiche (provenance de la marge)", () => expect(byFp["FP/2026/1"].pnlSource).toBe("fiche"));
  it("commandes = uniquement les FP présents au P&L", () => {
    expect(cmd.map((c) => c.fp).sort()).toEqual(["FP/2026/1", "FP/2026/5", "FP/2026/9"]);
  });
});

describe("mergeCommandes — casPnl conservé (contrôle de cohérence amont ADR-030+)", () => {
  // casPnl = CAS d'ORIGINE de la ligne P&L, gardé même quand une opp gagnée / fiche écrase `cas`. Sert au
  // prédicat « écart de valorisation » (alerts/dataQuality). Sans lui, la valeur P&L écrasée serait perdue.
  const orders = [
    { fp: "FP/2026/1", client: "PNL", cas: 500, yearPo: 2026, source: "pnl" }, // écrasé par la fiche
    { fp: "FP/2026/5", client: "PNLMB", cas: 600, mb: 120, yearPo: 2026, source: "pnl" }, // écrasé par l'opp gagnée
    { fp: "FP/2026/9", client: "PNLONLY", cas: 300, yearPo: 2026, source: "pnl" }, // ni opp ni fiche
  ];
  const opps = [{ fp: "FP/2026/5", client: "OPP5", amount: 700, stage: 6, closingDate: "2026-08-01" }];
  const sheets = [{ fp: "FP/2026/1", client: "SAFINE", saleTotal: 900, margin: 90 }];
  const byFp = Object.fromEntries(mergeCommandes(orders, opps, sheets, []).map((c) => [c.fp, c]));

  it("fiche : cas = vente mais casPnl garde la valeur P&L d'origine", () => {
    expect(byFp["FP/2026/1"].cas).toBe(900);
    expect(byFp["FP/2026/1"].casPnl).toBe(500);
  });
  it("opp gagnée : cas = montant opp mais casPnl garde la valeur P&L d'origine", () => {
    expect(byFp["FP/2026/5"].cas).toBe(700);
    expect(byFp["FP/2026/5"].casPnl).toBe(600);
  });
  it("ni opp ni fiche : casPnl == cas (aucun écrasement)", () => {
    expect(byFp["FP/2026/9"].cas).toBe(300);
    expect(byFp["FP/2026/9"].casPnl).toBe(300);
  });
});

describe("réconciliation FP (config/fpAliases) : une opp gagnée sous un AUTRE N° FP se rattache au P&L", () => {
  // Scénario réel : la commande est DÉJÀ au P&L sous FP/2026/500 (lié à la facturation), mais l'opp
  // gagnée a été saisie sous FP/2026/13 (padding/numérotation différente). Sans réconciliation, l'opp
  // est « gagnée sans P&L » → ignorée (P&L strict), et son CAS ne remonte pas. Avec l'alias
  // 13 → 500 appliqué EN AMONT (comme dans aggregate.js), l'opp réconcilie la bonne ligne P&L.
  const orders = [{ fp: "FP/2026/500", client: "PNL", bu: "ICT", cas: 500, raf: 200, yearPo: 2026, source: "pnl" }];
  const opps = [{ fp: "FP/2026/13", client: "OPP", am: "AM1", bu: "ICT", amount: 800, stage: 6, closingDate: "2026-05-01" }];

  it("SANS alias : l'opp (FP différent) n'a pas de P&L → aucune réconciliation (CAS P&L inchangé)", () => {
    const cmd = mergeCommandes(orders, opps, [], []);
    const byFp = Object.fromEntries(cmd.map((c) => [c.fp, c]));
    expect(byFp["FP/2026/13"]).toBeUndefined(); // opp gagnée sans P&L → ignorée
    expect(byFp["FP/2026/500"].source).toBe("pnl");
    expect(byFp["FP/2026/500"].cas).toBe(500); // CAS reste celui du P&L
  });

  it("AVEC alias 13 → 500 : l'opp réconcilie la ligne P&L (CAS = montant opp gagnée)", () => {
    const canonFp = buildFpAliasResolver({ "FP/2026/13": "FP/2026/500" });
    const oppsAliased = opps.map((o) => ({ ...o, fp: canonFp(o.fp) }));
    const cmd = mergeCommandes(orders, oppsAliased, [], []);
    const byFp = Object.fromEntries(cmd.map((c) => [c.fp, c]));
    // Toujours UNE seule commande (le P&L reste la colonne vertébrale) — pas de doublon.
    expect(cmd.map((c) => c.fp)).toEqual(["FP/2026/500"]);
    const c = byFp["FP/2026/500"];
    expect(c.source).toBe("opp_won"); // réconciliée par l'opp gagnée
    expect(c.cas).toBe(800); // CAS = montant de l'opp gagnée (elle remonte enfin)
    expect(c.client).toBe("OPP");
  });
});

describe("mergeCommandes — désignation d'affaire (description)", () => {
  it("affaire = fiche > désignation opp gagnée > désignation P&L", () => {
    const c = mergeCommandes(
      [
        { fp: "FP/2026/1", cas: 500, designation: "P&L DESIGN", source: "pnl" },
        { fp: "FP/2026/2", cas: 300, designation: "P&L ONLY", source: "pnl" },
      ],
      [{ fp: "FP/2026/1", client: "X", amount: 800, stage: 6, designation: "OPP DESIGN", closingDate: "2026-05-01" }],
      [{ fp: "FP/2026/1", client: "X", saleTotal: 900, margin: 90, affaire: "FICHE AFFAIRE" }],
      [],
    );
    const byFp = Object.fromEntries(c.map((x) => [x.fp, x]));
    expect(byFp["FP/2026/1"].affaire).toBe("FICHE AFFAIRE"); // la fiche prime
    expect(byFp["FP/2026/2"].affaire).toBe("P&L ONLY");      // désignation P&L conservée
  });
});

describe("mergeCommandes — repli marge : MB de l'opp quand ni MB TOTAL ni fiche (ADR-056)", () => {
  const base = { client: "A", bu: "ICT", am: "X", yearPo: 2026, source: "pnl" };
  const one = (orders, opps, sheets) => mergeCommandes(orders, opps, sheets || [], [])[0];

  it("P&L sans MB TOTAL + opp portant mbPrev → mb dérivé = mbPrev% × CAS, flag mbSource=opp", () => {
    const c = one(
      [{ ...base, fp: "FP/2026/10", cas: 1000, mb: 0, mbPresent: false }],
      [{ fp: "FP/2026/10", mbPrev: 20, stage: 4 }],
    );
    expect(c.mb).toBe(200);          // 20 % × 1000
    expect(c.mbSource).toBe("opp");
  });

  it("MB TOTAL renseigné (même 0) → marge P&L RÉELLE conservée, aucun repli (mbSource absent)", () => {
    const c = one(
      [{ ...base, fp: "FP/2026/11", cas: 1000, mb: 0, mbPresent: true }],
      [{ fp: "FP/2026/11", mbPrev: 20, stage: 4 }],
    );
    expect(c.mb).toBe(0);
    expect(c.mbSource).toBeUndefined();
  });

  it("fiche présente → autorité marge fiche, le repli opp est ignoré", () => {
    const c = one(
      [{ ...base, fp: "FP/2026/12", cas: 1000, mb: 0, mbPresent: false }],
      [{ fp: "FP/2026/12", mbPrev: 50, stage: 4 }],
      [{ fp: "FP/2026/12", saleTotal: 1000, margin: 300, costTotal: 700, marginPct: 0.3 }],
    );
    expect(c.source).toBe("fiche");
    expect(c.mb).toBe(300);          // marge de la fiche, pas 50 % × 1000
    expect(c.mbSource).toBeUndefined();
  });

  it("aucune opp porteuse de MB pour le FP → marge laissée vide (aucune invention)", () => {
    const c = one([{ ...base, fp: "FP/2026/13", cas: 1000, mb: 0, mbPresent: false }], []);
    expect(c.mb).toBe(0);
    expect(c.mbSource).toBeUndefined();
  });

  it("legacy sans mbPresent : un mb>0 (marge P&L existante) n'est jamais écrasé par l'opp", () => {
    const c = one(
      [{ ...base, fp: "FP/2026/15", cas: 1000, mb: 150 }], // mbPresent absent (données antérieures)
      [{ fp: "FP/2026/15", mbPrev: 40, stage: 4 }],
    );
    expect(c.mb).toBe(150);          // marge P&L conservée
    expect(c.mbSource).toBeUndefined();
  });

  it("plusieurs opps d'un même FP : la plus avancée (stage) prime, puis le mbPrev le plus élevé", () => {
    const c = one(
      [{ ...base, fp: "FP/2026/14", cas: 1000, mb: 0, mbPresent: false }],
      [{ fp: "FP/2026/14", mbPrev: 40, stage: 3 }, { fp: "FP/2026/14", mbPrev: 10, stage: 6 }],
    );
    expect(c.mb).toBe(100);          // stage 6 (10 %) prime sur stage 3 (40 %)
  });
});

describe("mergeCommandes — garde-fous", () => {
  it("opp gagnée SANS montant n'écrase pas le CAS P&L existant", () => {
    const orders = [{ fp: "FP/2026/1", client: "PNL", cas: 500, raf: 200, mb: 120, yearPo: 2026, source: "pnl" }];
    const opps = [{ fp: "FP/2026/1", client: "OPP", am: "AM1", amount: 0, stage: 6, closingDate: "2026-05-01" }];
    const c = mergeCommandes(orders, opps, [], []);
    const row = c.find((x) => x.fp === "FP/2026/1");
    expect(row.cas).toBe(500); // CAS P&L conservé (pas remis à 0)
    expect(row.mb).toBe(120);
    expect(row.source).toBe("opp_won"); // réconciliée mais sans changement de CAS
  });
  it("opp gagnée SANS P&L → aucune commande fantôme (avec ou sans montant)", () => {
    const c = mergeCommandes([], [
      { fp: "FP/2026/2", client: "X", amount: 0, stage: 6 },
      { fp: "FP/2026/3", client: "Y", amount: 999, stage: 6, closingDate: "2026-01-01" },
    ], [], []);
    expect(c).toHaveLength(0);
  });
  it("fiche SANS ligne P&L → ignorée (pas de commande)", () => {
    const sheets = [{ fp: "FP/2026/1", client: "SAFINE", saleTotal: 900, margin: 90 }];
    const c = mergeCommandes([], [], sheets, []);
    expect(c).toHaveLength(0);
  });
  it("fiche SANS prix de vente (0) n'écrase pas la ligne P&L existante", () => {
    const orders = [{ fp: "FP/2026/1", client: "PNL", cas: 500, raf: 200, mb: 120, yearPo: 2026, source: "pnl" }];
    const sheets = [{ fp: "FP/2026/1", client: "SAFINE", saleTotal: 0, margin: 0 }];
    const c = mergeCommandes(orders, [], sheets, []);
    const row = c.find((x) => x.fp === "FP/2026/1");
    expect(row.cas).toBe(500); // CAS P&L préservé
    expect(row.mb).toBe(120);
    expect(row.source).toBe("pnl"); // fiche vide ignorée
  });
});

describe("mergeCommandes — RAF adossé au P&L (curaté Excel) vs dérivé", () => {
  it("P&L avec RAF Excel : conserve son RAF (non recalculé, rattachement facturation partiel)", () => {
    const orders = [{ fp: "FP/2024/1", client: "ACME", cas: 1000, raf: 800, yearPo: 2024, source: "pnl" }];
    const invoices = [{ fp: "FP/2024/1", amountHt: 600, date: "2025-02-01" }];
    const c = mergeCommandes(orders, [], [], invoices);
    expect(c[0].raf).toBe(800); // RAF Excel conservé (et non 1000 − 600)
    expect(c[0].rafSource).toBe("excel");
  });
  it("P&L sans RAF Excel → dérivé max(CAS − facturé, 0)", () => {
    const orders = [{ fp: "FP/2024/2", client: "ACME", cas: 1000, yearPo: 2024, source: "pnl" }]; // raf absent
    const invoices = [{ fp: "FP/2024/2", amountHt: 600 }];
    const c = mergeCommandes(orders, [], [], invoices);
    expect(c[0].raf).toBe(400);
    expect(c[0].rafSource).toBe("derive");
  });
  it("opp gagnée ayant réconcilié un P&L → garde le RAF Excel curaté (pas de recalcul)", () => {
    const orders = [{ fp: "FP/2026/7", client: "PNL", cas: 600, raf: 100, mb: 120, yearPo: 2026, source: "pnl" }];
    const opps = [{ fp: "FP/2026/7", client: "OPP", am: "AM", amount: 700, stage: 6, closingDate: "2026-08-01" }];
    const invoices = [{ fp: "FP/2026/7", amountHt: 50 }]; // facturation partielle
    const c = mergeCommandes(orders, opps, [], invoices);
    const row = c.find((x) => x.fp === "FP/2026/7");
    expect(row.source).toBe("opp_won");
    expect(row.cas).toBe(700);         // CAS de l'opp
    expect(row.raf).toBe(100);         // RAF Excel du P&L conservé (et non 700 − 50 = 650)
    expect(row.rafSource).toBe("excel");
  });
  it("fiche enrichissant un P&L sans RAF Excel → dérivé, borné à 0 si surfacturé", () => {
    const orders = [{ fp: "FP/2026/9", client: "PNL", cas: 400, yearPo: 2026, source: "pnl" }]; // pas de raf
    const sheets = [{ fp: "FP/2026/9", client: "SAFINE", saleTotal: 500, margin: 50 }];
    const invoices = [{ fp: "FP/2026/9", amountHt: 700 }];
    const c = mergeCommandes(orders, [], sheets, invoices);
    const row = c.find((x) => x.fp === "FP/2026/9");
    expect(row.raf).toBe(0); // max(500 − 700, 0)
    expect(row.rafSource).toBe("derive");
  });
});
