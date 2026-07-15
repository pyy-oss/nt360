import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // Découpe les gros vendors en chunks cacheables séparés (react/recharts/firebase) pour alléger le
    // chunk d'entrée et améliorer le cache entre déploiements. FORME FONCTION (pas tableau de noms) :
    // le mapping par tableau ne capturait PAS `react/jsx-runtime` ni `scheduler` → ils étaient absorbés
    // dans le chunk recharts (560 KB), qui devenait alors dépendance STATIQUE de l'entrée (React y vit) →
    // recharts `modulepreload` sur le chemin critique de TOUS les utilisateurs. En groupant tout l'écosystème
    // React (jsx-runtime/scheduler inclus) dans le chunk `react`, recharts redevient purement à la demande.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/.test(id)) return "react";
          if (/[\\/]node_modules[\\/](recharts|recharts-scale|d3-|victory-vendor|react-smooth|decimal\.js-light|fast-equals|internmap|eventemitter3|tiny-invariant)[\\/]/.test(id)) return "recharts";
          if (/[\\/]node_modules[\\/]@?firebase[\\/]/.test(id)) return "firebase";
          return;
        },
      },
    },
  },
  test: {
    environment: "node",
    // Vitest ne couvre que les tests unitaires sous src/. Les specs Playwright (e2e/) sont
    // jouées par `playwright test` et ne doivent pas être ramassées par vitest (elles importent
    // @playwright/test et ne tourneraient pas sous vitest).
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
