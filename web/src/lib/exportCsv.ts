// Export CSV des tableaux (PUR + testable). « Ce que tu vois » : on prend la valeur de tri d'une
// colonne quand elle existe (nombres/texte bruts, idéaux pour Excel), sinon on extrait le TEXTE rendu
// de la cellule. Séparateur « ; » (Excel FR) + BOM UTF-8 pour les accents.

// Extrait le texte visible d'un ReactNode (récursif, sans dépendre du DOM).
export function nodeToText(node: any): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (typeof node === "object" && node.props) return nodeToText(node.props.children);
  return "";
}

// Échappe une cellule CSV (RFC 4180, séparateur « ; ») : double les guillemets et entoure la valeur si
// elle contient un séparateur, un guillemet ou un saut de ligne. NEUTRALISE aussi l'injection de FORMULE
// (Excel/Sheets) : une chaîne commençant par = + - @ ou une tabulation/retour chariot est préfixée d'une
// apostrophe — sinon un libellé importé/ClickUp du type =HYPERLINK(...) s'exécuterait à l'ouverture. Cf. audit.
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // désamorce la formule
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Colonne minimale d'export (compatible avec le type Col des composants : header + render + sort?).
export type ExportCol = { header: string; render: (row: any) => any; sort?: (row: any) => any };

// Valeur d'une cellule pour l'export : priorité à la valeur de tri (brute) si primitive non vide,
// sinon le texte rendu.
export function cellValue(col: ExportCol, row: any): string | number {
  if (col.sort) {
    const v = col.sort(row);
    if (typeof v === "number") return v;
    if (typeof v === "string" && v !== "") return v;
  }
  return nodeToText(col.render(row));
}

/** Construit le contenu CSV (entête + lignes) à partir des colonnes visibles et des lignes. PUR. */
export function buildCsv(cols: ExportCol[], rows: any[]): string {
  const head = cols.map((c) => csvCell(c.header)).join(";");
  const body = rows.map((r) => cols.map((c) => csvCell(cellValue(c, r))).join(";")).join("\n");
  return rows.length ? head + "\n" + body : head;
}

/** Déclenche le téléchargement d'un CSV (BOM UTF-8 pour Excel). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
