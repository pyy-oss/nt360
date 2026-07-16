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

  it("colsKey : masquer une colonne la retire du tableau et persiste le choix", async () => {
    render(<Table columns={cols} rows={rows} colsKey="t-test" />);
    // La colonne « Client » est visible au départ.
    expect(screen.getByRole("columnheader", { name: "Client" })).toBeTruthy();
    // Décocher « Client » dans le sélecteur de colonnes (chargé en lazy → findBy).
    fireEvent.click(await screen.findByRole("checkbox", { name: "Colonne Client" }));
    expect(screen.queryByRole("columnheader", { name: "Client" })).toBeNull();
    // Le choix est persisté sous la clé attendue.
    expect(localStorage.getItem("nt360-cols-t-test")).toContain("Client");
  });

  // Le tri est mémoïsé sur des signaux STABLES (rows/sort/hidden) et NON sur l'identité des colonnes
  // (construites en inline côté appelant → neuves à chaque rendu). Ces tests figent le comportement :
  // le tri fonctionne toujours, et masquer une colonne (bascule `hidden`) ré-évalue bien le rendu.
  it("tri : cliquer un entête triable ordonne les lignes puis inverse le sens", () => {
    const desc = [
      { fp: "FP/2026/1", client: "ZED", cas: 100 },
      { fp: "FP/2026/2", client: "ALP", cas: 900 },
    ];
    render(<Table columns={cols} rows={desc} />);
    // Ordre du DOM au repos = ordre des lignes fournies (ZED avant ALP).
    let cells = screen.getAllByText(/ZED|ALP/).map((n) => n.textContent);
    expect(cells).toEqual(["ZED", "ALP"]);
    // Tri ascendant sur « Client » → ALP remonte.
    fireEvent.click(screen.getByRole("button", { name: "Client" }));
    cells = screen.getAllByText(/ZED|ALP/).map((n) => n.textContent);
    expect(cells).toEqual(["ALP", "ZED"]);
    // Deuxième clic → sens inverse.
    fireEvent.click(screen.getByRole("button", { name: "Client" }));
    cells = screen.getAllByText(/ZED|ALP/).map((n) => n.textContent);
    expect(cells).toEqual(["ZED", "ALP"]);
  });

  it("tri actif puis masquage d'une colonne : le rendu reste cohérent (hidden re-déclenche le memo)", async () => {
    render(<Table columns={cols} rows={rows} colsKey="sort-hide" />);
    fireEvent.click(screen.getByRole("button", { name: "CAS" })); // tri ascendant sur CAS
    // Masquer « Client » : la bascule `hidden` doit ré-évaluer le tri sans casser l'affichage.
    fireEvent.click(await screen.findByRole("checkbox", { name: "Colonne Client" }));
    expect(screen.queryByRole("columnheader", { name: "Client" })).toBeNull();
    // Les lignes restent rendues, dans l'ordre CAS croissant (FP/2026/1=1000 avant FP/2026/2=2000).
    // On lit la colonne FP, toujours visible (« Client » est masquée).
    const cells = screen.getAllByText(/FP\/2026\/[12]/).map((n) => n.textContent);
    expect(cells).toEqual(["FP/2026/1", "FP/2026/2"]);
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

  it("colsKey : masquer une colonne la retire de la liste", async () => {
    render(<ListView rows={rows} columns={cols} searchKeys={[(r: any) => r.fp]} colsKey="lv-test" />);
    expect(screen.getByRole("columnheader", { name: "CAS" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Colonne CAS" }));
    expect(screen.queryByRole("columnheader", { name: "CAS" })).toBeNull();
  });

  it("ne masque jamais la DERNIÈRE colonne visible (case désactivée)", async () => {
    const one = [colText("Seule", (r: any) => r.fp)];
    render(<Table columns={one} rows={rows} colsKey="last-test" />);
    const cb = await screen.findByRole("checkbox", { name: "Colonne Seule" }) as HTMLInputElement;
    expect(cb.disabled).toBe(true);
  });
});

// Recherche intégrée au Table (parité avec ListView) : filtre en mémoire, insensible à la casse.
describe("Table — recherche intégrée (searchKeys)", () => {
  it("filtre les lignes selon la requête (insensible casse)", () => {
    render(<Table columns={cols} rows={rows} searchKeys={[(r: any) => r.client]} />);
    expect(screen.getByText("ACME")).toBeTruthy();
    expect(screen.getByText("BETA")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "acm" } });
    expect(screen.getByText("ACME")).toBeTruthy();
    expect(screen.queryByText("BETA")).toBeNull();
  });
});

// Filtre par colonne : une colonne déclarant `filter` (4ᵉ arg de colText) ouvre le menu « Filtres »
// (chargé en lazy) ; cocher une valeur ne garde que les lignes correspondantes, cumulable avec recherche/tri.
describe("Table / ListView — filtre par colonne", () => {
  const fcols = [colText("Client", (r: any) => r.client, (r: any) => r.client), colText("Statut", (r: any) => r.status, (r: any) => r.status, (r: any) => r.status)];
  const frows = [{ client: "ACME", status: "ouvert" }, { client: "BETA", status: "clos" }];
  it("Table : cocher une valeur de colonne ne garde que ses lignes", async () => {
    render(<Table columns={fcols} rows={frows} />);
    expect(screen.getByText("ACME")).toBeTruthy();
    expect(screen.getByText("BETA")).toBeTruthy();
    // Le menu « Filtres » est lazy → findBy sur la case de la valeur (aria-label « Statut : ouvert »).
    fireEvent.click(await screen.findByRole("checkbox", { name: "Statut : ouvert" }));
    expect(screen.getByText("ACME")).toBeTruthy();
    expect(screen.queryByText("BETA")).toBeNull();
  });
});

// Sélection multiple + actions en masse (Table et ListView) : cases par ligne + « tout sélectionner »
// + barre d'actions (chargée en lazy) qui reçoit les LIGNES cochées.
describe("Table / ListView — sélection multiple + actions en masse", () => {
  it("Table : cocher une ligne révèle la barre ; l'action reçoit les lignes sélectionnées", async () => {
    let got: any[] = [];
    const bulk = [{ label: "Traiter", run: (rs: any[]) => { got = rs; } }];
    render(<Table columns={cols} rows={rows} rowKey={(r: any) => r.fp} bulk={bulk} />);
    // Case de la 1re ligne (ACME). Les cases « ligne » portent l'aria-label générique.
    const boxes = screen.getAllByRole("checkbox", { name: "Sélectionner la ligne" });
    fireEvent.click(boxes[0]);
    // La barre (lazy) affiche « 1 sélectionné » et le bouton d'action.
    const act = await screen.findByText("Traiter");
    fireEvent.click(act);
    expect(got).toHaveLength(1);
    expect(got[0].fp).toBe("FP/2026/1");
  });
  it("Table : « tout sélectionner » coche toutes les lignes filtrées", async () => {
    render(<Table columns={cols} rows={rows} rowKey={(r: any) => r.fp} bulk={[{ label: "X", run: () => {} }]} />);
    const all = await screen.findByRole("checkbox", { name: "Tout sélectionner" });
    fireEvent.click(all);
    expect(await screen.findByText("2 sélectionnés")).toBeTruthy();
  });
  it("ListView : sélection + barre d'actions", async () => {
    render(<ListView rows={rows} columns={cols} searchKeys={[(r: any) => r.fp]} rowKey={(r: any) => r.fp} bulk={[{ label: "Traiter", run: () => {} }]} />);
    const boxes = screen.getAllByRole("checkbox", { name: "Sélectionner la ligne" });
    fireEvent.click(boxes[0]);
    expect(await screen.findByText("1 sélectionné")).toBeTruthy();
  });
});

// Socle premium (design) : le repli auto au-delà de 7 colonnes ne doit JAMAIS cacher une colonne
// d'action (entête vide) — les boutons/menus restent toujours en ligne, pas sous le chevron de détail.
describe("Table — colonne d'action jamais repliée (repli auto > 7 colonnes)", () => {
  it("garde le bouton d'action EN LIGNE quand il y a plus de 7 colonnes de données", () => {
    const wide = [
      colText("C1", (r: any) => r.fp), colText("C2", (r: any) => r.fp), colText("C3", (r: any) => r.fp),
      colText("C4", (r: any) => r.fp), colText("C5", (r: any) => r.fp), colText("C6", (r: any) => r.fp),
      colText("C7", (r: any) => r.fp), colText("C8", (r: any) => r.fp),
      // Colonne d'action : entête vide, déclarée EN DERNIER (donc au-delà du plafond de repli).
      colText("", () => <button type="button">Éditer</button>),
    ];
    render(<Table columns={wide} rows={[rows[0]]} />);
    // Le bouton est rendu directement (aucun détail ouvert) → il est resté dans la ligne principale.
    expect(screen.getByRole("button", { name: "Éditer" })).toBeTruthy();
    // Une colonne de donnée excédentaire (C8) est, elle, repliée dans le détail (absente au repos).
    expect(screen.queryByRole("columnheader", { name: "C8" })).toBeNull();
    // Le tableau est donc bien extensible (chevron de détail présent).
    expect(screen.getAllByRole("button", { name: "Afficher le détail" }).length).toBeGreaterThan(0);
  });
});
