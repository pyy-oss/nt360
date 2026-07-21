import { describe, it, expect } from "vitest";
const { wbFromAoa: mkWb } = require("./_wb");
const { buildTemplateAoa, parseOpportunitiesImport, TEMPLATE_HEADERS } = require("../parsers/oppImport");
const { planOpportunityImport, finalizeUpdatePatch, buildCreateDoc, importDateChange } = require("../domain/oppImport");

// Classeur en mémoire depuis une matrice (aoa) — feuille « Opportunités ».
const wbFromAoa = (aoa) => mkWb("Opportunités", aoa);
// Index {byId, byFp} depuis une liste d'opps (comme le callable).
function indexes(opps) {
  const byId = new Map(), byFp = new Map();
  const { fpKey } = require("../lib/ids");
  for (const o of opps) {
    byId.set(o.id, o); if (o.oppId) byId.set(o.oppId, o);
    if (o.srcOppId) byId.set(o.srcOppId, o); // Opp ID SOURCE (import précédent) — miroir du caller
    const fk = fpKey(o.fp); if (fk && !byFp.has(fk)) byFp.set(fk, o);
  }
  return { byId, byFp };
}

const OPPS = [
  { id: "saisie_a", oppId: "saisie_a", source: "saisie", client: "ORANGE CI", designation: "Refonte SI", am: "KOUAME", bu: "ICT", amount: 120000, stage: 4, probability: 0.6, mbPrev: 30, dr: true, closingDate: "2026-03-15", nextStep: "Relancer DAF", nextStepDate: "2026-02-01", lostReason: null },
  { id: "h_livefp", oppId: "h_livefp", source: "salesData", client: "MTN CI", designation: "Cloud migration", am: "DIALLO", bu: "CLOUD", amount: 80000, stage: 7, probability: 0.4, mbPrev: null, dr: false, closingDate: "2025-11-01", nextStep: null, nextStepDate: null, lostReason: null, fp: "FP/2025/900" },
];

describe("oppImport — aller-retour EXPORT→RE-IMPORT sans édition = AUCUN changement", () => {
  it("le modèle exporté, re-parsé et re-planifié ne propose aucune mise à jour ni création", () => {
    const aoa = buildTemplateAoa(OPPS);
    expect(aoa[0]).toEqual(TEMPLATE_HEADERS); // en-tête exact
    const { rows } = parseOpportunitiesImport(wbFromAoa(aoa));
    expect(rows).toHaveLength(OPPS.length);
    const { byId, byFp } = indexes(OPPS);
    const plan = planOpportunityImport(byId, byFp, rows);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);       // ← invariant clé : rien ne bouge à l'identique
    expect(plan.skipped.every((s) => s.reason === "aucun changement")).toBe(true);
  });
});

describe("oppImport — mise à jour ciblée (renseigner un motif de perte)", () => {
  it("remplir « Motif de perte » sur l'opp perdue produit UNE mise à jour de ce seul champ", () => {
    const aoa = buildTemplateAoa(OPPS);
    const idxLost = OPPS.findIndex((o) => o.stage === 7);
    const colMotif = TEMPLATE_HEADERS.indexOf("Motif de perte");
    aoa[idxLost + 1][colMotif] = "Prix trop élevé"; // +1 : ligne 0 = en-tête
    const { rows } = parseOpportunitiesImport(wbFromAoa(aoa));
    const { byId, byFp } = indexes(OPPS);
    const plan = planOpportunityImport(byId, byFp, rows);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].id).toBe("h_livefp");
    expect(plan.toUpdate[0].changed).toEqual(["lostReason"]);
    expect(plan.toUpdate[0].patch.lostReason).toBe("Prix trop élevé");
    expect(plan.toUpdate[0].matchBy).toBe("id");
  });
});

describe("oppImport — rapprochement & création", () => {
  const rowsOf = (rows) => rows.map((r) => ({ oppId: "", fp: "", values: {}, line: 2, ...r }));
  it("rapproche par N° FP quand l'Opp ID est absent", () => {
    const { byId, byFp } = indexes(OPPS);
    const plan = planOpportunityImport(byId, byFp, rowsOf([{ fp: "FP/2025/900", values: { stage: 6 } }]));
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].matchBy).toBe("fp");
    expect(plan.toUpdate[0].id).toBe("h_livefp");
  });
  it("crée une opp `saisie` quand ni Opp ID ni FP ne correspondent (client requis)", () => {
    const { byId, byFp } = indexes(OPPS);
    const plan = planOpportunityImport(byId, byFp, rowsOf([{ fp: "FP/2027/1", values: { client: "NOUVEAU CLIENT", amount: 5000, stage: 2 } }]));
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].client).toBe("NOUVEAU CLIENT");
    expect(plan.toCreate[0].fp).toBe("FP/2027/1");
  });
  it("ignore une ligne sans identité connue ET sans client", () => {
    const { byId, byFp } = indexes(OPPS);
    const plan = planOpportunityImport(byId, byFp, rowsOf([{ values: { amount: 999 } }]));
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
  });
  it("MISE À JOUR NON EFFAÇANTE : une cellule ABSENTE ne remet jamais un champ à blanc", () => {
    const { byId, byFp } = indexes(OPPS);
    // values ne contient QUE amount : ni lostReason ni nextStep ne doivent apparaître dans le patch.
    const plan = planOpportunityImport(byId, byFp, rowsOf([{ oppId: "saisie_a", values: { amount: 200000 } }]));
    expect(plan.toUpdate[0].changed).toEqual(["amount"]);
    expect(plan.toUpdate[0].patch).not.toHaveProperty("lostReason");
  });
});

