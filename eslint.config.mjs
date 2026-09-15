import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // An underscore marks a parameter that has to exist for its position —
      // Express only treats a handler as an error handler when it declares all
      // four (err, req, res, next), even if it never calls next.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Integration tests read JSON response bodies whose shape is the thing
    // under test; typing every one of them up front would only restate the
    // assertions.
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // Build-time Node scripts, plain ESM rather than TypeScript.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
);
