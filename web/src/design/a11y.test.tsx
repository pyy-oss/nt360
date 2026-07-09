// @vitest-environment jsdom
// R4 — GARDE-FOU d'ACCESSIBILITÉ automatisé (axe-core). Monte les primitives du design system dans
// des contextes réalistes et échoue si axe détecte une violation WCAG 2 A/AA sur les règles pertinentes
// pour du rendu jsdom (labels de formulaire, rôles, noms accessibles, structure de tableau, alt…).
// Complète les fondations manuelles déjà en place (skip-link, <main>, :focus-visible, aria-label).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import axe from "axe-core";
import { Card, Table, Badge, Tip, colText, colNum } from "./components";

afterEach(() => cleanup());

// Sous-ensemble de règles axe fiables en jsdom (les règles de contraste nécessitent un vrai moteur de
// layout/canvas, indisponible en jsdom → exclues ici ; le contraste est traité par les tokens de thème).
const AXE_OPTS: axe.RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
  rules: { "color-contrast": { enabled: false } },
};

async function violations(container: HTMLElement): Promise<string[]> {
  const results: axe.AxeResults = await axe.run(container, AXE_OPTS);
  // Message lisible en cas d'échec : règle + cible.
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const rows = [
  { fp: "FP/2026/1", client: "ACME", cas: 1000 },
  { fp: "FP/2026/2", client: "BETA", cas: 2000 },
];
const cols = [
  colText("FP", (r: any) => r.fp, (r: any) => r.fp),
  colText("Client", (r: any) => r.client, (r: any) => r.client),
  colNum("CAS", (r: any) => r.cas, (r: any) => r.cas),
];

describe("Accessibilité (axe-core) — primitives du design system", () => {
  it("Card + Badge + Tip : aucune violation WCAG 2 A/AA", async () => {
    const { container } = render(
      <main>
        <Card title="Vue d'ensemble">
          <Badge tone="emerald">à jour</Badge>
          <Tip>Renseignez le secteur et les contacts du compte.</Tip>
        </Card>
      </main>
    );
    expect(await violations(container)).toEqual([]);
  });

  it("Table : structure et entêtes accessibles, aucune violation", async () => {
    const { container } = render(
      <main>
        <Card title="Opportunités">
          <Table columns={cols} rows={rows} colsKey="a11y-test" />
        </Card>
      </main>
    );
    expect(await violations(container)).toEqual([]);
  });
});
