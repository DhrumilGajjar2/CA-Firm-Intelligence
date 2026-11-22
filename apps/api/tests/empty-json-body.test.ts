import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasTestDb, makeTestApp, resetDb, type TestApp } from "./db-helpers.js";
import { firmWithAllRoles } from "./support/firms.js";
import { FIRM_URL, USERS, rawCall } from "./support/slice3.js";

/**
 * P1-010 fix: an empty / whitespace-only body with a JSON content type is "no body", but that must not
 * weaken validation, malformed-JSON handling, ordering (401, 403, 400) or prototype-poisoning safety.
 */
describe.skipIf(!hasTestDb)("JSON parser: empty body is no body, nothing else changes", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
  });

  it("whitespace-only bodies are also treated as no body on body-less routes", async () => {
    for (const body of [" ", "\n", "\r\n\t  "]) {
      expect((await rawCall(t, "POST", "/api/v1/auth/logout", undefined, body)).statusCode).toBe(200);
    }
  });

  it("routes that require fields still answer 400 VALIDATION_ERROR for an empty or blank body (owner)", async () => {
    const f = await firmWithAllRoles(t);
    for (const [url, method] of [
      [FIRM_URL, "PATCH"],
      [`${USERS}/${f.userIds.viewer}`, "PATCH"],
      [`${USERS}/${f.userIds.viewer}/role`, "PATCH"],
      [`${USERS}/${f.userIds.viewer}/status`, "PATCH"],
      [`${USERS}/invite`, "POST"],
      ["/api/v1/auth/login", "POST"],
      ["/api/v1/auth/accept-invitation", "POST"],
    ] as const) {
      for (const body of ["", "  \n"]) {
        const res = await rawCall(t, method, url, f.cookies.owner, body);
        expect(res.statusCode, `${method} ${url}`).toBe(400);
        expect(res.json().code, `${method} ${url}`).toBe("VALIDATION_ERROR");
      }
    }
  });

  it("malformed non-empty JSON is still the standard 400 envelope", async () => {
    const f = await firmWithAllRoles(t);
    for (const body of ["{bad", "{", "nul", '{"a":1,}', "'x'"]) {
      const res = await rawCall(t, "PATCH", FIRM_URL, f.cookies.owner, body);
      expect(res.statusCode, body).toBe(400);
      expect(res.json()).toMatchObject({ success: false });
    }
  });

  it("401, then 403, then 400 still holds with empty and malformed bodies", async () => {
    const f = await firmWithAllRoles(t);
    for (const body of ["", "{bad"]) {
      expect((await rawCall(t, "PATCH", FIRM_URL, undefined, body)).statusCode).toBe(401);
      expect((await rawCall(t, "PATCH", FIRM_URL, f.cookies.viewer, body)).statusCode).toBe(403);
      expect((await rawCall(t, "PATCH", FIRM_URL, f.cookies.owner, body)).statusCode).toBe(400);
    }
  });

  it("prototype poisoning in a JSON body is still rejected and pollutes nothing", async () => {
    const f = await firmWithAllRoles(t);
    for (const body of ['{"__proto__":{"polluted":true},"name":"X"}', '{"constructor":{"prototype":{"polluted":true}}}']) {
      const res = await rawCall(t, "PATCH", FIRM_URL, f.cookies.owner, body);
      expect(res.statusCode, body).toBe(400);
    }
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("a body over the size limit is still 413", async () => {
    const f = await firmWithAllRoles(t);
    const res = await rawCall(t, "PATCH", FIRM_URL, f.cookies.owner, JSON.stringify({ name: "x".repeat(2_000_000) }));
    expect(res.statusCode).toBe(413);
  });

  it("other content types are unchanged (urlencoded is 415)", async () => {
    const res = await rawCall(t, "POST", "/api/v1/auth/login", undefined, "a=b", "application/x-www-form-urlencoded");
    expect(res.statusCode).toBe(415);
  });
});
