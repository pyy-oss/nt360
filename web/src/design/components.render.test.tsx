// @vitest-environment jsdom
// Tests de RENDU (React Testing Library) des composants de tableau partagés — la surface qui a
// concentré les régressions runtime récentes (crash #310, détail extensible #162, personnalisation
// des colonnes #167). On monte réellement les composants (jsdom) et on exerce les interactions.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Table, ListView, colText, colNum } from "./components";

const rows = [
  { fp: "FP/2026/1", client: "ACME", cas: 1000 },
  { fp: "FP/2026/2", client: "BETA", cas: 2000 },
];
const cols = [
  colText("FP", (r: any) => r.fp, (r: any) => r.fp),
  colText("Client", (r: any) => r.client, (r: any) => r.client),
  colNum("CAS", (r: any) => r.cas, (r: any) => r.cas),
];

beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom */ } });
// Sans globals vitest, l'auto-nettoyage RTL ne s'accroche pas → on démonte explicitement entre tests.
afterEach(() => cleanup());

describe("Table — rendu & personnalisation des colonnes", () => {
  it("rend les entêtes et les cellules", () => {
    render(<Table columns={cols} rows={rows} />);
    expect(screen.getByText("FP")).toBeTruthy();
    expect(screen.getByText("ACME")).toBeTruthy();
    expect(screen.getByText("BETA")).toBeTruthy();
  });

  it("colsKey : masquer une colonne la retire du tableau et persiste le choix", () => {
    render(<Table columns={cols} rows={rows} colsKey="t-test" />);
    // La colonne « Client » est visible au départ.
    expect(screen.getByRole("columnheader", { name: "Client" })).toBeTruthy();
    // Décocher « Client » dans le sélecteur de colonnes.
    fireEvent.click(screen.getByRole("checkbox", { name: "Colonne Client" }));
    expect(screen.queryByRole("columnheader", { name: "Client" })).toBeNull();
    // Le choix est persisté sous la clé attendue.
    expect(localStorage.getItem("nt360-cols-t-test")).toContain("Client");
  });
});

describe("ListView — recherche, détail extensible, colonnes", () => {
  it("filtre les lignes par la recherche", () => {
    render(<ListView rows={rows} columns={cols} searchKeys={[(r: any) => r.client]} />);
    expect(screen.getByText("ACME")).toBeTruthy();
    expect(screen.getByText("BETA")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Rechercher…"), { target: { value: "beta" } });
    expect(screen.queryByText("ACME")).toBeNull();
    expect(screen.getByText("BETA")).toBeTruthy();
  });

  it("détail extensible : le chevron révèle le panneau sous la ligne", () => {
    render(
      <ListView rows={rows} columns={cols} searchKeys={[(r: any) => r.fp]}
        rowKey={(r: any) => r.fp} expand={(r: any) => <div>détail-{r.client}</div>} />
    );
    expect(screen.queryByText("détail-ACME")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Afficher le détail" })[0]);
    expect(screen.getByText("détail-ACME")).toBeTruthy();
  });

  it("colsKey : masquer une colonne la retire de la liste", () => {
    render(<ListView rows={rows} columns={cols} searchKeys={[(r: any) => r.fp]} colsKey="lv-test" />);
    expect(screen.getByRole("columnheader", { name: "CAS" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Colonne CAS" }));
    expect(screen.queryByRole("columnheader", { name: "CAS" })).toBeNull();
  });

  it("ne masque jamais la DERNIÈRE colonne visible (case désactivée)", () => {
    const one = [colText("Seule", (r: any) => r.fp)];
    render(<Table columns={one} rows={rows} colsKey="last-test" />);
    const cb = screen.getByRole("checkbox", { name: "Colonne Seule" }) as HTMLInputElement;
    expect(cb.disabled).toBe(true);
  });
});
