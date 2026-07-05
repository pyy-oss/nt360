// Thème clair/sombre. Le choix explicite est persisté (localStorage) et posé sur <html data-theme>.
// Sans choix, aucun attribut → le CSS retombe sur prefers-color-scheme (préférence système).
export type Theme = "light" | "dark";
const KEY = "nt360-theme";

/** Thème EFFECTIF : choix explicite s'il existe, sinon préférence système. */
export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Applique et persiste un thème explicite. Met aussi à jour la couleur de la barre navigateur mobile. */
export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#F4F6F3" : "#0E1613");
  try { localStorage.setItem(KEY, t); } catch { /* stockage indisponible : le thème reste en mémoire */ }
}

/** Bascule clair ↔ sombre et renvoie le nouveau thème. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}
