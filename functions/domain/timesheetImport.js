// IMPORT CRA EN MASSE (Lot 19 « 20/10 DirOps ») — colle un tableau (depuis ClickUp/Excel) pour renseigner
// PLUSIEURS CRA d'un coup → supprime la double saisie mois par mois. Ligne attendue (séparateur TAB ou
// `;` — PAS la virgule, réservée aux décimales FR) : Nom<sep>AAAA-MM<sep>joursFacturés<sep>joursCongés<sep>
// joursInternes. Le nom est résolu contre
// l'annuaire (Lot 11). Une future passe pourra pré-remplir automatiquement depuis le temps ClickUp
// (task.time_spent est déjà collecté) — mais nécessite une correspondance consultant ↔ assignee ClickUp.
//
// Fonction PURE (aucun I/O) → testable. `nameToId` = { nomMinusculeTrim: id }.

function num(v) { const n = Number(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) && n >= 0 ? Math.min(31, n) : 0; }
function looksLikeHeader(cells) {
  const first = (cells[0] || "").toLowerCase();
  return first === "nom" || first === "consultant" || first === "name";
}

function parseTimesheetPaste(text, nameToId) {
  const rows = [], errors = [];
  const map = nameToId || {};
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(/[\t;]/).map((s) => s.trim());
    if (i === 0 && looksLikeHeader(cells)) continue; // ligne d'en-tête ignorée
    if (cells.length < 2) { errors.push({ line: i + 1, reason: "format (au moins nom + mois)" }); continue; }
    const [name, month, billed, leave, internal] = cells;
    const id = map[String(name || "").toLowerCase()];
    if (!id) { errors.push({ line: i + 1, reason: `consultant inconnu : ${name}` }); continue; }
    if (!/^\d{4}-\d{2}$/.test(month)) { errors.push({ line: i + 1, reason: `mois invalide : ${month}` }); continue; }
    rows.push({ consultantId: id, month, billedDays: num(billed), leaveDays: num(leave), internalDays: num(internal) });
  }
  return { rows, errors };
}

module.exports = { parseTimesheetPaste };
