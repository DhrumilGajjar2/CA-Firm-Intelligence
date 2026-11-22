import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMember,
  hasTestDb,
  loginCookie,
  makeTestApp,
  resetDb,
  type TestApp,
} from "./db-helpers.js";
import type { FirmFixture } from "./support/firms.js";
import {
  ACCEPT,
  FORBIDDEN_MESSAGE,
  IDENTITIES,
  INVITATIONS,
  INVITE,
  LOGIN,
  ME,
  NO_ONE,
  PREVIEW,
  USERS,
  call,
  cookieFor,
  cookieOfIdentity,
  expectEnvelope,
  firmWithAllRoles,
  inviteVia,
  rawCall,
  type Identity,
} from "./support/slice3.js";

/** Everything that could change if an endpoint wrongly let a caller through. */
async function snapshot(t: TestApp): Promise<string> {
  const [users, members, invitations, firms, tokens] = await Promise.all([
    t.prisma.user.findMany({ orderBy: { id: "asc" } }),
    t.prisma.firmMember.findMany({ orderBy: { id: "asc" } }),
    t.prisma.invitation.findMany({ orderBy: { id: "asc" } }),
    t.prisma.firm.findMany({ orderBy: { id: "asc" } }),
    t.prisma.passwordResetToken.findMany({ orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ users, members, invitations, firms, tokens });
}

type Expected = Record<Identity, number>;
const exp = (o: number, m: number, e: number, v: number, a: number): Expected => ({
  owner: o,
  manager: m,
  employee: e,
  viewer: v,
  anonymous: a,
});

interface Ctx {
  f: FirmFixture;
  /** An extra employee of the firm that is nobody's identity (safe target for mutations). */
  target: string;
  /** A pending invitation of the firm. */
  invitationId: string;
}

interface Case {
  name: string;
  expected: Expected;
  send: (t: TestApp, ctx: Ctx, who: Identity, cookie: string | undefined) => ReturnType<typeof call>;
  /** owner-run state change may happen only when the expected status is a success */
  mutates?: boolean;
}

const CASES: Case[] = [
  {
    name: "GET /users",
    expected: exp(200, 200, 403, 403, 401),
    send: (t, _c, _w, cookie) => call(t, "GET", USERS, cookie),
  },
  {
    name: "POST /users/invite",
    expected: exp(201, 403, 403, 403, 401),
    mutates: true,
    send: (t, _c, who, cookie) => call(t, "POST", INVITE, cookie, { email: `matrix-${who}@example.com`, role: "viewer" }),
  },
  {
    name: "GET /users/:id (another member)",
    expected: exp(200, 200, 403, 403, 401),
    send: (t, c, _w, cookie) => call(t, "GET", `${USERS}/${c.target}`, cookie),
  },
  {
    name: "GET /users/:id (own id)",
    expected: exp(200, 200, 200, 200, 401),
    send: (t, c, who, cookie) => call(t, "GET", `${USERS}/${who === "anonymous" ? c.target : c.f.userIds[who]}`, cookie),
  },
  {
    name: "PATCH /users/:id (another member)",
    expected: exp(200, 403, 403, 403, 401),
    mutates: true,
    send: (t, c, _w, cookie) => call(t, "PATCH", `${USERS}/${c.target}`, cookie, { name: "Renamed By Matrix" }),
  },
  {
    name: "PATCH /users/:id (own id)",
    expected: exp(200, 200, 200, 200, 401),
    mutates: true,
    send: (t, c, who, cookie) =>
      call(t, "PATCH", `${USERS}/${who === "anonymous" ? c.target : c.f.userIds[who]}`, cookie, { name: `Self ${who}` }),
  },
  {
    name: "PATCH /users/:id/role",
    expected: exp(200, 403, 403, 403, 401),
    mutates: true,
    send: (t, c, _w, cookie) => call(t, "PATCH", `${USERS}/${c.target}/role`, cookie, { role: "manager" }),
  },
  {
    name: "PATCH /users/:id/status",
    expected: exp(200, 403, 403, 403, 401),
    mutates: true,
    send: (t, c, _w, cookie) => call(t, "PATCH", `${USERS}/${c.target}/status`, cookie, { is_active: false }),
  },
  {
    name: "GET /invitations",
    expected: exp(200, 403, 403, 403, 401),
    send: (t, _c, _w, cookie) => call(t, "GET", INVITATIONS, cookie),
  },
  {
    name: "DELETE /invitations/:id",
    expected: exp(200, 403, 403, 403, 401),
    mutates: true,
    send: (t, c, _w, cookie) => call(t, "DELETE", `${INVITATIONS}/${c.invitationId}`, cookie),
  },
];

describe.skipIf(!hasTestDb)("slice 3 RBAC matrix: every endpoint x 5 identities", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    t.mailer.clear();
  });

  async function makeCtx(): Promise<Ctx> {
    const f = await firmWithAllRoles(t);
    const target = await createMember(t.prisma, { firm_id: f.firmId, role: "employee", name: "Matrix Target" });
    const { id } = await inviteVia(t, f.cookies.owner, "pending.person@example.com", "employee");
    return { f, target: target.id, invitationId: id };
  }

  describe.each(CASES)("$name", (c) => {
    it("exact status for owner / manager / employee / viewer / anonymous, exact envelopes, no change on 401/403", async () => {
      const ctx = await makeCtx();
      const ordered: Identity[] = ["anonymous", "viewer", "employee", "manager", "owner"]; // the allowed owner last
      for (const who of ordered) {
        const before = await snapshot(t);
        const mailsBefore = t.mailer.invitations.length;
        const res = await c.send(t, ctx, who, cookieOfIdentity(ctx.f, who));
        const want = c.expected[who];
        expect(res.statusCode, `${c.name} as ${who}: ${res.body.slice(0, 200)}`).toBe(want);
        if (want === 401) {
          expectEnvelope(res, 401, "UNAUTHENTICATED");
          expect(res.json().message).toBe("Authentication required");
        } else if (want === 403) {
          expectEnvelope(res, 403, "FORBIDDEN");
          expect(res.json().message).toBe(FORBIDDEN_MESSAGE);
        } else {
          const body = res.json();
          expect(body.success).toBe(true);
          expect(typeof body.message).toBe("string");
          expect(Object.keys(body).every((k) => ["success", "message", "data", "meta"].includes(k))).toBe(true);
        }
        if (want === 401 || want === 403) {
          expect(await snapshot(t), `${c.name} as ${who} must not change anything`).toBe(before);
          expect(t.mailer.invitations.length).toBe(mailsBefore);
          expect(res.headers["set-cookie"]).toBeUndefined();
        }
      }
    });

    it("the role comes from the database, not from the token: an owner-claiming token of a viewer gets the viewer's answer", async () => {
      const ctx = await makeCtx();
      const forged = `access_token=${t.app.jwt.sign({ sub: ctx.f.userIds.viewer, firm_id: ctx.f.firmId, role: "owner" })}`;
      const res = await c.send(t, ctx, "viewer", forged);
      expect(res.statusCode).toBe(c.expected.viewer);
    });
  });

  describe("every endpoint answers anonymous 401 with a fresh envelope even for ids that do not exist", () => {
    it.each([
      ["GET", `${USERS}/${NO_ONE}`],
      ["PATCH", `${USERS}/${NO_ONE}`],
      ["PATCH", `${USERS}/${NO_ONE}/role`],
      ["PATCH", `${USERS}/${NO_ONE}/status`],
      ["DELETE", `${INVITATIONS}/${NO_ONE}`],
      ["GET", `${USERS}/not-a-uuid`],
      ["DELETE", `${INVITATIONS}/not-a-uuid`],
    ] as const)("%s %s", async (method, url) => {
      const res = await call(t, method, url, undefined, method === "PATCH" ? { name: "x", role: "viewer", is_active: true } : undefined);
      expectEnvelope(res, 401, "UNAUTHENTICATED");
    });
  });

  describe("public endpoints: the same answer for every identity (the session plays no part)", () => {
    it("GET /auth/invitations/:token returns the same preview for owner, manager, employee, viewer and anonymous", async () => {
      const f = await firmWithAllRoles(t);
      const { token } = await inviteVia(t, f.cookies.owner, "preview.person@example.com", "manager");
      const bodies: string[] = [];
      for (const who of IDENTITIES) {
        const res = await call(t, "GET", PREVIEW(token), cookieOfIdentity(f, who));
        expect(res.statusCode, who).toBe(200);
        expect(res.headers["set-cookie"]).toBeUndefined();
        bodies.push(res.body);
      }
      expect(new Set(bodies).size).toBe(1);
      const unknown = await call(t, "GET", PREVIEW("no-such-token"), f.cookies.owner);
      expectEnvelope(unknown, 404, "NOT_FOUND");
    });

    it("POST /auth/accept-invitation works for every identity as the caller; the previous session keeps working for its own user", async () => {
      const f = await firmWithAllRoles(t);
      for (const who of IDENTITIES) {
        const email = `accept-${who}@example.com`;
        const { token } = await inviteVia(t, f.cookies.owner, email, "viewer");
        const res = await call(t, "POST", ACCEPT, cookieOfIdentity(f, who), { token, name: `Accepted ${who}`, password: "Fresh-pass-77" });
        expect(res.statusCode, who).toBe(201);
        expect(res.json().data).toMatchObject({ email, role: "viewer" });
        expect(res.headers["set-cookie"]).toBeDefined();
        if (who !== "anonymous") {
          // the old identity is unchanged: nothing was merged into the existing session's user
          const me = await call(t, "GET", ME, f.cookies[who]);
          expect(me.json().data).toMatchObject({ id: f.userIds[who], role: who });
        }
      }
    });
  });

  describe("documented existence-then-own-id rule for GET/PATCH /users/:id", () => {
    it.each(["employee", "viewer"] as const)(
      "%s: own id 200, another member 403, unknown / malformed id 404, trailing-slash and extra segments 404 (never 403 for a missing record)",
      async (who) => {
        const f = await firmWithAllRoles(t);
        const own = f.userIds[who];
        const otherId = f.userIds.owner;
        expect((await call(t, "GET", `${USERS}/${own}`, f.cookies[who])).statusCode).toBe(200);
        expect((await call(t, "GET", `${USERS}/${own.toUpperCase()}`, f.cookies[who])).statusCode).toBe(200);
        expect((await call(t, "GET", `${USERS}/${otherId}`, f.cookies[who])).statusCode).toBe(403);
        expect((await call(t, "GET", `${USERS}/${otherId.toUpperCase()}`, f.cookies[who])).statusCode).toBe(403);
        for (const id of [NO_ONE, "not-a-uuid", "1", "%00", "null", "undefined", "a".repeat(36), "../" + own, "00000000-0000-0000-0000-00000000000g"]) {
          const res = await call(t, "GET", `${USERS}/${encodeURIComponent(id)}`, f.cookies[who]);
          expect(res.statusCode, `GET ${id}`).toBe(404);
          const patch = await call(t, "PATCH", `${USERS}/${encodeURIComponent(id)}`, f.cookies[who], { name: "Nope" });
          expect(patch.statusCode, `PATCH ${id}`).toBe(404);
        }
        expect((await call(t, "GET", `${USERS}/${own}/`, f.cookies[who])).statusCode).toBe(404);
        expect((await call(t, "GET", `${USERS}/${own}/extra`, f.cookies[who])).statusCode).toBe(404);
        // a deactivated colleague still "exists": 403, not 404
        const gone = await createMember(t.prisma, { firm_id: f.firmId, role: "employee", is_active: false });
        expect((await call(t, "GET", `${USERS}/${gone.id}`, f.cookies[who])).statusCode).toBe(403);
      },
    );

    it("manager: any member readable, but PATCH only on their own id; unknown id 404", async () => {
      const f = await firmWithAllRoles(t);
      expect((await call(t, "GET", `${USERS}/${f.userIds.viewer}`, f.cookies.manager)).statusCode).toBe(200);
      expect((await call(t, "PATCH", `${USERS}/${f.userIds.viewer}`, f.cookies.manager, { name: "Nope" })).statusCode).toBe(403);
      expect((await call(t, "PATCH", `${USERS}/${f.userIds.manager}`, f.cookies.manager, { name: "Me Again" })).statusCode).toBe(200);
      expect((await call(t, "PATCH", `${USERS}/${NO_ONE}`, f.cookies.manager, { name: "Nope" })).statusCode).toBe(404);
    });

    it("invalid body beats the own-id rule (400 before 403/404), as documented (401, 403, then 400/415, then 404/409)", async () => {
      const f = await firmWithAllRoles(t);
      const other = `${USERS}/${f.userIds.owner}`;
      for (const who of ["manager", "employee", "viewer"] as const) {
        expect((await call(t, "PATCH", other, f.cookies[who], { name: "" })).statusCode, who).toBe(400);
        expect((await call(t, "PATCH", `${USERS}/${NO_ONE}`, f.cookies[who], {})).statusCode, who).toBe(400);
        expect((await call(t, "PATCH", other, f.cookies[who], { name: "ok" })).statusCode, who).toBe(403);
      }
      // owner-only routes: the role check beats a bad body AND a bad id
      for (const who of ["manager", "employee", "viewer"] as const) {
        expect((await call(t, "PATCH", `${USERS}/not-a-uuid/role`, f.cookies[who], { role: "owner" })).statusCode).toBe(403);
        expect((await call(t, "PATCH", `${USERS}/not-a-uuid/status`, f.cookies[who], { is_active: "yes" })).statusCode).toBe(403);
      }
      expect((await call(t, "PATCH", `${USERS}/not-a-uuid/role`, f.cookies.owner, { role: "owner" })).statusCode).toBe(400);
      expect((await call(t, "PATCH", `${USERS}/not-a-uuid/role`, f.cookies.owner, { role: "viewer" })).statusCode).toBe(404);
    });
  });

  describe("other methods and routes never expose or change anything", () => {
    it("DELETE/PUT/POST on /users/:id, PUT/POST/PATCH on /invitations, DELETE /users are 404 for every identity, nothing deleted", async () => {
      const f = await firmWithAllRoles(t);
      const before = await snapshot(t);
      for (const who of IDENTITIES) {
        const cookie = cookieOfIdentity(f, who);
        for (const [m, url] of [
          ["DELETE", `${USERS}/${f.userIds.employee}`],
          ["PUT", `${USERS}/${f.userIds.employee}`],
          ["POST", `${USERS}/${f.userIds.employee}`],
          ["DELETE", USERS],
          ["PUT", USERS],
          ["PATCH", USERS],
          ["POST", USERS],
          ["POST", INVITATIONS],
          ["PUT", INVITATIONS],
          ["PATCH", INVITATIONS],
          ["GET", `${INVITATIONS}/${NO_ONE}`],
          ["PATCH", `${INVITATIONS}/${NO_ONE}`],
          ["GET", `${USERS}/${f.userIds.employee}/role`],
          ["PUT", `${USERS}/${f.userIds.employee}/role`],
          ["GET", `${USERS}/${f.userIds.employee}/status`],
          ["DELETE", `${USERS}/${f.userIds.employee}/status`],
          ["PUT", INVITE],
        ] as const) {
          const res = await call(t, m, url, cookie, m === "GET" || m === "DELETE" ? undefined : {});
          expect(res.statusCode, `${who} ${m} ${url}`).toBe(404);
          expectEnvelope(res, 404, "NOT_FOUND");
        }
      }
      expect(await snapshot(t)).toBe(before);
    });

    it("HEAD and OPTIONS do not bypass the checks", async () => {
      const f = await firmWithAllRoles(t);
      for (const url of [USERS, INVITATIONS]) {
        const anon = await t.app.inject({ method: "HEAD", url });
        expect(anon.statusCode, `anonymous HEAD ${url}`).toBe(401);
        expect(anon.body).toBe("");
        const emp = await t.app.inject({ method: "HEAD", url, headers: { cookie: f.cookies.employee } });
        expect(emp.statusCode).toBe(403);
      }
      const mgr = await t.app.inject({ method: "HEAD", url: USERS, headers: { cookie: f.cookies.manager } });
      expect(mgr.statusCode).toBe(200);
      expect(mgr.body).toBe("");
      const pre = await t.app.inject({
        method: "OPTIONS",
        url: USERS,
        headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
      });
      expect(pre.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      expect(pre.body).not.toContain("owner");
    });

    it("auth-style cookie variants never grant access: cookie name case, duplicate cookies, Bearer header, query token", async () => {
      const f = await firmWithAllRoles(t);
      const jwt = f.cookies.owner.replace("access_token=", "");
      const attempts = [
        { headers: { cookie: `ACCESS_TOKEN=${jwt}` } },
        { headers: { cookie: `access_token_x=${jwt}` } },
        { headers: { cookie: `session=${jwt}` } },
        { headers: { "x-access-token": jwt } },
        { headers: { "x-auth-token": jwt } },
        { headers: { authorization: `Basic ${jwt}` } },
      ];
      for (const a of attempts) {
        const res = await t.app.inject({ method: "GET", url: USERS, ...a });
        expect(res.statusCode, JSON.stringify(a)).toBe(401);
      }
      const q = await t.app.inject({ method: "GET", url: `${USERS}?access_token=${jwt}&token=${jwt}` });
      expect(q.statusCode).toBe(401);
    });
  });

  describe("role and status changes are felt on the very next request with the OLD cookie", () => {
    const ENDPOINTS = (f: FirmFixture, own: string) =>
      [
        ["GET", USERS],
        ["GET", `${USERS}/${own}`],
        ["PATCH", `${USERS}/${own}`, { name: "Same Name" }],
        ["GET", INVITATIONS],
        ["POST", INVITE, { email: "x.y.z@example.com", role: "viewer" }],
        ["PATCH", `${USERS}/${f.userIds.viewer}/role`, { role: "employee" }],
        ["PATCH", `${USERS}/${f.userIds.viewer}/status`, { is_active: true }],
        ["DELETE", `${INVITATIONS}/${NO_ONE}`],
        ["GET", ME],
      ] as const;

    it("deactivation: 401 on EVERY authenticated endpoint at once, public ones unaffected; reactivation restores each", async () => {
      const f = await firmWithAllRoles(t);
      const target = f.userIds.manager;
      const old = f.cookies.manager;
      expect((await call(t, "GET", USERS, old)).statusCode).toBe(200);

      const off = await call(t, "PATCH", `${USERS}/${target}/status`, f.cookies.owner, { is_active: false });
      expect(off.statusCode).toBe(200);
      for (const [m, url, body] of ENDPOINTS(f, target)) {
        const res = await call(t, m, url, old, body);
        expect(res.statusCode, `${m} ${url}`).toBe(401);
        expect(res.json().code).toBe("UNAUTHENTICATED");
      }
      // wrong role AND deactivated: 401 wins over 403 (no hint that the account exists)
      const emp = f.userIds.employee;
      await call(t, "PATCH", `${USERS}/${emp}/status`, f.cookies.owner, { is_active: false });
      expect((await call(t, "POST", INVITE, f.cookies.employee, { email: "n@example.com", role: "viewer" })).statusCode).toBe(401);
      // the public preview is still reachable (it is public)
      const { token } = await inviteVia(t, f.cookies.owner, "still.public@example.com");
      expect((await call(t, "GET", PREVIEW(token), old)).statusCode).toBe(200);

      const on = await call(t, "PATCH", `${USERS}/${target}/status`, f.cookies.owner, { is_active: true });
      expect(on.statusCode).toBe(200);
      expect((await call(t, "GET", USERS, old)).statusCode).toBe(200);
      expect((await call(t, "GET", ME, old)).json().data.role).toBe("manager");
    });

    it("role change: permissions move at once in both directions, and 'manager' never gains owner powers", async () => {
      const f = await firmWithAllRoles(t);
      const emp = f.userIds.employee;
      const old = f.cookies.employee;
      expect((await call(t, "GET", USERS, old)).statusCode).toBe(403);

      await call(t, "PATCH", `${USERS}/${emp}/role`, f.cookies.owner, { role: "manager" });
      expect((await call(t, "GET", USERS, old)).statusCode).toBe(200);
      expect((await call(t, "GET", ME, old)).json().data.role).toBe("manager");
      expect((await call(t, "POST", INVITE, old, { email: "a@example.com", role: "viewer" })).statusCode).toBe(403);
      expect((await call(t, "GET", INVITATIONS, old)).statusCode).toBe(403);
      expect((await call(t, "PATCH", `${USERS}/${f.userIds.viewer}/role`, old, { role: "manager" })).statusCode).toBe(403);
      expect((await call(t, "PATCH", `${USERS}/${f.userIds.owner}/status`, old, { is_active: false })).statusCode).toBe(403);

      await call(t, "PATCH", `${USERS}/${emp}/role`, f.cookies.owner, { role: "viewer" });
      expect((await call(t, "GET", USERS, old)).statusCode).toBe(403);
      expect((await call(t, "GET", `${USERS}/${emp}`, old)).statusCode).toBe(200);
      expect((await call(t, "GET", `${USERS}/${f.userIds.manager}`, old)).statusCode).toBe(403);
      expect((await call(t, "PATCH", `${USERS}/${emp}`, old, { name: "Still Me" })).statusCode).toBe(200);
      expect((await t.prisma.firmMember.findFirstOrThrow({ where: { user_id: emp } })).role).toBe("viewer");
    });

    it("a deactivated user cannot log in (same 401 as a wrong password), a reactivated one can; last_login_at moves on login only", async () => {
      const f = await firmWithAllRoles(t);
      const emp = await createMember(t.prisma, { firm_id: f.firmId, role: "employee", email: "login.check@example.com" });
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: emp.id } })).last_login_at).toBeNull();

      await call(t, "PATCH", `${USERS}/${emp.id}/status`, f.cookies.owner, { is_active: false });
      const denied = await call(t, "POST", LOGIN, undefined, { email: emp.email, password: emp.password });
      const wrong = await call(t, "POST", LOGIN, undefined, { email: emp.email, password: "Wrong-pass-9" });
      expect(denied.statusCode).toBe(401);
      expect(denied.body).toBe(wrong.body);
      expect(denied.headers["set-cookie"]).toBeUndefined();
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: emp.id } })).last_login_at).toBeNull();

      await call(t, "PATCH", `${USERS}/${emp.id}/status`, f.cookies.owner, { is_active: true });
      const before = Date.now();
      const ok = await loginCookie(t, emp.email, emp.password);
      expect(ok).toContain("access_token=");
      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: emp.id } });
      expect(row.last_login_at).not.toBeNull();
      expect(Math.abs(row.last_login_at!.getTime() - before)).toBeLessThan(15_000);
      const listed = (await call(t, "GET", `${USERS}/${emp.id}`, f.cookies.owner)).json().data;
      expect(listed.last_login_at).toBe(row.last_login_at!.toISOString());
    });

    it("the cookie of a user whose role claim says owner but whose DB membership was downgraded cannot do owner things", async () => {
      const f = await firmWithAllRoles(t);
      const forged = cookieFor(t, f.userIds.manager, f.firmId, "owner");
      expect((await call(t, "POST", INVITE, forged, { email: "forged@example.com", role: "viewer" })).statusCode).toBe(403);
      expect((await call(t, "PATCH", `${USERS}/${f.userIds.viewer}/role`, forged, { role: "manager" })).statusCode).toBe(403);
      expect(await t.prisma.invitation.count()).toBe(0);
    });
  });

  describe("the owner is protected", () => {
    it("owner cannot be demoted, deactivated or role-changed by anyone, nor change their own role/status; unchanged afterwards", async () => {
      const f = await firmWithAllRoles(t);
      const ownerUrl = `${USERS}/${f.userIds.owner}`;
      for (const who of IDENTITIES) {
        for (const [sub, body] of [
          ["/role", { role: "viewer" }],
          ["/role", { role: "manager" }],
          ["/role", { role: "owner" }],
          ["/status", { is_active: false }],
          ["/status", { is_active: true }],
        ] as const) {
          const res = await call(t, "PATCH", `${ownerUrl}${sub}`, cookieOfIdentity(f, who), body);
          const expected = who === "anonymous" ? 401 : who === "owner" ? (body && "role" in body && body.role === "owner" ? 400 : 403) : 403;
          expect(res.statusCode, `${who} ${sub} ${JSON.stringify(body)}`).toBe(expected);
        }
      }
      const row = await t.prisma.firmMember.findFirstOrThrow({ where: { user_id: f.userIds.owner } });
      expect([row.role, row.is_active]).toEqual(["owner", true]);
      expect((await call(t, "GET", ME, f.cookies.owner)).json().data.role).toBe("owner");
    });

    it("'owner' can never be assigned or invited: every spelling and type is 400, and nothing is stored", async () => {
      const f = await firmWithAllRoles(t);
      const bad = ["owner", "Owner", "OWNER", " owner", "owner ", "owner\u0000", "ow​ner", "ownеr", "admin", "superuser", "", null, 1, true, ["owner"], { role: "owner" }, ["manager"]];
      const before = await snapshot(t);
      for (const role of bad) {
        const inv = await call(t, "POST", INVITE, f.cookies.owner, { email: "boss@example.com", role });
        expect(inv.statusCode, `invite ${JSON.stringify(role)}`).toBe(400);
        const ch = await call(t, "PATCH", `${USERS}/${f.userIds.employee}/role`, f.cookies.owner, { role });
        expect(ch.statusCode, `role ${JSON.stringify(role)}`).toBe(400);
      }
      expect(await snapshot(t)).toBe(before);
    });

    it("an employee promoted to manager still cannot make anyone owner or touch the owner (all 403), concurrently or not", async () => {
      const f = await firmWithAllRoles(t);
      await call(t, "PATCH", `${USERS}/${f.userIds.employee}/role`, f.cookies.owner, { role: "manager" });
      const results = await Promise.all(
        ["owner", "manager", "viewer"].flatMap((role) => [
          call(t, "PATCH", `${USERS}/${f.userIds.owner}/role`, f.cookies.employee, { role }),
          call(t, "PATCH", `${USERS}/${f.userIds.viewer}/role`, f.cookies.employee, { role }),
        ]),
      );
      expect(results.every((r) => r.statusCode === 403)).toBe(true);
      expect(await t.prisma.firmMember.count({ where: { role: "owner" } })).toBe(1);
    });

    it("concurrent role flips and deactivations from the owner always end in a valid state and every response is 200", async () => {
      const f = await firmWithAllRoles(t);
      const emp = f.userIds.employee;
      const calls: Promise<{ statusCode: number }>[] = [];
      for (let i = 0; i < 6; i++) {
        calls.push(call(t, "PATCH", `${USERS}/${emp}/role`, f.cookies.owner, { role: i % 2 ? "manager" : "viewer" }));
        calls.push(call(t, "PATCH", `${USERS}/${emp}/status`, f.cookies.owner, { is_active: i % 2 === 0 }));
      }
      for (const r of await Promise.all(calls)) expect(r.statusCode).toBe(200);
      const row = await t.prisma.firmMember.findFirstOrThrow({ where: { user_id: emp } });
      expect(["manager", "viewer"]).toContain(row.role);
      expect(typeof row.is_active).toBe("boolean");
      expect(await t.prisma.firmMember.count({ where: { role: "owner" } })).toBe(1);
    });
  });

  it("raw malformed bodies on the owner routes never become a 5xx for any identity", async () => {
    const f = await firmWithAllRoles(t);
    for (const who of IDENTITIES) {
      for (const body of ["{", "[]", "null", '"x"', "1", "true", "{}", '{"role":', "\u0000", "{\"role\":\"viewer\"}\u0000"]) {
        for (const url of [`${USERS}/${f.userIds.employee}/role`, `${USERS}/${f.userIds.employee}/status`, `${USERS}/${f.userIds.employee}`]) {
          const res = await rawCall(t, "PATCH", url, cookieOfIdentity(f, who), body);
          expect(res.statusCode, `${who} ${url} ${JSON.stringify(body)}`).toBeLessThan(500);
        }
      }
    }
  });
});
