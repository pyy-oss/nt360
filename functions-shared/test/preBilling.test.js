import { describe, it, expect } from "vitest";
const { computePreBilling, coveringRate } = require("../domain/preBilling");

describe("preBilling — pré-facturation depuis le CRA (Lot 21)", () => {
  const consultants = [
    { id: "c1", name: "ALICE", bu: "ICT", tjmTarget: 500 },
    { id: "c2", name: "BOB", bu: "CLOUD", tjmTarget: 600 },
    { id: "c3", name: "CARA", bu: "ICT", tjmTarget: null }, // pas de TJM → ne peut pas être pré-facturée
  ];
  const timesheets = [
    { consultantId: "c1", month: "2026-05", billedDays: 18, leaveDays: 2 },
    { consultantId: "c1", month: "2026-06", billedDays: 20 },
    { consultantId: "c2", month: "2026-06", billedDays: 15 },
    { consultantId: "c3", month: "2026-06", billedDays: 10 }, // facturé mais TJM inconnu
    { consultantId: "c2", month: "2026-06", billedDays: 0 },  // rien facturé → ignoré (déjà couvert par c2 15j ; ce doublon 0j n'ajoute pas de ligne)
    { consultantId: "c1", month: "2026-01", billedDays: 12 }, // hors plage → ignoré
  ];
  const assignments = [
    // c1 est affecté à un TJM CONTRACTUALISÉ de 550 (≠ TJM cible 500) sur mai-juin → prioritaire.
    { consultantId: "c1", startMonth: "2026-05", endMonth: "2026-12", tjmBilled: 550, projectFp: "FP/2026/1", status: "confirmed" },
  ];
  const months = ["2026-05", "2026-06"];
  const r = computePreBilling(consultants, timesheets, assignments, months);

  it("montant HT = jours facturés × TJM, taux d'affectation prioritaire sur le TJM cible", () => {
    const c1may = r.lines.find((l) => l.consultantId === "c1" && l.month === "2026-05");
    expect(c1may.tjm).toBe(550);              // taux d'affectation, PAS le TJM cible 500
    expect(c1may.tjmSource).toBe("assignment");
    expect(c1may.amountHt).toBe(18 * 550);    // 9 900
    expect(c1may.projectFp).toBe("FP/2026/1");
  });
  it("repli sur le TJM cible de l'annuaire quand aucune affectation ne couvre le mois", () => {
    const c2 = r.lines.find((l) => l.consultantId === "c2");
    expect(c2.tjm).toBe(600);
    expect(c2.tjmSource).toBe("target");
    expect(c2.amountHt).toBe(15 * 600); // 9 000
  });
  it("consultant sans TJM : ligne signalée missingTjm, montant nul (à ne pas oublier de tarifer)", () => {
    const c3 = r.lines.find((l) => l.consultantId === "c3");
    expect(c3.missingTjm).toBe(true);
    expect(c3.amountHt).toBe(0);
    expect(r.global.missingTjm).toBe(1);
  });
  it("jours facturés = 0 ou hors plage → aucune ligne", () => {
    expect(r.lines.some((l) => l.billedDays === 0)).toBe(false);
    expect(r.lines.some((l) => l.month === "2026-01")).toBe(false);
    // c1(mai)+c1(juin)+c2(juin)+c3(juin) = 4 lignes.
    expect(r.lines.length).toBe(4);
  });
  it("total HT + agrégats par BU et par mois", () => {
    // c1 mai 9900 + c1 juin 20*550=11000 + c2 juin 9000 + c3 0 = 29 900
    expect(r.global.amountHt).toBe(9900 + 11000 + 9000 + 0);
    expect(r.global.billedDays).toBe(18 + 20 + 15 + 10);
    const ict = r.byBu.find((b) => b.key === "ICT");
    expect(ict.amountHt).toBe(9900 + 11000); // ALICE (CARA = 0)
    const juin = r.byMonth.find((b) => b.key === "2026-06");
    expect(juin.amountHt).toBe(11000 + 9000 + 0);
    // byMonth trié chronologiquement.
    expect(r.byMonth.map((b) => b.key)).toEqual(["2026-05", "2026-06"]);
  });
  it("TJM ambigu (plusieurs affectations couvrantes à taux différents) → pas de devinette, repli TJM cible + drapeau", () => {
    const amb = [
      { consultantId: "c1", startMonth: "2026-06", endMonth: "2026-06", tjmBilled: 550 },
      { consultantId: "c1", startMonth: "2026-06", endMonth: "2026-06", tjmBilled: 700 },
    ];
    const cov = coveringRate(amb, "c1", "2026-06");
    expect(cov.ambiguous).toBe(true);
    expect(cov.tjm).toBe(null);
    const r2 = computePreBilling(consultants, [{ consultantId: "c1", month: "2026-06", billedDays: 10 }], amb, ["2026-06"]);
    const l = r2.lines[0];
    expect(l.ambiguousRate).toBe(true);
    expect(l.tjm).toBe(500);          // repli sur TJM cible
    expect(l.tjmSource).toBe("target");
    expect(l.projectFp).toBe(null);   // ref non renseignée quand le taux est ambigu (pas d'attribution trompeuse)
  });
  it("byConsultant regroupé par IDENTITÉ (id) : deux homonymes ne fusionnent pas (audit correctness)", () => {
    const cons = [{ id: "c1", name: "DUPONT", bu: "ICT", tjmTarget: 500 }, { id: "c9", name: "DUPONT", bu: "CLOUD", tjmTarget: 500 }];
    const ts = [{ consultantId: "c1", month: "2026-06", billedDays: 10 }, { consultantId: "c9", month: "2026-06", billedDays: 8 }];
    const rr = computePreBilling(cons, ts, [], ["2026-06"]);
    expect(rr.byConsultant.length).toBe(2);          // deux personnes distinctes, pas une ligne fusionnée
    expect(rr.byConsultant.every((g) => g.key === "DUPONT")).toBe(true); // libellé = nom (homonymes)
    expect(rr.byConsultant.reduce((s, g) => s + g.billedDays, 0)).toBe(18);
  });
  it("affectation PLANNED (prévisionnelle) n'impose pas son TJM : repli sur le TJM cible (audit correctness)", () => {
    const cons = [{ id: "c1", name: "ALICE", bu: "ICT", tjmTarget: 500 }];
    const ts = [{ consultantId: "c1", month: "2026-06", billedDays: 10 }];
    const planned = [{ consultantId: "c1", startMonth: "2026-06", endMonth: "2026-06", tjmBilled: 900, status: "planned" }];
    const rr = computePreBilling(cons, ts, planned, ["2026-06"]);
    expect(rr.lines[0].tjm).toBe(500);           // TJM cible, PAS le 900 prévisionnel
    expect(rr.lines[0].tjmSource).toBe("target");
  });
});
