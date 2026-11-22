import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UserRole } from "../src/generated/prisma/client.js";
import {
  createMember,
  hasTestDb,
  loginCookie,
  makeTestApp,
  registerOwner,
  resetDb,
  type TestApp,
} from "./db-helpers.js";
import { call, cookieFor, firmWithAllRoles, ROLES, type FirmFixture } from "./support/firms.js";

const USERS = "/api/v1/users";
const ME = "/api/v1/auth/me";
const USER_KEYS = ["created_at", "email", "id", "is_active", "last_login_at", "name", "role"];
const NO_ONE = "00000000-0000-4000-8000-000000000000";

/** P1 slice 3: GET /users, GET/PATCH /users/:id, PATCH /users/:id/role, PATCH /users/:id/status. */
describe.skipIf(!hasTestDb)("users: roles, isolation, rules", () => {
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

  const raw = (method: "PATCH" | "POST", url: string, body: string, cookie?: string) =>
    t.app.inject({
      method,
      url,
      headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
      payload: body,
    });

  describe("per-role matrix", () => {
    it("GET /users: anonymous 401, owner/manager 200, employee/viewer 403", async () => {
      const f = await firmWithAllRoles(t);
      expect((await call(t, "GET", USERS)).statusCode).toBe(401);
      for (const role of ROLES) {
        const res = await call(t, "GET", USERS, f.cookies[role]);
        expect(res.statusCode, role).toBe(role === "owner" || role === "manager" ? 200 : 403);
        if (res.statusCode === 403) {
          expect(res.json()).toMatchObject({ success: false, code: "FORBIDDEN" });
        }
      }
    });

    it("GET /users/:id: owner/manager any member, employee/viewer only themselves (else 403), anonymous 401", async () => {
      const f = await firmWithAllRoles(t);
      expect((await call(t, "GET", `${USERS}/${f.userIds.viewer}`)).statusCode).toBe(401);
      for (const role of ROLES) {
        for (const target of ROLES) {
          const res = await call(t, "GET", `${USERS}/${f.userIds[target]}`, f.cookies[role]);
          const allowed = role === "owner" || role === "manager" || role === target;
          expect(res.statusCode, `${role} -> ${target}`).toBe(allowed ? 200 : 403);
          if (allowed) {
            expect(Object.keys(res.json().data).sort()).toEqual(USER_KEYS);
            expect(res.json().data).toMatchObject({ id: f.userIds[target], role: target });
          }
        }
      }
    });

    it("PATCH /users/:id: owner any member, others only themselves, anonymous 401", async () => {
      const f = await firmWithAllRoles(t);
      expect(
        (await call(t, "PATCH", `${USERS}/${f.userIds.viewer}`, undefined, { name: "X" })).statusCode,
      ).toBe(401);
      for (const role of ROLES) {
        for (const target of ROLES) {
          const res = await call(t, "PATCH", `${USERS}/${f.userIds[target]}`, f.cookies[role], {
            name: `Renamed ${role} to ${target}`,
          });
          const allowed = role === "owner" || role === target;
          expect(res.statusCode, `${role} -> ${target}`).toBe(allowed ? 200 : 403);
          if (allowed) expect(res.json().data.name).toBe(`Renamed ${role} to ${target}`);
        }
      }
    });

    it.each(["role", "status"] as const)(
      "PATCH /users/:id/%s: only the owner (anonymous 401, others 403)",
      async (kind) => {
        const f = await firmWithAllRoles(t);
        const body = kind === "role" ? { role: "viewer" } : { is_active: false };
        const url = `${USERS}/${f.userIds.employee}/${kind}`;
        expect((await call(t, "PATCH", url, undefined, body)).statusCode).toBe(401);
        for (const role of ["manager", "employee", "viewer"] as const) {
          const res = await call(t, "PATCH", url, f.cookies[role], body);
          expect(res.statusCode, role).toBe(403);
          expect(res.json().code).toBe("FORBIDDEN");
        }
        const row = await t.prisma.firmMember.findFirstOrThrow({
          where: { user_id: f.userIds.employee },
        });
        expect([row.role, row.is_active]).toEqual(["employee", true]);
        expect((await call(t, "PATCH", url, f.cookies.owner, body)).statusCode).toBe(200);
      },
    );

    it("order is 401, then 403, then 400/415 (malformed JSON, urlencoded bodies)", async () => {
      const f = await firmWithAllRoles(t);
      const target = f.userIds.employee;
      for (const [url, ownerOnly] of [
        [`${USERS}/${target}`, false],
        [`${USERS}/${target}/role`, true],
        [`${USERS}/${target}/status`, true],
        [`${USERS}/invite`, true],
      ] as const) {
        const method = url.endsWith("/invite") ? "POST" : "PATCH";
        const anon = await raw(method, url, "{bad json");
        expect(anon.statusCode, `anon ${url}`).toBe(401);
        const urlencoded = await t.app.inject({
          method,
          url,
          headers: { "content-type": "application/x-www-form-urlencoded" },
          payload: "a=b",
        });
        expect(urlencoded.statusCode, `anon urlencoded ${url}`).toBe(401);
        const viewer = await raw(method, url, "{bad json", f.cookies.viewer);
        // Owner-only routes and the invite route are 403 for a viewer; PATCH /users/:id lets a viewer reach the
        // body (own-id rule), so the malformed body is the 400 there.
        expect(viewer.statusCode, `viewer ${url}`).toBe(ownerOnly ? 403 : 400);
        const manager = await raw(method, url, "{bad json", f.cookies.manager);
        expect(manager.statusCode, `manager ${url}`).toBe(ownerOnly ? 403 : 400);
        const owner = await raw(method, url, "{bad json", f.cookies.owner);
        expect(owner.statusCode, `owner ${url}`).toBe(400);
      }
    });

    it("an invalid body is 401 anonymous, 403 for a non-owner on owner-only routes, 400 for the owner", async () => {
      const f = await firmWithAllRoles(t);
      const url = `${USERS}/${f.userIds.employee}/role`;
      expect((await call(t, "PATCH", url, undefined, { role: "owner" })).statusCode).toBe(401);
      expect((await call(t, "PATCH", url, f.cookies.manager, { role: "owner" })).statusCode).toBe(403);
      expect((await call(t, "PATCH", url, f.cookies.owner, { role: "owner" })).statusCode).toBe(400);
    });

    it("a malformed or unknown user id is 404 (never 400/500)", async () => {
      const f = await firmWithAllRoles(t);
      for (const id of ["not-a-uuid", NO_ONE, "1", "%00", "' OR 1=1 --"]) {
        for (const [method, suffix, body] of [
          ["GET", "", undefined],
          ["PATCH", "", { name: "X" }],
          ["PATCH", "/role", { role: "viewer" }],
          ["PATCH", "/status", { is_active: false }],
        ] as const) {
          const res = await call(t, method, `${USERS}/${encodeURIComponent(id)}${suffix}`, f.cookies.owner, body);
          expect(res.statusCode, `${method} ${id}${suffix}`).toBe(404);
        }
      }
    });
  });

  describe("tenant isolation (two firms)", () => {
    let a: FirmFixture;
    let b: FirmFixture;
    beforeEach(async () => {
      a = await firmWithAllRoles(t, "Firm A");
      b = await firmWithAllRoles(t, "Firm B");
    });

    const snapshotOfB = async () =>
      JSON.stringify([
        await t.prisma.user.findMany({ where: { id: { in: Object.values(b.userIds) } }, orderBy: { id: "asc" } }),
        await t.prisma.firmMember.findMany({ where: { firm_id: b.firmId }, orderBy: { id: "asc" } }),
      ]);

    it("lists contain only the caller's firm and the count is exact", async () => {
      for (const role of ["owner", "manager"] as const) {
        const res = await call(t, "GET", USERS, a.cookies[role]);
        expect(res.statusCode).toBe(200);
        const ids = res.json().data.map((u: { id: string }) => u.id).sort();
        expect(ids).toEqual(Object.values(a.userIds).sort());
        expect(res.json().meta).toEqual({ page: 1, limit: 20, total: 4 });
        const bEmails = await t.prisma.user.findMany({ where: { id: { in: Object.values(b.userIds) } } });
        const text = JSON.stringify(res.json());
        for (const u of bEmails) expect(text).not.toContain(u.email);
      }
    });

    it("search, role and status filters never reach into the other firm", async () => {
      const bUser = await t.prisma.user.findUniqueOrThrow({ where: { id: b.userIds.manager } });
      const bySearch = await call(t, "GET", `${USERS}?search=${encodeURIComponent(bUser.email)}`, a.cookies.owner);
      expect(bySearch.json()).toMatchObject({ data: [], meta: { total: 0 } });
      const byRole = await call(t, "GET", `${USERS}?role=owner`, a.cookies.manager);
      expect(byRole.json().meta.total).toBe(1);
      expect(byRole.json().data[0].id).toBe(a.userIds.owner);
      await t.prisma.firmMember.updateMany({ where: { firm_id: b.firmId }, data: { is_active: false } });
      const inactive = await call(t, "GET", `${USERS}?status=inactive`, a.cookies.owner);
      expect(inactive.json().meta.total).toBe(0);
    });

    it("another firm's user id is 404 for every role on every endpoint, and nothing changes", async () => {
      const before = await snapshotOfB();
      for (const role of ROLES) {
        const target = b.userIds[role === "owner" ? "employee" : role];
        const cookie = a.cookies[role];
        const get = await call(t, "GET", `${USERS}/${target}`, cookie);
        expect(get.statusCode, `GET as ${role}`).toBe(404);
        const patch = await call(t, "PATCH", `${USERS}/${target}`, cookie, { name: "Hacked" });
        expect(patch.statusCode, `PATCH as ${role}`).toBe(404);
        // Owner-only endpoints: the owner gets 404, everyone else 403 (role check comes first).
        for (const [suffix, body] of [
          ["/role", { role: "viewer" }],
          ["/status", { is_active: false }],
        ] as const) {
          const res = await call(t, "PATCH", `${USERS}/${target}${suffix}`, cookie, body);
          expect(res.statusCode, `PATCH ${suffix} as ${role}`).toBe(role === "owner" ? 404 : 403);
        }
        for (const res of [get, patch]) {
          expect(res.json().code).toBe("NOT_FOUND");
          expect(JSON.stringify(res.json())).not.toContain(target);
        }
      }
      // B's owner as the target of A's owner.
      expect((await call(t, "PATCH", `${USERS}/${b.userIds.owner}/role`, a.cookies.owner, { role: "viewer" })).statusCode).toBe(404);
      expect((await call(t, "PATCH", `${USERS}/${b.userIds.owner}/status`, a.cookies.owner, { is_active: false })).statusCode).toBe(404);
      expect(await snapshotOfB()).toBe(before);
    });

    it("B's users still work for B after A's attempts, and A's tokens are never valid for B's ids", async () => {
      await call(t, "PATCH", `${USERS}/${b.userIds.viewer}/status`, a.cookies.owner, { is_active: false });
      expect((await call(t, "GET", ME, b.cookies.viewer)).statusCode).toBe(200);
      expect((await call(t, "GET", `${USERS}/${b.userIds.viewer}`, b.cookies.viewer)).statusCode).toBe(200);
    });

    it("a forged token naming firm B with A's user id is 401 on every users endpoint", async () => {
      const forged = cookieFor(t, a.userIds.owner, b.firmId, "owner");
      for (const [method, url, body] of [
        ["GET", USERS, undefined],
        ["GET", `${USERS}/${b.userIds.employee}`, undefined],
        ["PATCH", `${USERS}/${b.userIds.employee}/role`, { role: "viewer" }],
      ] as const) {
        expect((await call(t, method, url, forged, body)).statusCode).toBe(401);
      }
    });

    it("the same-named users in two firms stay separate", async () => {
      const renamed = await call(t, "PATCH", `${USERS}/${a.userIds.employee}`, a.cookies.owner, { name: "Same Name" });
      expect(renamed.statusCode).toBe(200);
      const other = await call(t, "GET", `${USERS}/${b.userIds.employee}`, b.cookies.owner);
      expect(other.json().data.name).not.toBe("Same Name");
    });
  });

  describe("GET /users: search, filters, pagination", () => {
    let f: FirmFixture;
    beforeEach(async () => {
      f = await firmWithAllRoles(t, "List Firm");
      await t.prisma.user.updateMany({ where: { id: f.userIds.owner }, data: { name: "Zed Owner" } });
      await t.prisma.user.update({ where: { id: f.userIds.manager }, data: { name: "Alice Manager", email: "alice@example.com" } });
      await t.prisma.user.update({ where: { id: f.userIds.employee }, data: { name: "Bob 100% Employee", email: "bob_e@example.com" } });
      await t.prisma.user.update({ where: { id: f.userIds.viewer }, data: { name: "Carol Viewer", email: "carol@example.com" } });
    });
    const list = (qs = "", who: UserRole = "owner") => call(t, "GET", `${USERS}${qs}`, f.cookies[who]);

    it("sorts by name ascending and returns the FirmUser shape without any password data", async () => {
      const res = await list();
      expect(res.json().data.map((u: { name: string }) => u.name)).toEqual([
        "Alice Manager",
        "Bob 100% Employee",
        "Carol Viewer",
        "Zed Owner",
      ]);
      for (const u of res.json().data) expect(Object.keys(u).sort()).toEqual(USER_KEYS);
      expect(JSON.stringify(res.json())).not.toMatch(/password|hash|argon/i);
    });

    it("same name ties are ordered by created_at", async () => {
      await t.prisma.user.updateMany({
        where: { id: { in: [f.userIds.manager, f.userIds.viewer] } },
        data: { name: "Twin" },
      });
      await t.prisma.user.update({ where: { id: f.userIds.viewer }, data: { created_at: new Date("2020-01-01T00:00:00Z") } });
      const res = await list("?search=twin");
      expect(res.json().data.map((u: { id: string }) => u.id)).toEqual([f.userIds.viewer, f.userIds.manager]);
    });

    it("search matches name or email, case-insensitively", async () => {
      expect((await list("?search=ALICE")).json().data.map((u: { id: string }) => u.id)).toEqual([f.userIds.manager]);
      expect((await list("?search=CAROL@EXAMPLE")).json().data.map((u: { id: string }) => u.id)).toEqual([f.userIds.viewer]);
      expect((await list("?search=nobody-matches")).json()).toMatchObject({ data: [], meta: { total: 0 } });
      expect((await list("?search=%20alice%20")).json().meta.total).toBe(1);
    });

    it("LIKE wildcards in search are literal", async () => {
      const pct = await list("?search=%25");
      expect(pct.json().data.map((u: { id: string }) => u.id)).toEqual([f.userIds.employee]);
      expect(pct.json().meta.total).toBe(1);
      const under = await list("?search=_");
      expect(under.json().data.map((u: { id: string }) => u.id)).toEqual([f.userIds.employee]);
      expect((await list("?search=a%25e")).json().meta.total).toBe(0);
      expect((await list("?search=a_ice")).json().meta.total).toBe(0);
      expect((await list("?search=%5C")).json().meta.total).toBe(0);
      await t.prisma.user.update({ where: { id: f.userIds.viewer }, data: { name: "Back\\slash" } });
      expect((await list("?search=%5C")).json().data.map((u: { id: string }) => u.id)).toEqual([f.userIds.viewer]);
      expect((await list("?search=k%5Cs")).json().meta.total).toBe(1);
    });

    it("filters by role and status, and combines them", async () => {
      expect((await list("?role=viewer")).json().data.map((u: { id: string }) => u.id)).toEqual([f.userIds.viewer]);
      await t.prisma.firmMember.updateMany({
        where: { user_id: { in: [f.userIds.viewer, f.userIds.employee] } },
        data: { is_active: false },
      });
      expect((await list("?status=active")).json().meta.total).toBe(2);
      expect((await list("?status=inactive")).json().meta.total).toBe(2);
      expect((await list("?status=inactive&role=viewer")).json().meta.total).toBe(1);
      expect((await list("?status=active&role=viewer")).json().meta.total).toBe(0);
      const inactive = await list("?status=inactive");
      for (const u of inactive.json().data) expect(u.is_active).toBe(false);
    });

    it("paginates with an exact meta.total", async () => {
      const p1 = await list("?limit=3&page=1");
      expect(p1.json().data).toHaveLength(3);
      expect(p1.json().meta).toEqual({ page: 1, limit: 3, total: 4 });
      const p2 = await list("?limit=3&page=2");
      expect(p2.json().data).toHaveLength(1);
      expect(p2.json().meta).toEqual({ page: 2, limit: 3, total: 4 });
      expect((await list("?limit=3&page=3")).json()).toMatchObject({ data: [], meta: { total: 4 } });
      const all = [...p1.json().data, ...p2.json().data].map((u: { id: string }) => u.id);
      expect(new Set(all).size).toBe(4);
    });

    it("validates page, limit, role, status and control characters in search", async () => {
      for (const qs of [
        "?page=0",
        "?page=-1",
        "?page=x",
        "?limit=0",
        "?limit=101",
        "?limit=1.5",
        "?role=owner%20",
        "?role=admin",
        "?status=banned",
        "?search=a%00b",
        "?search=a%0Ab",
        `?search=${"x".repeat(101)}`,
      ]) {
        const res = await list(qs);
        expect(res.statusCode, qs).toBe(400);
        expect(res.json().code).toBe("VALIDATION_ERROR");
      }
      expect((await list("?limit=100")).statusCode).toBe(200);
      expect((await list("?limit=20&page=1&search=")).statusCode).toBe(200);
    });

    it("manager sees the same list as the owner", async () => {
      expect((await list("", "manager")).json()).toEqual((await list("", "owner")).json());
    });

    it("last_login_at is null until the first login", async () => {
      const me = await t.prisma.user.findUniqueOrThrow({ where: { id: f.userIds.manager } });
      expect(me.last_login_at).toBeNull();
      const before = (await call(t, "GET", `${USERS}/${f.userIds.manager}`, f.cookies.owner)).json().data;
      expect(before.last_login_at).toBeNull();
      await loginCookie(t, "alice@example.com");
      const after = (await call(t, "GET", `${USERS}/${f.userIds.manager}`, f.cookies.owner)).json().data;
      expect(Date.now() - new Date(after.last_login_at).getTime()).toBeLessThan(60_000);
    });

    it("last_login_at changes on login only, not on reads or edits", async () => {
      await loginCookie(t, "alice@example.com");
      const first = (await call(t, "GET", `${USERS}/${f.userIds.manager}`, f.cookies.owner)).json().data.last_login_at;
      await call(t, "GET", ME, f.cookies.manager);
      await call(t, "PATCH", `${USERS}/${f.userIds.manager}`, f.cookies.manager, { name: "Alice Two" });
      await call(t, "PATCH", `${USERS}/${f.userIds.manager}/role`, f.cookies.owner, { role: "employee" });
      const second = (await call(t, "GET", `${USERS}/${f.userIds.manager}`, f.cookies.owner)).json().data.last_login_at;
      expect(second).toBe(first);
    });
  });

  describe("PATCH /users/:id (name)", () => {
    it("trims, validates and ignores everything but name (mass assignment)", async () => {
      const f = await firmWithAllRoles(t);
      const id = f.userIds.employee;
      const res = await call(t, "PATCH", `${USERS}/${id}`, f.cookies.owner, {
        name: "  New Name  ",
        role: "owner",
        is_active: false,
        email: "evil@example.com",
        firm_id: NO_ONE,
        id: NO_ONE,
        password_hash: "x",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ id, name: "New Name", role: "employee", is_active: true });
      const user = await t.prisma.user.findUniqueOrThrow({ where: { id } });
      expect(user.email).not.toBe("evil@example.com");
      expect(user.password_hash).not.toBe("x");
      const member = await t.prisma.firmMember.findFirstOrThrow({ where: { user_id: id } });
      expect([member.role, member.is_active, member.firm_id]).toEqual(["employee", true, f.firmId]);

      // Self-edit by a non-owner also cannot smuggle a role.
      const self = await call(t, "PATCH", `${USERS}/${id}`, f.cookies.employee, { name: "Me", role: "owner" });
      expect(self.statusCode).toBe(200);
      expect(self.json().data.role).toBe("employee");
    });

    it.each([
      ["empty", ""],
      ["spaces", "   "],
      ["too long", "x".repeat(121)],
      ["NUL", "a\u0000b"],
      ["newline", "a\nb"],
      ["number", 5],
      ["null", null],
      ["array", ["a"]],
    ])("rejects a name that is %s", async (_label, name) => {
      const f = await firmWithAllRoles(t);
      const res = await call(t, "PATCH", `${USERS}/${f.userIds.viewer}`, f.cookies.owner, { name });
      expect(res.statusCode).toBe(400);
      expect(res.json().errors.map((e: { field?: string }) => e.field)).toContain("name");
    });

    it("rejects an empty body and non-object bodies, accepts 120 characters", async () => {
      const f = await firmWithAllRoles(t);
      const url = `${USERS}/${f.userIds.viewer}`;
      expect((await call(t, "PATCH", url, f.cookies.owner, {})).statusCode).toBe(400);
      expect((await call(t, "PATCH", url, f.cookies.owner, [])).statusCode).toBe(400);
      expect((await call(t, "PATCH", url, f.cookies.owner, { name: "x".repeat(120) })).statusCode).toBe(200);
    });

    it("the new name shows up in /auth/me", async () => {
      const f = await firmWithAllRoles(t);
      await call(t, "PATCH", `${USERS}/${f.userIds.manager}`, f.cookies.manager, { name: "Fresh Name" });
      expect((await call(t, "GET", ME, f.cookies.manager)).json().data.name).toBe("Fresh Name");
    });
  });

  describe("role changes", () => {
    it("owner changes manager, employee and viewer among themselves; effect is immediate with the old cookie", async () => {
      const f = await firmWithAllRoles(t);
      // manager can list users now; demote to viewer: the very next request with the same cookie is 403.
      expect((await call(t, "GET", USERS, f.cookies.manager)).statusCode).toBe(200);
      const res = await call(t, "PATCH", `${USERS}/${f.userIds.manager}/role`, f.cookies.owner, { role: "viewer" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ id: f.userIds.manager, role: "viewer" });
      expect((await call(t, "GET", USERS, f.cookies.manager)).statusCode).toBe(403);
      expect((await call(t, "GET", ME, f.cookies.manager)).json().data.role).toBe("viewer");
      // and back up
      await call(t, "PATCH", `${USERS}/${f.userIds.manager}/role`, f.cookies.owner, { role: "manager" });
      expect((await call(t, "GET", USERS, f.cookies.manager)).statusCode).toBe(200);
      // employee gains manager rights immediately
      expect((await call(t, "GET", USERS, f.cookies.employee)).statusCode).toBe(403);
      await call(t, "PATCH", `${USERS}/${f.userIds.employee}/role`, f.cookies.owner, { role: "manager" });
      expect((await call(t, "GET", USERS, f.cookies.employee)).statusCode).toBe(200);
    });

    it("the same role again is a harmless 200", async () => {
      const f = await firmWithAllRoles(t);
      const res = await call(t, "PATCH", `${USERS}/${f.userIds.viewer}/role`, f.cookies.owner, { role: "viewer" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.role).toBe("viewer");
    });

    it("ownership can never be assigned: role owner, junk and missing roles are 400", async () => {
      const f = await firmWithAllRoles(t);
      const url = `${USERS}/${f.userIds.manager}/role`;
      for (const body of [{ role: "owner" }, { role: "OWNER" }, { role: "admin" }, { role: "" }, { role: null }, { role: ["owner"] }, {}, []]) {
        expect((await call(t, "PATCH", url, f.cookies.owner, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
      const row = await t.prisma.firmMember.findFirstOrThrow({ where: { user_id: f.userIds.manager } });
      expect(row.role).toBe("manager");
      expect(await t.prisma.firmMember.count({ where: { firm_id: f.firmId, role: "owner" } })).toBe(1);
    });

    it("smuggled fields are ignored (is_active, firm_id, name)", async () => {
      const f = await firmWithAllRoles(t);
      const before = await t.prisma.user.findUniqueOrThrow({ where: { id: f.userIds.viewer } });
      const res = await call(t, "PATCH", `${USERS}/${f.userIds.viewer}/role`, f.cookies.owner, {
        role: "employee",
        is_active: false,
        firm_id: NO_ONE,
        name: "Hacked",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ role: "employee", is_active: true, name: before.name });
    });

    it("the owner cannot be demoted and cannot change their own role (403, unchanged)", async () => {
      const f = await firmWithAllRoles(t);
      const res = await call(t, "PATCH", `${USERS}/${f.userIds.owner}/role`, f.cookies.owner, { role: "manager" });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
      expect((await call(t, "GET", ME, f.cookies.owner)).json().data.role).toBe("owner");
    });

    it("a manager cannot grant any role, including owner (403 before anything else)", async () => {
      const f = await firmWithAllRoles(t);
      for (const target of ["employee", "viewer", "manager", "owner"] as const) {
        for (const role of ["owner", "manager"]) {
          const res = await call(t, "PATCH", `${USERS}/${f.userIds[target]}/role`, f.cookies.manager, { role });
          expect(res.statusCode, `${target} <- ${role}`).toBe(403);
        }
      }
      expect(await t.prisma.firmMember.count({ where: { firm_id: f.firmId, role: "owner" } })).toBe(1);
    });
  });

  describe("status changes", () => {
    it("deactivation stops the old cookie at once and blocks login; reactivation restores both", async () => {
      const f = await firmWithAllRoles(t);
      const m = await createMember(t.prisma, { firm_id: f.firmId, role: "employee", email: "staff@example.com" });
      const cookie = await loginCookie(t, m.email);
      expect((await call(t, "GET", ME, cookie)).statusCode).toBe(200);

      const off = await call(t, "PATCH", `${USERS}/${m.id}/status`, f.cookies.owner, { is_active: false });
      expect(off.statusCode).toBe(200);
      expect(off.json().data).toMatchObject({ id: m.id, is_active: false, role: "employee" });
      expect((await call(t, "GET", ME, cookie)).statusCode).toBe(401);
      expect((await call(t, "GET", `${USERS}/${m.id}`, cookie)).statusCode).toBe(401);
      const login = await call(t, "POST", "/api/v1/auth/login", undefined, { email: m.email, password: m.password });
      expect(login.statusCode).toBe(401);
      expect(login.json().message).toBe("Invalid email or password");
      expect((await call(t, "GET", `${USERS}?status=inactive`, f.cookies.owner)).json().meta.total).toBe(1);

      const on = await call(t, "PATCH", `${USERS}/${m.id}/status`, f.cookies.owner, { is_active: true });
      expect(on.json().data.is_active).toBe(true);
      expect((await call(t, "GET", ME, cookie)).statusCode).toBe(200);
      expect((await call(t, "POST", "/api/v1/auth/login", undefined, { email: m.email, password: m.password })).statusCode).toBe(200);
    });

    it("the owner can never be deactivated, and nobody can change their own status (403, unchanged)", async () => {
      const f = await firmWithAllRoles(t);
      for (const body of [{ is_active: false }, { is_active: true }]) {
        const res = await call(t, "PATCH", `${USERS}/${f.userIds.owner}/status`, f.cookies.owner, body);
        expect(res.statusCode).toBe(403);
      }
      expect((await call(t, "GET", ME, f.cookies.owner)).statusCode).toBe(200);
      for (const role of ["manager", "employee", "viewer"] as const) {
        const res = await call(t, "PATCH", `${USERS}/${f.userIds[role]}/status`, f.cookies[role], { is_active: false });
        expect(res.statusCode, role).toBe(403);
        expect((await call(t, "GET", ME, f.cookies[role])).statusCode).toBe(200);
      }
    });

    it("validates is_active strictly", async () => {
      const f = await firmWithAllRoles(t);
      const url = `${USERS}/${f.userIds.viewer}/status`;
      for (const body of [{}, { is_active: "false" }, { is_active: 0 }, { is_active: null }, { is_active: [false] }, []]) {
        expect((await call(t, "PATCH", url, f.cookies.owner, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
      expect((await t.prisma.firmMember.findFirstOrThrow({ where: { user_id: f.userIds.viewer } })).is_active).toBe(true);
    });

    it("smuggled role in a status body is ignored", async () => {
      const f = await firmWithAllRoles(t);
      const res = await call(t, "PATCH", `${USERS}/${f.userIds.viewer}/status`, f.cookies.owner, { is_active: false, role: "owner" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ role: "viewer", is_active: false });
    });

    it("deactivating twice is idempotent; a deactivated user stays listed", async () => {
      const f = await firmWithAllRoles(t);
      const url = `${USERS}/${f.userIds.viewer}/status`;
      expect((await call(t, "PATCH", url, f.cookies.owner, { is_active: false })).statusCode).toBe(200);
      expect((await call(t, "PATCH", url, f.cookies.owner, { is_active: false })).statusCode).toBe(200);
      expect((await call(t, "GET", USERS, f.cookies.owner)).json().meta.total).toBe(4);
    });

    it("a deactivated user can still be read by the owner (GET /users/:id)", async () => {
      const f = await firmWithAllRoles(t);
      await call(t, "PATCH", `${USERS}/${f.userIds.viewer}/status`, f.cookies.owner, { is_active: false });
      const res = await call(t, "GET", `${USERS}/${f.userIds.viewer}`, f.cookies.owner);
      expect(res.json().data.is_active).toBe(false);
    });
  });

  it("two owners of two firms with the same display name stay separate in lists (registerOwner twice)", async () => {
    const a = await registerOwner(t, { name: "Same Person", firm_name: "A" });
    const b = await registerOwner(t, { name: "Same Person", firm_name: "B" });
    for (const o of [a, b]) {
      const res = await call(t, "GET", USERS, o.cookie);
      expect(res.json().data).toHaveLength(1);
      expect(res.json().data[0].id).toBe(o.user.id);
    }
  });
});
