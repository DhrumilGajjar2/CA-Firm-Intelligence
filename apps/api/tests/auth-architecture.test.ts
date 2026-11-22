import { afterEach, describe, expect, it } from "vitest";
import type { UserRole } from "../src/generated/prisma/client.js";
import { firmIdOf, requireRole } from "../src/plugins/permissions.js";
import { fakePrisma, makeApp, type FakeMembership } from "./helpers.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FIRM_ID = "22222222-2222-4222-8222-222222222222";

describe("authentication and permission architecture", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => app?.close());

  /** `membership` is what the (fake) database holds for the user; `null` = no membership row. */
  async function setup(membership: FakeMembership = { role: "owner", is_active: true }) {
    app = await makeApp(fakePrisma(undefined, membership));
    app.get("/__test/me", { preHandler: [app.authenticate] }, async (req) => ({
      firm: firmIdOf(req),
      role: req.user.role,
    }));
    app.get(
      "/__test/owner-only",
      { preHandler: [app.authenticate, requireRole("owner")] },
      async () => ({ ok: true }),
    );
    // Stand-in for login: issues a cookie whose TOKEN claims the requested role.
    app.get<{ Querystring: { role: UserRole } }>("/__test/login", async (req, reply) => {
      await app.issueAuthCookie(reply, {
        sub: USER_ID,
        firm_id: FIRM_ID,
        role: req.query.role,
      });
      return { ok: true };
    });
  }

  async function cookieFor(role: UserRole) {
    const res = await app.inject({ method: "GET", url: `/__test/login?role=${role}` });
    const header = String(res.headers["set-cookie"]);
    return { header, cookie: header.split(";")[0]! };
  }

  it("rejects requests without a session (401 UNAUTHENTICATED)", async () => {
    await setup();
    const res = await app.inject({ method: "GET", url: "/__test/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
  });

  it("issues an httpOnly, SameSite cookie and accepts it", async () => {
    await setup();
    const { header, cookie } = await cookieFor("owner");
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//i);
    const res = await app.inject({
      method: "GET",
      url: "/__test/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ firm: FIRM_ID, role: "owner" });
  });

  it("rejects a tampered token", async () => {
    await setup();
    const res = await app.inject({
      method: "GET",
      url: "/__test/me",
      headers: { cookie: "access_token=not.a.real.token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("enforces roles on the server (403 FORBIDDEN)", async () => {
    await setup({ role: "employee", is_active: true });
    const employee = await cookieFor("employee");
    const denied = await app.inject({
      method: "GET",
      url: "/__test/owner-only",
      headers: { cookie: employee.cookie },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ success: false, code: "FORBIDDEN" });
  });

  it("allows the owner role through requireRole", async () => {
    await setup({ role: "owner", is_active: true });
    const owner = await cookieFor("owner");
    const allowed = await app.inject({
      method: "GET",
      url: "/__test/owner-only",
      headers: { cookie: owner.cookie },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("uses the DATABASE role, not the role claimed in the token", async () => {
    // Token says owner, but the database says the user is only an employee now.
    await setup({ role: "employee", is_active: true });
    const { cookie } = await cookieFor("owner");
    const me = await app.inject({
      method: "GET",
      url: "/__test/me",
      headers: { cookie },
    });
    expect(me.json()).toMatchObject({ role: "employee" });
    const denied = await app.inject({
      method: "GET",
      url: "/__test/owner-only",
      headers: { cookie },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("rejects a valid token when the membership is inactive (401)", async () => {
    await setup({ role: "owner", is_active: false });
    const { cookie } = await cookieFor("owner");
    const res = await app.inject({
      method: "GET",
      url: "/__test/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
  });

  it("rejects a valid token when the membership no longer exists (401)", async () => {
    await setup(null);
    const { cookie } = await cookieFor("owner");
    const res = await app.inject({
      method: "GET",
      url: "/__test/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
  });
});
