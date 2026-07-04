import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // Découpe les gros vendors en chunks cacheables séparés (recharts/firebase/react)
    // pour alléger le chunk d'entrée et améliorer le cache entre déploiements.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          recharts: ["recharts"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/functions", "firebase/app-check"],
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
