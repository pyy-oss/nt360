import { describe, it, expect } from "vitest";
const { versionPayload, versionHash, versionsDiffer } = require("../domain/mntContratVersion");

const base = {
  fp: "FP/2026/7", client: "ACME", statut: "actif", echeanceType: "mensuel", montantEngage: 1_000_000,
  deviseEngage: "XOF", dateDebut: "2026-01-01", dateFin: "2026-12-31",
  engagements: [
    { type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: 8, quota: 10 },
    { type: "prise_en_compte", couverture: "h24", seuilHeures: 4, quota: null },
  ],
};

describe("mntContratVersion — payload significatif (ADR-P24)", () => {
  it("le payload ignore client/am/statut/dateDebut/dateFin (non opposables au SLA)", () => {
    const a = versionPayload(base);
    const b = versionPayload({ ...base, client: "AUTRE", statut: "suspendu", am: "X", bu: "ICT", dateDebut: "2020-01-01", dateFin: "2099-01-01" });
    expect(versionHash(a)).toBe(versionHash(b)); // même hash → aucune nouvelle version sur ces changements
  });
  it("le hash est stable sous RÉ-ORDONNANCEMENT des engagements (ordre canonique)", () => {
    const reordered = { ...base, engagements: [base.engagements[1], base.engagements[0]] };
    expect(versionHash(versionPayload(base))).toBe(versionHash(versionPayload(reordered)));
  });
  it("le hash change sur chacun des 4 axes significatifs (SLA seuil/couverture/quota, prix, périodicité)", () => {
    const h0 = versionHash(versionPayload(base));
    const seuil = { ...base, engagements: [{ ...base.engagements[0], seuilHeures: 6 }, base.engagements[1]] };
    const couv = { ...base, engagements: [{ ...base.engagements[0], couverture: "h24" }, base.engagements[1]] };
    const quota = { ...base, engagements: [{ ...base.engagements[0], quota: 5 }, base.engagements[1]] };
    const prix = { ...base, montantEngage: 2_000_000 };
    const per = { ...base, echeanceType: "annuel" };
    for (const c of [seuil, couv, quota, prix, per]) expect(versionHash(versionPayload(c))).not.toBe(h0);
  });
  it("versionsDiffer : vrai si prevHash absent (version 1) ou hash différent ; faux sinon", () => {
    const p = versionPayload(base);
    const h = versionHash(p);
    expect(versionsDiffer(null, p)).toBe(true);   // premier enregistrement
    expect(versionsDiffer(h, p)).toBe(false);      // rien de significatif n'a bougé → pas de nouvelle version
    expect(versionsDiffer("deadbeef", p)).toBe(true);
  });
});
