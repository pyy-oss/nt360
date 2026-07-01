import { defineConfig } from "vitest/config";

// Tests unitaires (parseurs + helpers + domaine). Les tests de règles, qui exigent
// l'émulateur Firestore, sont isolés dans test-rules/ (vitest.rules.config.js).
export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
  },
});
