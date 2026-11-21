import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { makeApp } from "./helpers.js";

describe("error handling standard (PRD 9.1)", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => app?.close());

  it("unknown routes return NOT_FOUND in the standard shape", async () => {
    app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ success: false, code: "NOT_FOUND", errors: [] });
  });

  it("validation failures return VALIDATION_ERROR with per-field details", async () => {
    app = await makeApp();
    app
      .withTypeProvider<ZodTypeProvider>()
      .post(
        "/__test/validate",
        { schema: { body: z.object({ email: z.string().email() }) } },
        async () => ({ ok: true }),
      );
    const res = await app.inject({
      method: "POST",
      url: "/__test/validate",
      payload: { email: "nope" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toMatchObject({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
    });
    expect(body.errors[0].field).toBe("email");
  });

  it("unhandled errors never leak internals", async () => {
    app = await makeApp();
    app.get("/__test/boom", async () => {
      throw new Error("secret database password is hunter2");
    });
    const res = await app.inject({ method: "GET", url: "/__test/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      success: false,
      message: "Internal server error",
      code: "INTERNAL_ERROR",
      errors: [],
    });
  });
});
