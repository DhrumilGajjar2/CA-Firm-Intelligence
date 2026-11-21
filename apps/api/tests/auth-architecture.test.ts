import { afterEach, describe, expect, it } from "vitest";
import { firmIdOf, requireRole } from "../src/plugins/permissions.js";
import { makeApp } from "./helpers.js";

type Role = "owner" | "employee";

describe("authentication and permission architecture", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => app?.close());

  async function setup() {
    app = await makeApp();
    app.get("/__test/me", { preHandler: [app.authenticate] }, async (req) => ({
      firm: firmIdOf(req),
    }));
    app.get(
      "/__test/owner-only",
      { preHandler: [app.authenticate, requireRole("owner")] },
      async () => ({ ok: true }),
    );
    // Stand-in for the P1 login endpoint: issues a cookie for the requested role.
    app.get<{ Querystring: { role: Role } }>("/__test/login", async (req, reply) => {
      await app.issueAuthCookie(reply, {
        sub: "user-1",
        firm_id: "firm-1",
        role: req.query.role,
      });
      return { ok: true };
    });
  }

  async function cookieFor(role: Role) {
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
    const res = await app.inject({
      method: "GET",
      url: "/__test/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ firm: "firm-1" });
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
    await setup();
    const employee = await cookieFor("employee");
    const denied = await app.inject({
      method: "GET",
      url: "/__test/owner-only",
      headers: { cookie: employee.cookie },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ success: false, code: "FORBIDDEN" });

    const owner = await cookieFor("owner");
    const allowed = await app.inject({
      method: "GET",
      url: "/__test/owner-only",
      headers: { cookie: owner.cookie },
    });
    expect(allowed.statusCode).toBe(200);
  });
});
