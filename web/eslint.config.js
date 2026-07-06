// ESLint « ciblé » : on ne lint PAS tout le style (le code n'a jamais été linté et croulerait sous
// des milliers d'avis) — on cible la classe de bugs qui a provoqué un crash en prod : les règles
// des hooks React. `rules-of-hooks` en ERREUR (bloque le CI) attrape les hooks conditionnels /
// après retour anticipé (React #310). `exhaustive-deps` en AVERTISSEMENT (informatif, ne bloque pas ;
// le code porte déjà des `// eslint-disable-next-line` explicites là où c'est volontaire).
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
