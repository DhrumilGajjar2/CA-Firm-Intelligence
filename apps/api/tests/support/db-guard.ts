/**
 * Safety net for DB-backed tests: the suite may only ever touch a database whose NAME contains "test",
 * and never the development database configured in DATABASE_URL.
 */
export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

export function assertSafeTestDatabase(
  url: string,
  devUrl = process.env["DATABASE_URL"],
): void {
  const name = databaseNameOf(url);
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to use database "${name}" for tests: the database name must contain "test" ` +
        `(suggested: CA_INTELLIGENCE_PORTAL_TEST).`,
    );
  }
  if (devUrl && databaseNameOf(devUrl) === name) {
    const a = new URL(url);
    const b = new URL(devUrl);
    if (a.host === b.host) {
      throw new Error(
        "TEST_DATABASE_URL must not point at the same database as DATABASE_URL.",
      );
    }
  }
}

/** The URL of the test database, or undefined when DB-backed tests should be skipped. */
export function testDatabaseUrl(): string | undefined {
  return process.env["TEST_DATABASE_URL"] || undefined;
}
