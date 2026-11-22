import { execSync } from "node:child_process";
import { assertSafeTestDatabase, testDatabaseUrl } from "./support/db-guard.js";

/**
 * Runs once before the suite: applies the committed migrations to the test database.
 * Without TEST_DATABASE_URL the DB-backed tests skip themselves (they check the same variable).
 */
export default function setup() {
  const url = testDatabaseUrl();
  if (!url) {
    console.warn(
      "\n[tests] TEST_DATABASE_URL is not set: database-backed tests will be SKIPPED.\n" +
        '        Create a database whose name contains "test" (e.g. CA_INTELLIGENCE_PORTAL_TEST) and set\n' +
        "        TEST_DATABASE_URL in apps/api/.env (see .env.example).\n",
    );
    return;
  }
  assertSafeTestDatabase(url);

  // prisma.config.ts reads DATABASE_URL; point it at the test database for this child process only.
  execSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
