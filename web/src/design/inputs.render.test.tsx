// @vitest-environment jsdom
// Tests de RENDU des primitives de saisie premium (portail + clavier + a11y). On monte réellement les
// composants (jsdom) et on exerce les interactions clés (filtre, sélection, création, navigation mois).
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Combo, MonthField } from "./inputs";
import { Field } from "./components";

afterEach(() => cleanup());

const OPTS = [
  { value: "ict", label: "ICT" },
  { value: "cloud", label: "CLOUD" },
  { value: "formation", label: "FORMATION" },
];

describe("Combo — recherche + sélection + création", () => {
  it("ouvre, filtre (insensible casse/accents) et sélectionne une option", () => {
    const onChange = vi.fn();
    render(<Combo value="" onChange={onChange} options={OPTS} ariaLabel="BU" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "clo" } });
    const opt = screen.getByText("CLOUD");
    fireEvent.mouseDown(opt);
    expect(onChange).toHaveBeenCalledWith("cloud");
  });
  it("filtre à zéro résultat sans allowCreate → message vide, aucune création", () => {
    render(<Combo value="" onChange={() => {}} options={OPTS} ariaLabel="BU" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("Aucun résultat")).toBeTruthy();
  });
  it("allowCreate : propose de créer la valeur libre tapée", () => {
    const onChange = vi.fn();
    render(<Combo value="" onChange={onChange} options={OPTS} allowCreate ariaLabel="Client" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Nouvelle SA" } });
    const create = screen.getByText(/Créer/);
    fireEvent.mouseDown(create);
    expect(onChange).toHaveBeenCalledWith("Nouvelle SA");
  });
  it("affiche le libellé de la valeur sélectionnée au repos", () => {
    render(<Combo value="ict" onChange={() => {}} options={OPTS} ariaLabel="BU" />);
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("ICT");
  });
});

describe("MonthField — sélecteur mois/année", () => {
  it("ouvre, navigue l'année et sélectionne un mois → AAAA-MM", () => {
    const onChange = vi.fn();
    render(<MonthField value="2026-03" onChange={onChange} ariaLabel="Mois" />);
    fireEvent.click(screen.getByLabelText("Mois"));
    fireEvent.click(screen.getByLabelText("Année suivante")); // 2026 → 2027
    fireEvent.click(screen.getByText("Juin"));
    expect(onChange).toHaveBeenCalledWith("2027-06");
  });
});

describe("Field — étiquette + indice + erreur", () => {
  it("rend le label, l'astérisque requis et l'erreur (prioritaire sur l'indice)", () => {
    render(<Field label="Client" required hint="indice" error="requis"><input /></Field>);
    expect(screen.getByText("Client")).toBeTruthy();
    expect(screen.getByText("*")).toBeTruthy();
    expect(screen.getByText("requis")).toBeTruthy();
    expect(screen.queryByText("indice")).toBeNull(); // error prime
  });
});
