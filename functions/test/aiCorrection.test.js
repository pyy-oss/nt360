import { describe, it, expect } from "vitest";
const { buildCorrectionPrompt, normalizeSuggestions, redactRecord, refOf, sanitizeField, buildVerificationPrompt, applyVerdicts } = require("../domain/aiCorrection");

describe("aiCorrection — assistant IA du Centre de correction (l'IA propose, on ne fait pas confiance)", () => {
  describe("redactRecord / refOf", () => {
    it("réduit aux champs de la liste blanche + ref stable ; n'expose rien d'interne", () => {
      const rec = { id: "inv1", fp: "FP/2026/7", client: "ACME", amountHt: 600, numero: "F1", visibleTo: ["x"], _secret: 1 };
      const r = redactRecord(rec);
      expect(r.ref).toBe("inv1");
      expect(r.fp).toBe("FP/2026/7");
      expect(r.client).toBe("ACME");
      expect(r.amountHt).toBe(600);
      expect(r).not.toHaveProperty("visibleTo");
      expect(r).not.toHaveProperty("_secret");
    });
    it("ref retombe sur numero → fp → bcNumber → client", () => {
      expect(refOf({ numero: "F9" })).toBe("F9");
      expect(refOf({ fp: "FP/2026/1" })).toBe("FP/2026/1");
      expect(refOf({ bcNumber: "BC-3" })).toBe("BC-3");
      expect(refOf({ client: "BETA" })).toBe("BETA");
      expect(refOf({})).toBe("");
    });
  });

  describe("buildCorrectionPrompt", () => {
    it("inclut le type, les enregistrements redigés et les commandes candidates ; documente les actions permises", () => {
      const records = [{ id: "inv1", fp: "FP/2026/7", client: "ACME", amountHt: 1000, numero: "F1" }];
      const ctx = { orders: [{ fp: "FP/2026/7", client: "ACME", cas: 1000 }], label: "Factures non rattachées" };
      const { system, user } = buildCorrectionPrompt("factures_orphelines", records, ctx);
      expect(system).toMatch(/JSON/);
      expect(user).toMatch(/factures_orphelines/);
      expect(user).toMatch(/set_invoice_fp/);
      expect(user).toMatch(/generate_from_invoice/);
      expect(user).toMatch(/"ref":"inv1"/);            // enregistrement redigé présent
      expect(user).toMatch(/Commandes candidates/);     // contexte de rapprochement présent
      expect(user).toMatch(/review/);                   // review toujours documenté
    });
    it("type inconnu → seule « review » est proposable (aucune correction auto sûre)", () => {
      const { user } = buildCorrectionPrompt("type_inconnu", [{ id: "x" }], {});
      expect(user).toMatch(/Seule l'action "review" est permise/);
    });
  });

  describe("normalizeSuggestions — garde-fous défensifs", () => {
    const records = [
      { id: "inv1", fp: "FP/2026/7", client: "ACME", numero: "F1" },
      { id: "inv2", fp: "", client: "BETA", numero: "F2" },
    ];
    it("garde-fou 1 : rejette un ref halluciné (absent du lot)", () => {
      const parsed = { suggestions: [{ ref: "GHOST", action: "set_invoice_fp", fields: { fp: "FP/2026/9" }, confidence: 0.9 }] };
      expect(normalizeSuggestions(parsed, records, "factures_orphelines")).toEqual([]);
    });
    it("garde-fou 2 : une action hors liste blanche retombe en « review »", () => {
      const parsed = { suggestions: [{ ref: "inv1", action: "DELETE_EVERYTHING", confidence: 0.8, rationale: "?" }] };
      const out = normalizeSuggestions(parsed, records, "factures_orphelines");
      expect(out).toHaveLength(1);
      expect(out[0].action).toBe("review");
    });
    it("garde-fou 3+5 : set_invoice_fp accepté avec FP canonique ; FP non canonique → retombe en review", () => {
      const ok = normalizeSuggestions({ suggestions: [{ ref: "inv1", action: "set_invoice_fp", fields: { fp: "fp/2026/009" }, confidence: 0.9 }] }, records, "factures_orphelines");
      expect(ok[0].action).toBe("set_invoice_fp");
      expect(ok[0].fields.fp).toBe("FP/2026/9");        // canonicalisé
      const bad = normalizeSuggestions({ suggestions: [{ ref: "inv2", action: "set_invoice_fp", fields: { fp: "SANS-FP" }, confidence: 0.9 }] }, records, "factures_orphelines");
      expect(bad[0].action).toBe("review");             // FP non exploitable → rien à appliquer
      expect(bad[0].fields).toEqual({});
    });
    it("garde-fou 3 : les champs hors liste blanche de l'action sont supprimés", () => {
      const parsed = { suggestions: [{ ref: "inv1", action: "set_invoice_fp", fields: { fp: "FP/2026/7", cas: 999999, client: "PIRATE" }, confidence: 0.7 }] };
      const out = normalizeSuggestions(parsed, records, "factures_orphelines");
      expect(out[0].fields).toEqual({ fp: "FP/2026/7" }); // cas/client écartés (non permis pour cette action)
    });
    it("garde-fou 4 : aucune invention de montant/date — le champ est écarté", () => {
      // opps_sans_montant n'a pas d'action auto-applicable → tout retombe en review
      const out = normalizeSuggestions({ suggestions: [{ ref: "inv1", action: "patch_order", fields: { yearPo: 2026, cas: 5000000 }, confidence: 0.6 }] }, records, "commandes_sans_annee");
      expect(out[0].action).toBe("patch_order");
      expect(out[0].fields).toEqual({ yearPo: 2026 });   // yearPo gardé, cas (monétaire) écarté
    });
    it("garde-fou 4 : un AM purement numérique est rejeté (colonne mal mappée)", () => {
      const recs = [{ id: "o1", fp: "FP/2026/1" }];
      const out = normalizeSuggestions({ suggestions: [{ ref: "o1", action: "patch_order", fields: { am: "35" }, confidence: 0.5 }] }, recs, "am_invalide");
      expect(out[0].action).toBe("review");              // pas de champ exploitable → review
    });
    it("garde-fou 6 : confidence bornée [0,1], rationale tronquée, dé-doublonnage par ref (garde la plus confiante)", () => {
      const parsed = { suggestions: [
        { ref: "inv1", action: "set_invoice_fp", fields: { fp: "FP/2026/7" }, confidence: 5, rationale: "x".repeat(500) },
        { ref: "inv1", action: "review", confidence: 0.2, rationale: "moins sûr" },
      ] };
      const out = normalizeSuggestions(parsed, records, "factures_orphelines");
      expect(out).toHaveLength(1);                        // dé-doublonné
      expect(out[0].confidence).toBe(1);                 // borné
      expect(out[0].action).toBe("set_invoice_fp");      // la plus confiante gagne
      expect(out[0].rationale.length).toBeLessThanOrEqual(240);
    });
    it("doublons : seule « review » — pas d'action destructive automatique", () => {
      const recs = [{ id: "d1", client: "ACME" }, { id: "d2", client: "ACME" }];
      const parsed = { suggestions: [{ ref: "d2", action: "delete", confidence: 0.95, rationale: "copie de d1" }] };
      const out = normalizeSuggestions(parsed, recs, "opps_doublons");
      expect(out[0].action).toBe("review");
      expect(out[0].rationale).toMatch(/copie/);
    });
    it("requalification opp (fantôme/âgée) : stage 7 ou 9 accepté, tout autre stage → review", () => {
      const recs = [{ id: "op1", fp: "FP/2026/1" }, { id: "op2", fp: "FP/2026/2" }];
      const ok = normalizeSuggestions({ suggestions: [{ ref: "op1", action: "patch_opportunity", fields: { stage: 7 }, confidence: 0.8 }] }, recs, "opps_fantomes");
      expect(ok[0].action).toBe("patch_opportunity");
      expect(ok[0].fields).toEqual({ stage: 7 });
      // stage 6 (gagné) n'est PAS une sortie de pipeline → champ écarté → plus de champ → review
      const bad = normalizeSuggestions({ suggestions: [{ ref: "op2", action: "patch_opportunity", fields: { stage: 6 }, confidence: 0.8 }] }, recs, "opps_agees");
      expect(bad[0].action).toBe("review");
    });
    it("solder RAF clôturé : action « settle_raf » SANS champ reste actionnable (valeur déterministe 0)", () => {
      const recs = [{ fp: "FP/2026/9", raf: 500000 }];
      const out = normalizeSuggestions({ suggestions: [{ ref: "FP/2026/9", action: "settle_raf", confidence: 0.9, rationale: "clôturé" }] }, recs, "clickup_cloture_avec_raf");
      expect(out[0].action).toBe("settle_raf"); // fieldless : ne retombe pas en review
    });
    it("tri : les propositions actionnables passent avant les « review », puis par confiance", () => {
      const recs = [{ id: "a", fp: "FP/2026/1" }, { id: "b", fp: "FP/2026/2" }, { id: "c" }];
      const parsed = { suggestions: [
        { ref: "c", action: "review", confidence: 0.99, rationale: "info" },
        { ref: "a", action: "set_invoice_fp", fields: { fp: "FP/2026/1" }, confidence: 0.5 },
        { ref: "b", action: "set_invoice_fp", fields: { fp: "FP/2026/2" }, confidence: 0.8 },
      ] };
      const out = normalizeSuggestions(parsed, recs, "factures_orphelines");
      expect(out.map((s) => s.ref)).toEqual(["b", "a", "c"]); // actionnables d'abord (0.8 > 0.5), review en dernier
    });
    it("entrée malformée (pas de tableau) → []", () => {
      expect(normalizeSuggestions({}, records, "factures_orphelines")).toEqual([]);
      expect(normalizeSuggestions(null, records, "factures_orphelines")).toEqual([]);
    });
  });

  describe("buildVerificationPrompt / applyVerdicts — vérification adverse (fiabilité max)", () => {
    const records = [{ id: "inv1", fp: "FP/2026/7", client: "ACME", numero: "F1" }, { id: "inv2", fp: "FP/2026/8", client: "BETA", numero: "F2" }];
    const suggestions = [
      { ref: "inv1", action: "set_invoice_fp", fields: { fp: "FP/2026/7" }, confidence: 0.9, rationale: "client concordant" },
      { ref: "inv2", action: "review", fields: {}, confidence: 0.4, rationale: "à vérifier" },
    ];
    it("ne soumet à vérification QUE les propositions actionnables (pas les « review »)", () => {
      const { user, targets } = buildVerificationPrompt("factures_orphelines", suggestions, records, {});
      expect(targets.map((t) => t.ref)).toEqual(["inv1"]); // seul l'actionnable est une cible (inv2 = review)
      expect(user).toMatch(/RELECTEUR|vérifier/i);
      // La section « Propositions à vérifier » ne contient QUE inv1 (inv2 n'apparaît qu'en contexte records).
      const propsBlock = user.slice(user.indexOf("Propositions à vérifier"));
      expect(propsBlock).toMatch(/"ref":"inv1"/);
      expect(propsBlock).not.toMatch(/"ref":"inv2"/);
    });
    it("confirmed=true → verified ; confiance ramenée au min(1er passage, relecteur)", () => {
      const out = applyVerdicts(suggestions, { verdicts: [{ ref: "inv1", confirmed: true, confidence: 0.7, reason: "ok" }] });
      const s1 = out.find((s) => s.ref === "inv1");
      expect(s1.verified).toBe(true);
      expect(s1.confidence).toBe(0.7);           // min(0.9, 0.7)
      expect(s1.verifyReason).toBe("ok");
    });
    it("confirmed=false (réfutée) → NON vérifiée, confiance du 1er passage conservée", () => {
      const out = applyVerdicts(suggestions, { verdicts: [{ ref: "inv1", confirmed: false, confidence: 0.9, reason: "client ne concorde pas" }] });
      expect(out.find((s) => s.ref === "inv1").verified).toBe(false);
    });
    it("proposition NON couverte par un verdict → non vérifiée (prudence)", () => {
      const out = applyVerdicts(suggestions, { verdicts: [] });
      expect(out.find((s) => s.ref === "inv1").verified).toBe(false);
    });
    it("les propositions « review » sont toujours verified=false (rien à appliquer)", () => {
      const out = applyVerdicts(suggestions, { verdicts: [{ ref: "inv2", confirmed: true, confidence: 1 }] });
      expect(out.find((s) => s.ref === "inv2").verified).toBe(false);
    });
  });

  describe("sanitizeField", () => {
    it("canonicalise un FP, borne une année, nettoie un nom, refuse un AM numérique/monétaire", () => {
      expect(sanitizeField("fp", "fp/2024/12")).toBe("FP/2024/12");
      expect(sanitizeField("fp", "n'importe quoi")).toBeUndefined();
      expect(sanitizeField("yearPo", "2024")).toBe(2024);
      expect(sanitizeField("yearPo", "1700")).toBeUndefined(); // année non plausible
      expect(sanitizeField("am", "35")).toBeUndefined();
      expect(sanitizeField("am", "Jean Dupont")).toBe("Jean Dupont");
      expect(sanitizeField("cas", 5000)).toBeUndefined();      // monétaire non applicable
      expect(sanitizeField("date", "2026-01-01")).toBeUndefined();
    });
  });
});
