/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palette Forest & Gold (BUILD_KIT §12) — pilotée par variables CSS (thème clair/sombre).
        // rgb(var(--x) / <alpha-value>) préserve les modificateurs d'opacité Tailwind (bg-gold/15…).
        bg: "rgb(var(--bg) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        panel2: "rgb(var(--panel2) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        gold: "rgb(var(--gold) / <alpha-value>)",
        emerald: "rgb(var(--emerald) / <alpha-value>)",
        clay: "rgb(var(--clay) / <alpha-value>)",
        steel: "rgb(var(--steel) / <alpha-value>)",
        plum: "rgb(var(--plum) / <alpha-value>)",
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', "system-ui", "sans-serif"],
        sans: ['"Inter Variable"', "system-ui", "sans-serif"],
      },
      borderRadius: { xl2: "1rem" },
      // Échelle d'empilement CENTRALISÉE (superpositions flottantes). Un seul endroit fait foi : on ne
      // dispersera plus des `z-[87]` magiques dont l'ordre relatif dérive. Ordre croissant = du plus bas
      // au plus haut. Invariants tenus : un pop-over de champ (select), un toast et une infobulle
      // déclenchés DEPUIS une modale doivent passer AU-DESSUS d'elle (sinon retour d'action / choix
      // masqués). Les `z-10/20` locaux (en-têtes de tableau collants) restent hors de cette échelle.
      zIndex: {
        menu: "30",     // menus déroulants d'actions (bulk, colonnes)
        badge: "40",    // badge de statut persistant (recompute en bas d'écran)
        drawer: "50",   // tiroir plein écran (Centre d'activité)
        overlay: "60",  // modales / dialogues bloquants
        toast: "70",    // retours d'action — AU-DESSUS des modales (feedback toujours visible)
        popover: "80",  // pop-overs de champ (select/combobox) — AU-DESSUS d'une modale
        tooltip: "90",  // infobulles (Tip) — couche la plus haute
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "scale-in": { from: { opacity: 0, transform: "translateY(8px) scale(.97)" }, to: { opacity: 1, transform: "none" } },
        "slide-in": { from: { opacity: 0, transform: "translateX(16px)" }, to: { opacity: 1, transform: "none" } },
        "overlay-in": { from: { opacity: 0 }, to: { opacity: 1 } },
      },
      animation: {
        "fade-in": "fade-in .25s ease-out both",
        "scale-in": "scale-in .18s cubic-bezier(.2,.8,.2,1) both",
        "slide-in": "slide-in .22s cubic-bezier(.2,.8,.2,1) both",
        "overlay-in": "overlay-in .15s ease-out both",
      },
    },
  },
  plugins: [],
};
