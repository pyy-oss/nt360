import { defineConfig } from "vitest/config";

// Tests de règles Firestore (RBAC opposable). À lancer via `firebase emulators:exec`
// (script racine `pnpm test:rules`) pour la découverte automatique de l'émulateur.
export default defineConfig({
  test: {
    include: ["test-rules/**/*.test.js"],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
