import { execSync } from "node:child_process";
import pg from "pg";

/**
 * Runs once before the suite: makes sure the test database exists and is on
 * the latest migration. Tests reset its data themselves (helpers/db.ts).
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/travelar_test";
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  // The one guard that matters: every test file truncates every table.
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${database}": the test database name must end in _test.`);
  }

  // Create it on first run, connecting to the server's default database.
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (exists.rowCount === 0) {
      // Identifier comes from our own URL and was checked above; quote it anyway.
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }

  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
