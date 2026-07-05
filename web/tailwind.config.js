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
      boxShadow: {
        card: "var(--shadow-card)",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-in": "fade-in .25s ease-out both",
      },
    },
  },
  plugins: [],
};
