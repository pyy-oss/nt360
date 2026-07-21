import { describe, it, expect } from "vitest";

// TEST DE CÂBLAGE (audit partenariats) — la fabrique createPartenariats DOIT renvoyer chaque callable
// que index.js ré-exporte (`exports.X = _partenariats.X`). Un handler défini mais ABSENT du return rend
// l'export `undefined` : la garde check-deploy-targets (regex sur `exports.X =`) ne le voit pas, et la
// fonction disparaît silencieusement du déploiement (vécu : suggestParPartnerMap). On fige ici la liste
// attendue — l'ajout d'un callable au module doit la compléter.
const { createPartenariats } = require("../handlers/partenariats");

// Doubles minimaux : onCallG rend le handler tel quel (les autres deps ne sont pas exercées ici).
const deps = {
  onCallG: (_name, _opts, handler) => handler,
  HttpsError: class extends Error {},
  db: {}, FieldValue: {},
  requireWrite: async () => {}, requireRead: async () => {},
  requestRecompute: async () => {}, recomputeNow: async () => {},
  ANTHROPIC_API_KEY: null, CLICKUP_TOKEN: null, rateLimit: null, logOps: null,
};

const EXPECTED = [
  "upsertParPartner", "deleteParPartner",
  "upsertParCertification", "deleteParCertification",
  "setParPartnerMap",
  "upsertParAssignment", "setParAssignmentStatus", "deleteParAssignment",
  "pushParAssignmentToClickup",
  "generateParActionPlan", "generateParQbr", "suggestParPartnerMap",
  "importParCertifications", "importParCertificationsFile",
];

describe("partenariats — câblage fabrique → exports", () => {
  it("chaque callable ré-exporté par index.js est présent (et est une fonction) dans le return", () => {
    const out = createPartenariats(deps);
    for (const name of EXPECTED) expect(out[name], `callable manquant au return : ${name}`).toBeTypeOf("function");
  });

  it("aucun callable orphelin : le return ne porte que des callables connus (sinon compléter EXPECTED + index.js)", () => {
    const out = createPartenariats(deps);
    expect(Object.keys(out).sort()).toEqual([...EXPECTED].sort());
  });
});
