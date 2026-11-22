import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasTestDb, makeTestApp, resetDb, type TestApp } from "./db-helpers.js";
import { INVITATIONS, call, firmWithAllRoles, inviteVia, rawCall } from "./support/slice3.js";

/**
 * Routes that take no body (POST /auth/logout, DELETE /invitations/:id) must not fail because a client
 * announces `Content-Type: application/json` with an empty body (curl -H, Postman, fetch wrappers,
 * axios in Node, ...). The contract says logout has no error response at all.
 */
describe.skipIf(!hasTestDb)("body-less routes tolerate a JSON content type with an empty body", () => {
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

  it("control: both routes work with no content type at all", async () => {
    const f = await firmWithAllRoles(t);
    const { id } = await inviteVia(t, f.cookies.owner, "control@example.com");
    expect((await call(t, "DELETE", `${INVITATIONS}/${id}`, f.cookies.owner)).statusCode).toBe(200);
    expect((await call(t, "POST", "/api/v1/auth/logout", f.cookies.owner)).statusCode).toBe(200);
  });

  it("P1-010: POST /auth/logout with Content-Type: application/json and an empty body is 200 (idempotent, never an error)", async () => {
    const f = await firmWithAllRoles(t);
    const sessions: [string, string | undefined][] = [
      ["valid session", f.cookies.owner],
      ["no session", undefined],
      ["garbage cookie", "access_token=garbage"],
    ];
    for (const [label, cookie] of sessions) {
      const res = await rawCall(t, "POST", "/api/v1/auth/logout", cookie, "");
      expect(res.statusCode, label).toBe(200);
    }
  });

  it("P1-010: DELETE /invitations/:id with Content-Type: application/json and an empty body revokes the invitation", async () => {
    const f = await firmWithAllRoles(t);
    const { id } = await inviteVia(t, f.cookies.owner, "emptybody@example.com");
    const res = await rawCall(t, "DELETE", `${INVITATIONS}/${id}`, f.cookies.owner, "");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("revoked");
  });
});
