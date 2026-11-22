import { describe, expect, it } from "vitest";
import { assertSafeTestDatabase, databaseNameOf } from "./support/db-guard.js";

const DEV = "postgresql://u:p@localhost:5432/CA_INTELLIGENCE_PORTAL?schema=public";

describe("test database guard", () => {
  it("extracts the database name", () => {
    expect(databaseNameOf("postgresql://u:p@h:5432/MyDb?schema=public")).toBe("MyDb");
  });

  it("accepts a database whose name contains test", () => {
    expect(() =>
      assertSafeTestDatabase(
        "postgresql://u:p@localhost:5432/CA_INTELLIGENCE_PORTAL_TEST",
        DEV,
      ),
    ).not.toThrow();
  });

  it("refuses a database whose name does not contain test (e.g. the dev database)", () => {
    expect(() => assertSafeTestDatabase(DEV, DEV)).toThrow(/must contain "test"/);
    expect(() =>
      assertSafeTestDatabase("postgresql://u:p@localhost:5432/prod", DEV),
    ).toThrow();
  });
});
