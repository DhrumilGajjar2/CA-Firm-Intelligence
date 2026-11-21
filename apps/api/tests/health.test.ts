import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePrisma, makeApp } from "./helpers.js";

describe("GET /api/v1/health", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => app?.close());

  it("returns the standard success envelope when the database is reachable", async () => {
    app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe("API is healthy");
    expect(body.data).toMatchObject({ status: "ok", database: "up" });
  });

  it("returns 503 in the standard error shape when the database is down", async () => {
    app = await makeApp(
      fakePrisma(vi.fn().mockRejectedValue(new Error("connection refused"))),
    );
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      success: false,
      message: "Database is not reachable",
      code: "SERVICE_UNAVAILABLE",
      errors: [],
    });
  });
});
