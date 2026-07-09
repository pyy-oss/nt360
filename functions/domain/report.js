// REPORTING SELF-SERVICE (Lot 6 « niveau Salesforce ») — moteur de rapport sur les opportunités :
// FILTRES + REGROUPEMENT + MESURE, sans code. Comble l'écart #6 de l'audit (aucun reporting
// self-service : les vues étaient toutes figées). Fonction PURE (aucun I/O) → partagée par le
// constructeur de rapport (client) et la validation (callable de sauvegarde) ; testable.

const GROUP_FIELDS = ["bu", "am", "stage", "client", "forecastCategory"];
const MEASURES = ["count", "amount", "weighted"];

// Normalise/valide une définition de rapport. { ok, error?, value? }.
function validateReportDef(d) {
  const o = d || {};
  const groupBy = GROUP_FIELDS.includes(o.groupBy) ? o.groupBy : null;
  if (!groupBy) return { ok: false, error: "regroupement invalide" };
  const measure = MEASURES.includes(o.measure) ? o.measure : "count";
  const fin = o.filters || {};
  const filters = {
    bu: fin.bu ? String(fin.bu).trim().toUpperCase() : null,
    am: fin.am ? String(fin.am).trim() : null,
    client: fin.client ? String(fin.client).trim() : null,
    stage: fin.stage != null && fin.stage !== "" && Number.isFinite(Number(fin.stage)) ? Number(fin.stage) : null,
    forecastCategory: fin.forecastCategory ? String(fin.forecastCategory).trim() : null,
    minAmount: Number.isFinite(Number(fin.minAmount)) && Number(fin.minAmount) > 0 ? Number(fin.minAmount) : null,
    openOnly: fin.openOnly === true,
  };
  return { ok: true, value: { groupBy, measure, filters } };
}

function passes(o, f) {
  if (f.bu && String(o.bu || "").toUpperCase() !== f.bu) return false;
  if (f.am && String(o.am || "") !== f.am) return false;
  if (f.client && String(o.client || "") !== f.client) return false;
  if (f.stage != null && (Number(o.stage) || 0) !== f.stage) return false;
  if (f.forecastCategory && String(o.forecastCategory || "") !== f.forecastCategory) return false;
  if (f.minAmount != null && (Number(o.amount) || 0) < f.minAmount) return false;
  if (f.openOnly) { const s = Number(o.stage) || 0; if (s < 1 || s > 5) return false; }
  return true;
}

// Applique un rapport à un jeu d'opportunités → lignes groupées (count / Σ montant / Σ pondéré) triées
// par la mesure choisie, décroissant, + totaux.
function applyReport(def, opps) {
  const v = validateReportDef(def);
  const d = v.ok ? v.value : { groupBy: "bu", measure: "count", filters: {} };
  const groups = new Map();
  const totals = { count: 0, amount: 0, weighted: 0 };
  for (const o of opps || []) {
    if (!passes(o, d.filters)) continue;
    const raw = o[d.groupBy];
    const key = raw == null || raw === "" ? "(non renseigné)" : String(raw);
    const amount = Number(o.amount) || 0;
    const weighted = Number.isFinite(Number(o.weighted)) ? Number(o.weighted) : amount * (Number(o.probability) || 0);
    const g = groups.get(key) || { key, count: 0, amount: 0, weighted: 0 };
    g.count++; g.amount += amount; g.weighted += weighted;
    groups.set(key, g);
    totals.count++; totals.amount += amount; totals.weighted += weighted;
  }
  const rows = [...groups.values()].sort((a, b) => b[d.measure] - a[d.measure] || String(a.key).localeCompare(String(b.key)));
  return { groupBy: d.groupBy, measure: d.measure, rows, totals };
}

module.exports = { GROUP_FIELDS, MEASURES, validateReportDef, applyReport };
