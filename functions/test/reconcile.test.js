import { describe, it, expect } from "vitest";
const { reconcileClients } = require("../domain/reconcile");
const { fpKey, buildFpAliasResolver } = require("../lib/ids");

// Résolveurs par défaut : clé FP canonique + client trim/uppercase (pas d'alias sauf mention).
const keyOf = (aliasMap = {}) => { const r = buildFpAliasResolver(aliasMap); return (fp) => fpKey(r(fp)); };
const nc = (c) => String(c || "").trim().toUpperCase();
const find = (out, client) => out.find((d) => d.client === client);

describe("reconcileClients — dossier client & propositions de rapprochement FP", () => {
  it("regroupe par client puis par N° FP ; ignore les lignes sans FP exploitable", () => {
    const out = reconcileClients({
      orders: [{ fp: "FP/2026/1", client: "acme", cas: 500 }, { fp: "N/A", client: "acme", cas: 10 }],
      invoices: [{ fp: "FP/2026/1", client: "ACME", amountHt: 200 }],
      opps: [{ fp: "FP/2026/1", client: "Acme", amount: 500, stage: 6 }],
      fpKeyOf: keyOf(), normClient: nc,
    });
    const d = find(out, "ACME");
    expect(d).toBeTruthy();
    expect(d.clusters.length).toBe(1); // le « N/A » (sans FP) est écarté
    const c = d.clusters[0];
    expect(c.fp).toBe("FP/2026/1");
    expect(c.orderCas).toBe(500);
    expect(c.invoiceTotal).toBe(200);
    expect(c.oppAmount).toBe(500);
    expect(c.hasOrder && c.hasInvoice).toBe(true);
    expect(d.counts).toEqual({ opps: 1, orders: 1, invoices: 1 });
  });

  it("A. opp gagnée sans P&L + commande de même montant sous un autre FP → propose l'alias vers le FP d'autorité (facture prioritaire)", () => {
    const out = reconcileClients({
      orders: [{ fp: "FP/2026/500", client: "ACME", cas: 800 }],
      invoices: [{ fp: "FP/2026/500", client: "ACME", amountHt: 800 }],
      opps: [{ fp: "FP/2026/13", client: "ACME", amount: 800, stage: 6 }], // gagnée, FP différent, pas de P&L
      fpKeyOf: keyOf(), normClient: nc,
    });
    const d = find(out, "ACME");
    expect(d.wonNoPnl).toBe(1);
    expect(d.suggestions).toHaveLength(1);
    expect(d.suggestions[0]).toMatchObject({ from: "FP/2026/13", to: "FP/2026/500", reason: "opp_gagnee_sans_pnl", targetHasInvoice: true });
  });

  it("A bis. opp gagnée sans jumeau de même montant → AUCUNE proposition (conservateur), mais comptée wonNoPnl", () => {
    const out = reconcileClients({
      orders: [{ fp: "FP/2026/500", client: "ACME", cas: 999 }], // montant très différent
      invoices: [], opps: [{ fp: "FP/2026/13", client: "ACME", amount: 800, stage: 6 }],
      fpKeyOf: keyOf(), normClient: nc,
    });
    const d = find(out, "ACME");
    expect(d.wonNoPnl).toBe(1);
    expect(d.suggestions).toHaveLength(0);
  });

  it("B. commande sans facture + facture orpheline de même montant sous un autre FP → le FP FACTURE fait foi (commande → facture)", () => {
    const out = reconcileClients({
      orders: [{ fp: "FP/2026/500", client: "ACME", cas: 1000 }], // commande, pas de facture sous ce FP
      invoices: [{ fp: "FP/2026/777", client: "ACME", amountHt: 1000 }], // facture orpheline, même montant
      opps: [], fpKeyOf: keyOf(), normClient: nc,
    });
    const d = find(out, "ACME");
    expect(d.suggestions).toHaveLength(1);
    expect(d.suggestions[0]).toMatchObject({ from: "FP/2026/500", to: "FP/2026/777", reason: "facture_sous_autre_fp", targetHasInvoice: true });
  });

  it("commande partiellement facturée (facture < CAS) sous un autre FP → PAS de proposition (montants non concordants)", () => {
    const out = reconcileClients({
      orders: [{ fp: "FP/2026/500", client: "ACME", cas: 1000 }],
      invoices: [{ fp: "FP/2026/777", client: "ACME", amountHt: 300 }], // acompte : 300 ≠ 1000
      opps: [], fpKeyOf: keyOf(), normClient: nc,
    });
    expect(find(out, "ACME").suggestions).toHaveLength(0);
  });

  it("réconciliation déjà posée (alias 13→500) → un seul cluster, aucun nouvel écart", () => {
    const out = reconcileClients({
      orders: [{ fp: "FP/2026/500", client: "ACME", cas: 800 }],
      invoices: [{ fp: "FP/2026/500", client: "ACME", amountHt: 800 }],
      opps: [{ fp: "FP/2026/13", client: "ACME", amount: 800, stage: 6 }],
      fpKeyOf: keyOf({ "FP/2026/13": "FP/2026/500" }), normClient: nc, // alias appliqué → opp rejoint 500
    });
    const d = find(out, "ACME");
    expect(d.clusters).toHaveLength(1);
    expect(d.clusters[0].fp).toBe("FP/2026/500");
    expect(d.suggestions).toHaveLength(0);
    expect(d.wonNoPnl).toBe(0);
  });

  it("tri : le client avec le plus de propositions remonte en tête", () => {
    const out = reconcileClients({
      orders: [
        { fp: "FP/2026/500", client: "BETA", cas: 800 },
        { fp: "FP/2026/600", client: "GAMMA", cas: 400 },
      ],
      invoices: [{ fp: "FP/2026/500", client: "BETA", amountHt: 800 }],
      opps: [
        { fp: "FP/2026/13", client: "BETA", amount: 800, stage: 6 },
        { fp: "FP/2026/14", client: "GAMMA", amount: 400, stage: 6 },
      ],
      fpKeyOf: keyOf(), normClient: nc,
    });
    // BETA et GAMMA ont chacun 1 proposition ; départage alpha → BETA avant GAMMA.
    expect(out.map((d) => d.client)).toEqual(["BETA", "GAMMA"]);
    expect(out[0].suggestions).toHaveLength(1);
  });

  it("opp NON gagnée sans P&L → ni écart ni proposition (seul le gagné se réconcilie)", () => {
    const out = reconcileClients({
      orders: [{ fp: "FP/2026/500", client: "ACME", cas: 800 }],
      invoices: [{ fp: "FP/2026/500", client: "ACME", amountHt: 800 }],
      opps: [{ fp: "FP/2026/13", client: "ACME", amount: 800, stage: 4 }], // en négo, pas gagnée
      fpKeyOf: keyOf(), normClient: nc,
    });
    const d = find(out, "ACME");
    expect(d.wonNoPnl).toBe(0);
    expect(d.suggestions).toHaveLength(0);
  });
});
