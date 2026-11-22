import "dotenv/config"; // loads apps/api/.env so TEST_DATABASE_URL is available to the test run
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // DB-backed test files share one PostgreSQL test database and truncate it between tests.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