describe("oppImport — idempotence d'un Opp ID EXTERNE sans N° FP (audit commercial)", () => {
  const rowsOf = (rows) => rows.map((r) => ({ oppId: "", fp: "", values: {}, line: 2, ...r }));
  it("1er import : ligne à Opp ID externe sans FP → CRÉATION portant srcOppId", () => {
    const { byId, byFp } = indexes(OPPS);
    const row = { oppId: "CRM-999", fp: "", values: { client: "NOUVEAU CRM", amount: 5000, stage: 2 } };
    const plan = planOpportunityImport(byId, byFp, rowsOf([row]));
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].oppId).toBe("CRM-999"); // Opp ID source porté jusqu'à la création
    const doc = buildCreateDoc(plan.toCreate[0].values, plan.toCreate[0].fp, "saisie_new", plan.toCreate[0].oppId);
    expect(doc.srcOppId).toBe("CRM-999");
  });
  it("2e import de la MÊME ligne → MISE À JOUR (match par srcOppId), PAS un doublon", () => {
    // Après le 1er import, l'opp créée est indexée avec son srcOppId (comme le fait le caller au ré-import).
    const created = { id: "saisie_new", oppId: "saisie_new", srcOppId: "CRM-999", source: "saisie", client: "NOUVEAU CRM", amount: 5000, stage: 2, fp: null };
    const { byId, byFp } = indexes([...OPPS, created]);
    const row = { oppId: "CRM-999", fp: "", values: { client: "NOUVEAU CRM", amount: 9000, stage: 3 } };
    const plan = planOpportunityImport(byId, byFp, rowsOf([row]));
    expect(plan.toCreate).toHaveLength(0);        // ← plus de doublon
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].id).toBe("saisie_new");
    expect(plan.toUpdate[0].matchBy).toBe("id");
    expect(plan.toUpdate[0].changed.sort()).toEqual(["amount", "stage"]);
  });
});

describe("oppImport — cellules vides / bruit ne touchent PAS le champ (audit H2/M1/M2)", () => {
  const colOf = (h) => TEMPLATE_HEADERS.indexOf(h);
  it("H2 — une cellule BU VIDE ne bascule pas la BU courante en « AUTRE »", () => {
    const aoa = buildTemplateAoa(OPPS);
    aoa[1][colOf("BU")] = ""; // vide la BU de saisie_a (ICT)
    const { rows } = parseOpportunitiesImport(wbFromAoa(aoa));
    const row = rows.find((r) => r.oppId === "saisie_a");
    expect(row.values).not.toHaveProperty("bu"); // cellule vide → champ non fourni
    const { byId, byFp } = indexes(OPPS);
    expect(planOpportunityImport(byId, byFp, rows).toUpdate).toHaveLength(0);
  });
  it("M1 — un « Montant » non numérique (« N/A ») ne met pas le montant à 0", () => {
    const aoa = buildTemplateAoa(OPPS);
    aoa[1][colOf("Montant")] = "N/A";
    const { rows } = parseOpportunitiesImport(wbFromAoa(aoa));
    expect(rows.find((r) => r.oppId === "saisie_a").values).not.toHaveProperty("amount");
  });
  it("M1 — un vrai « 0 » reste présent (met bien le montant à 0)", () => {
    const aoa = buildTemplateAoa(OPPS);
    aoa[1][colOf("Montant")] = 0;
    const { rows } = parseOpportunitiesImport(wbFromAoa(aoa));
    expect(rows.find((r) => r.oppId === "saisie_a").values.amount).toBe(0);
    const plan = planOpportunityImport(indexes(OPPS).byId, indexes(OPPS).byFp, rows);
    expect(plan.toUpdate[0].changed).toContain("amount"); // 120000 → 0 = vrai changement
  });
  it("M2 — aller-retour SANS édition d'une opp en casse mixte = AUCUN changement", () => {
    const mixed = [{ ...OPPS[0], client: "Orange CI", am: "Kouame" }];
    const { rows } = parseOpportunitiesImport(wbFromAoa(buildTemplateAoa(mixed)));
    const { byId, byFp } = indexes(mixed);
    expect(planOpportunityImport(byId, byFp, rows).toUpdate).toHaveLength(0);
  });
});

