import { defineConfig } from "vitest/config";

// Tests unitaires (parseurs + helpers + domaine). Les tests de règles, qui exigent
// l'émulateur Firestore, sont isolés dans test-rules/ (vitest.rules.config.js).
export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["domain/**", "lib/**", "parsers/**"],
      thresholds: { statements: 80, functions: 80, lines: 80 },
    },
  },
});
