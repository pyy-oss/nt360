// BULLETIN HEBDO « HOT TOPICS OPÉRATIONS » — commentaires / points clés hebdomadaires saisis
// manuellement (Phase 1), structurés en SECTIONS (ex. « Engagements fournisseurs », « Projets »)
// contenant des puces, elles-mêmes pouvant porter des SOUS-PUCES (2 niveaux, cf. capture métier).
// Phase 2 (différée) : pré-remplissage depuis ClickUp (commandes / commentaires projets).
// Module PUR (validation) → testable, réutilisé par le callable.

const S = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

// Bornes anti-abus (un bulletin reste un résumé, pas un dépotoir) : sections/puces/sous-puces plafonnées.
const MAX_SECTIONS = 12, MAX_ITEMS = 60, MAX_SUB = 20, MAX_TITLE = 120, MAX_TEXT = 800;

/** Valide + NORMALISE un bulletin { fy, week, sections:[{title, items:[{text, sub:[..]}]}] }.
 *  Trim + plafonds + suppression des entrées vides. Renvoie { ok, value } ou { ok:false, error }. */
function validateOpsBulletin(d) {
  const o = d || {};
  const fy = Number(o.fy);
  if (!Number.isInteger(fy) || fy < 2000 || fy > 3000) return { ok: false, error: "exercice (fy) invalide" };
  const week = Number(o.week);
  if (!Number.isInteger(week) || week < 1 || week > 53) return { ok: false, error: "semaine (1..53) invalide" };

  const secIn = Array.isArray(o.sections) ? o.sections.slice(0, MAX_SECTIONS) : [];
  const sections = secIn.map((s) => {
    const so = s || {};
    const items = (Array.isArray(so.items) ? so.items.slice(0, MAX_ITEMS) : []).map((it) => {
      const io = it || {};
      const sub = (Array.isArray(io.sub) ? io.sub.slice(0, MAX_SUB) : [])
        .map((x) => S(x, MAX_TEXT)).filter(Boolean);
      return { text: S(io.text, MAX_TEXT), sub };
    }).filter((it) => it.text || it.sub.length); // puce vide (sans texte ni sous-puce) → écartée
    return { title: S(so.title, MAX_TITLE), items };
  }).filter((s) => s.title || s.items.length); // section vide → écartée

  return { ok: true, value: { fy, week, sections } };
}

// Id déterministe d'un bulletin (1 par semaine d'exercice) : « 2026_W27 ». Semaine zéro-paddée → tri lexical.
const bulletinId = (fy, week) => `${Number(fy)}_W${String(Number(week)).padStart(2, "0")}`;

module.exports = { validateOpsBulletin, bulletinId, MAX_SECTIONS, MAX_ITEMS, MAX_SUB };
