import { describe, it, expect } from "vitest";
const { backlogFy } = require("../domain/backlog");
const { overview } = require("../domain/chaine");

// PARITÉ CROISÉE sur fixture PARTAGÉE (audit backlog — axe 9) : le « Backlog » affiché partout provient
// de backlogFy(orders).total, injecté dans overview via opts — ces DEUX implémentations sont exécutées
// ici sur la MÊME fixture (pas deux tests jumeaux écrits séparément). Le miroir front (overviewCalc.ts:87,
// Σ max(raf,0) même population) est couvert par overviewCalc.test.ts avec la même règle de clamp.
describe("parité croisée backlogFy ⇄ overview (fixture partagée)", () => {
  const orders = [
    { fp: "FP/2026/1", cas: 100, raf: 60, rafSource: "excel", yearPo: 2026, bu: "ICT", client: "A" },
    { fp: "FP/2025/2", cas: 50, raf: 10, rafSource: "derive", yearPo: 2025, bu: "ICT", client: "B" },
    { fp: "FP/2024/3", cas: 80, raf: -20, rafSource: "excel", yearPo: 2024, bu: "AUTRE", client: "C" }, // avoir : hors population (raf ≤ 0)
    { fp: "FP/2023/4", cas: 40, raf: 0, rafSource: "excel", yearPo: 2023, bu: "AUTRE", client: "D" },   // soldée : hors backlog
  ];

  it("même nombre partout : backlogFy.total = overview.backlog = Σ max(raf,0) des ouvertes", () => {
    const bf = backlogFy(orders, 2026, { dormantYears: 2 });
    expect(bf.total).toBe(70);
    expect(bf.count).toBe(2);
    const ov = overview(orders, [], [], { backlog: bf.total, backlogCount: bf.count });
    expect(ov.backlog).toBe(bf.total);
    expect(ov.backlogCount).toBe(bf.count);
  });

  it("dormantes : même prédicat que l'alerte backlog_dormant (ouvertes, millésime plausible ≤ fy − N)", () => {
    const bf = backlogFy([...orders, { fp: "FP/2022/9", cas: 30, raf: 5, rafSource: "derive", yearPo: 2022, bu: "ICT", client: "E" }], 2026, { dormantYears: 2 });
    expect(bf.dormantCount).toBe(1); // la 2024 à RAF −20 est HORS population (raf ≤ 0) — pas dormante
    expect(bf.dormantTop[0]).toMatchObject({ fp: "FP/2022/9", yearPo: 2022, raf: 5 });
    expect(bf.dormantYears).toBe(2);
  });

  it("deriveTop persiste un millésime BORNÉ (jamais un yearPo brut aberrant)", () => {
    const bf = backlogFy([{ fp: "FP/2026/7", cas: 10, raf: 10, rafSource: "derive", yearPo: 20226, bu: "ICT", client: "F" }], 2026);
    expect(bf.deriveTop[0].yearPo).toBe(0); // 20226 implausible → 0 (non daté), pas 20226
  });
});
