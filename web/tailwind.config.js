/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palette Forest & Gold (BUILD_KIT §12)
        bg: "#0E1613",
        panel: "#151F1A",
        panel2: "#1B2721",
        line: "#26352D",
        ink: "#EEF3EF",
        muted: "#8FA89B",
        faint: "#5E7268",
        gold: "#C9A24B",
        emerald: "#46C08A",
        clay: "#D9694C",
        steel: "#6E9DC0",
        plum: "#A98AC4",
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', "system-ui", "sans-serif"],
        sans: ['"Inter Variable"', "system-ui", "sans-serif"],
      },
      borderRadius: { xl2: "1rem" },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,.03) inset, 0 8px 24px -12px rgba(0,0,0,.6)",
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
