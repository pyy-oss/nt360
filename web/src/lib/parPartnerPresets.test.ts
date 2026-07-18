import { describe, it, expect } from "vitest";
import { PARTNER_PRESETS, buildPartnerPreset, type PresetId } from "./parPartnerPresets";
import { buildPartnerPayload, bpAchievement } from "./parPartnerForm";

// Générateur de clés locales déterministe (miroir du compteur du formulaire).
const mkNk = () => { let n = 0; return () => "k" + (++n); };

describe("parPartnerPresets", () => {
  it("expose les dix partenaires clés NT (données réelles des fichiers de référence)", () => {
    expect(PARTNER_PRESETS.map((p) => p.id).sort()).toEqual(
      ["checkpoint", "cisco", "dell", "f5", "fortinet", "hpe-aruba", "huawei", "kaspersky", "microsoft", "paloalto"],
    );
  });

  for (const { id, label } of PARTNER_PRESETS) {
    describe(label, () => {
      const form = buildPartnerPreset(id as PresetId, mkNk());

      it("pré-remplit niveaux, compétences, catalogue et exigences", () => {
        expect(form.name).toBeTruthy();
        expect(form.tiers.length).toBeGreaterThan(0);
        expect(form.comps.length).toBeGreaterThan(0);
        expect(form.certs.length).toBeGreaterThan(0);
        expect(form.reqs.length).toBeGreaterThan(0);
      });

      it("porte le statut et le plan d'affaires réels (miroir fichier direction)", () => {
        expect(form.status).toBeTruthy();
        expect(form.renewalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(["valide", "presque_valide", "non_valide"]).toContain(form.validationStatus);
        // Les quatre axes du plan d'affaires sont renseignés → % global calculable.
        const bpNums: Record<string, number> = {};
        for (const [k, v] of Object.entries(form.bp)) bpNums[k] = Number(v);
        expect(bpAchievement(bpNums as any).global).not.toBeNull();
      });

      it("relie chaque certif à une compétence existante (clé locale valide)", () => {
        const compKeys = new Set(form.comps.map((c) => c.k));
        for (const c of form.certs) expect(compKeys.has(c.compK)).toBe(true);
      });

      it("relie chaque exigence à un niveau + une cible existants", () => {
        const tierKeys = new Set(form.tiers.map((t) => t.k));
        const compKeys = new Set(form.comps.map((c) => c.k));
        const certKeys = new Set(form.certs.map((c) => c.k));
        for (const r of form.reqs) {
          expect(tierKeys.has(r.tierK)).toBe(true);
          const sep = r.targetK.indexOf(":");
          const kind = r.targetK.slice(0, sep), k = r.targetK.slice(sep + 1);
          expect(kind === "cert" ? certKeys.has(k) : compKeys.has(k)).toBe(true);
        }
      });

      it("produit un payload sans identifiant vide (intégrité référentielle)", () => {
        const built = buildPartnerPayload(form);
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        const v = built.value as any;
        for (const e of v.certificationCatalog) expect(e.competencyId).toBeTruthy();
        for (const r of v.requirements) { expect(r.tierId).toBeTruthy(); expect(r.certIdOrCompetencyId).toBeTruthy(); }
      });
    });
  }
});
