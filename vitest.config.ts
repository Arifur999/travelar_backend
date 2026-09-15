import { defineConfig } from "vitest/config";

/**
 * Integration tests: the real Express app against a real Postgres, because
 * what matters most here — tenant isolation, auth rules, money that
 * reconciles — only exists at the database.
 *
 * The database is a separate one whose name must end in `_test`;
 * test/globalSetup.ts refuses anything else before it truncates a single
 * table. Locally that is `travelar_test` on the dev container (created on first
 * run); CI passes TEST_DATABASE_URL.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/travelar_test";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/globalSetup.ts"],
    // One database, so files run one after another; each resets it first.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Set before any app module loads. env.ts calls dotenv, which never
    // overrides a variable that is already set, so a developer's .env cannot
    // point a test run at their real database.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: "",
      BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789",
      BETTER_AUTH_URL: "http://127.0.0.1:5999",
      ACCESS_TOKEN_SECRET: "test-access-token-secret-0123456789",
      REFRESH_TOKEN_SECRET: "test-refresh-token-secret-0123456789",
      FRONTEND_URL: "http://127.0.0.1:3999",
      TRIAL_DAYS: "7",
      SUPER_ADMIN_NAME: "Test Operator",
      SUPER_ADMIN_EMAIL: "operator@travelar.test",
      SUPER_ADMIN_PASSWORD: "Operator@12345",
      SSLCOMMERZ_STORE_ID: "",
      SSLCOMMERZ_STORE_PASSWORD: "",
      SENTRY_DSN: "",
    },
  },
});