describe("oppImport — colonne MB de l'onglet LIVE reconnue comme mbPrev (%)", () => {
  it("un en-tête « MB » NU alimente mbPrev (en %) — et « Nombre… » (⊇ mb) n'est PAS confondu", () => {
    const aoa = [
      ["N° FP", "Client", "MB", "Nombre de sites"],
      ["FP/2026/50", "ORANGE", 20, 8],
    ];
    const { rows } = parseOpportunitiesImport(wbFromAoa(aoa));
    expect(rows).toHaveLength(1);
    expect(rows[0].values.mbPrev).toBe(20); // « MB » capté par égalité exacte, pas « Nombre de sites »
  });
  it("un en-tête « MB TOTAL » est aussi reconnu (décimales préservées)", () => {
    const { rows } = parseOpportunitiesImport(wbFromAoa([["N° FP", "MB TOTAL"], ["FP/2026/51", 23.42]]));
    expect(rows[0].values.mbPrev).toBeCloseTo(23.42, 2);
  });
  it("cellule MB vide → champ non fourni (mise à jour non effaçante)", () => {
    const { rows } = parseOpportunitiesImport(wbFromAoa([["N° FP", "MB"], ["FP/2026/52", ""]]));
    expect(rows[0].values).not.toHaveProperty("mbPrev");
  });
});

describe("oppImport — dérivations (finalize + create)", () => {
  it("un changement d'étape SEUL ajoute stageLabel sans toucher au pondéré (montant/proba inchangés)", () => {
    const cur = { amount: 100000, probability: 0.6, stage: 4 };
    const out = finalizeUpdatePatch(cur, { stage: 5 });
    expect(out.stageLabel).toBe("5-Contractualisation");
    expect(out).not.toHaveProperty("weighted"); // ni montant ni proba → pas de recalcul du pondéré
  });
  it("un changement d'étape ET de proba recalcule le pondéré", () => {
    const out = finalizeUpdatePatch({ amount: 100000, probability: 0.6 }, { stage: 5, probability: 0.8 });
    expect(out.weighted).toBe(80000); // 100000 × 0.8
  });
  it("un changement de montant recalcule le pondéré avec la proba courante", () => {
    const out = finalizeUpdatePatch({ amount: 1, probability: 0.5 }, { amount: 200000 });
    expect(out.weighted).toBe(100000);
  });
  it("buildCreateDoc pose source=saisie, proba par défaut de l'étape et pondéré cohérent", () => {
    const doc = buildCreateDoc({ client: "X", stage: 3 }, "FP/2027/2", "saisie_new");
    expect(doc.source).toBe("saisie");
    expect(doc.stage).toBe(3);
    expect(doc.probability).toBe(40);      // DEFAULT_PROBA[3] en % (0-100)
    expect(doc.fp).toBe("FP/2027/2");
    expect(doc.dr).toBe(false);
    expect(doc.weighted).toBe(0);          // montant absent → 0
  });
});

describe("importDateChange (Lot 11 — slippage à l'import)", () => {
  it("closingDate absente du patch (cellule non fournie) → pas de journal", () => {
    expect(importDateChange({ id: "o1", closingDate: "2026-06-30" }, { amount: 5 }, "u")).toBeNull();
  });
  it("closingDate inchangée (même jour) → pas de journal", () => {
    expect(importDateChange({ id: "o1", closingDate: "2026-06-30" }, { closingDate: "2026-06-30" }, "u")).toBeNull();
  });
  it("glissement de date → événement complet (from/to + montant/étape/AM/catégorie hérités)", () => {
    const cur = { id: "o1", closingDate: "2026-06-30", amount: 100, am: "Awa", stage: 3, forecastCategory: "commit", client: "ACME" };
    const dc = importDateChange(cur, { closingDate: "2026-09-30" }, "u1");
    expect(dc).toEqual({ oppId: "o1", from: "2026-06-30", to: "2026-09-30", amount: 100, am: "Awa", stage: 3, forecastCategory: "commit", client: "ACME", uid: "u1" });
  });
  it("les champs modifiés par le patch priment sur la valeur courante", () => {
    const cur = { id: "o1", closingDate: "2026-06-30", amount: 100, am: "Awa", stage: 3 };
    const dc = importDateChange(cur, { closingDate: "2026-09-30", amount: 200, stage: 4, am: "Ben" }, "u1");
    expect(dc.amount).toBe(200);
    expect(dc.stage).toBe(4);
    expect(dc.am).toBe("Ben");
  });
  it("passage à sans-date (closingDate vidée) est un glissement journalisé", () => {
    const dc = importDateChange({ id: "o1", closingDate: "2026-06-30" }, { closingDate: null }, "u");
    expect(dc).not.toBeNull();
    expect(dc.to).toBeNull();
  });
});
