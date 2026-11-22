import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, redactUrl } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import type { UserRole } from "../src/generated/prisma/client.js";
import { createLogMailer } from "../src/plugins/mailer.js";
import {
  cookieOf,
  createMember,
  DEFAULT_PASSWORD,
  hasTestDb,
  makeTestApp,
  registerOwner,
  resetDb,
  TEST_FRONTEND_URL,
  TEST_JWT_SECRET,
  type TestApp,
} from "./db-helpers.js";
import { call, firmWithAllRoles, ROLES, type FirmFixture } from "./support/firms.js";

const USERS = "/api/v1/users";
const INVITE = "/api/v1/users/invite";
const INVITATIONS = "/api/v1/invitations";
const PREVIEW = (token: string) => `/api/v1/auth/invitations/${encodeURIComponent(token)}`;
const ACCEPT = "/api/v1/auth/accept-invitation";
const LOGIN = "/api/v1/auth/login";
const ME = "/api/v1/auth/me";
const INVITATION_KEYS = ["created_at", "email", "expires_at", "id", "invited_by", "role", "status"];
const NO_ONE = "00000000-0000-4000-8000-000000000000";
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const DAY = 24 * 60 * 60 * 1000;

describe("log redaction", () => {
  it("redactUrl hides the token segment of the preview path only", () => {
    expect(redactUrl("/api/v1/auth/invitations/abc_DEF-123")).toBe("/api/v1/auth/invitations/[REDACTED]");
    expect(redactUrl("/api/v1/auth/invitations/abc?x=1")).toBe("/api/v1/auth/invitations/[REDACTED]?x=1");
    expect(redactUrl("/api/v1/invitations/abc")).toBe("/api/v1/invitations/abc");
    expect(redactUrl("/api/v1/users?search=a")).toBe("/api/v1/users?search=a");
  });
});

describe("dev mailer", () => {
  const log = () => ({ info: vi.fn(), error: vi.fn() }) as never;
  it("logs the invitation link outside production only", async () => {
    const dev = log();
    await createLogMailer(dev, false).sendInvitation({
      to: "a@example.com",
      invite_url: "http://x/accept-invitation?token=t",
      firm_name: "F",
      role: "viewer",
    });
    expect((dev as { info: ReturnType<typeof vi.fn> }).info).toHaveBeenCalledTimes(1);
    const prod = log();
    await createLogMailer(prod, true).sendInvitation({
      to: "a@example.com",
      invite_url: "http://x/accept-invitation?token=t",
      firm_name: "F",
      role: "viewer",
    });
    expect((prod as { info: ReturnType<typeof vi.fn> }).info).not.toHaveBeenCalled();
  });
});

/** P1 slice 3: POST /users/invite, GET /invitations, DELETE /invitations/:id, preview and accept. */
describe.skipIf(!hasTestDb)("invitations", () => {
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

  const invite = (cookie: string | undefined, email: string, role: unknown = "employee", extra = {}) =>
    call(t, "POST", INVITE, cookie, { email, role, ...extra });
  const tokenOf = (res: { json(): { data: { invite_url: string } } }) =>
    new URL(res.json().data.invite_url).searchParams.get("token")!;
  const accept = (token: string, name = "New Person", password = "Fresh-pass-77") =>
    call(t, "POST", ACCEPT, undefined, { token, name, password });
  /** Invites and returns the raw token. */
  async function invited(f: FirmFixture, email: string, role: UserRole = "employee") {
    const res = await invite(f.cookies.owner, email, role);
    expect(res.statusCode).toBe(201);
    return { token: tokenOf(res), id: res.json().data.id as string };
  }

  describe("POST /users/invite", () => {
    it("matrix: anonymous 401, manager/employee/viewer 403, owner 201", async () => {
      const f = await firmWithAllRoles(t);
      expect((await invite(undefined, "a@example.com")).statusCode).toBe(401);
      for (const role of ["manager", "employee", "viewer"] as const) {
        const res = await invite(f.cookies[role], "a@example.com", "viewer");
        expect(res.statusCode, role).toBe(403);
        expect(res.json()).toMatchObject({ success: false, code: "FORBIDDEN" });
      }
      expect(await t.prisma.invitation.count()).toBe(0);
      expect(t.mailer.invitations).toHaveLength(0);
      expect((await invite(f.cookies.owner, "a@example.com")).statusCode).toBe(201);
    });

    it("returns the CreatedInvitation, a 7 day expiry and the invite_url with the raw token", async () => {
      const f = await firmWithAllRoles(t);
      const before = Date.now();
      const res = await invite(f.cookies.owner, "  New.Staff@Example.COM ", "manager");
      expect(res.statusCode).toBe(201);
      const d = res.json().data;
      expect(Object.keys(d).sort()).toEqual([...INVITATION_KEYS, "invite_url"].sort());
      expect(d).toMatchObject({
        email: "new.staff@example.com",
        role: "manager",
        status: "pending",
        invited_by: { id: f.userIds.owner, name: "Test Owner" },
      });
      const expires = new Date(d.expires_at).getTime();
      expect(Math.abs(expires - (before + 7 * DAY))).toBeLessThan(60_000);
      expect(d.invite_url).toMatch(
        new RegExp(`^${TEST_FRONTEND_URL}/accept-invitation\\?token=[A-Za-z0-9_-]{43}$`),
      );
      expect(res.json().message).toBe("Invitation created");
    });

    it("stores only the SHA-256 of the token and hands the link to the mailer", async () => {
      const f = await firmWithAllRoles(t);
      const res = await invite(f.cookies.owner, "mail@example.com", "viewer");
      const token = tokenOf(res);
      const rows = await t.prisma.invitation.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token_hash).toBe(sha256(token));
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(t.mailer.invitations).toHaveLength(1);
      expect(t.mailer.invitations[0]).toMatchObject({ to: "mail@example.com", role: "viewer", firm_name: "Role Matrix & Co" });
      expect(t.mailer.lastInviteToken("mail@example.com")).toBe(token);
      expect(rows[0]!.firm_id).toBe(f.firmId);
    });

    it("every token is different", async () => {
      const f = await firmWithAllRoles(t);
      const tokens = new Set<string>();
      for (let i = 0; i < 5; i++) tokens.add(tokenOf(await invite(f.cookies.owner, `u${i}@example.com`)));
      expect(tokens.size).toBe(5);
    });

    it("the token appears in no response other than the create response", async () => {
      const f = await firmWithAllRoles(t);
      const token = tokenOf(await invite(f.cookies.owner, "once@example.com"));
      const seen = [
        await call(t, "GET", INVITATIONS, f.cookies.owner),
        await call(t, "GET", USERS, f.cookies.owner),
        await call(t, "GET", `${INVITATIONS}?status=pending`, f.cookies.owner),
        await call(t, "GET", PREVIEW(token)),
        await invite(f.cookies.owner, "once@example.com"), // 409
      ];
      for (const res of seen) {
        expect(res.body).not.toContain(token);
        expect(res.body).not.toContain(sha256(token));
        expect(res.body).not.toMatch(/token/i);
      }
    });

    it("validates email, role and the body; role owner and unknown roles are 400", async () => {
      const f = await firmWithAllRoles(t);
      const o = f.cookies.owner;
      for (const body of [
        {},
        { email: "a@example.com" },
        { role: "viewer" },
        { email: "nope", role: "viewer" },
        { email: "a@b", role: "viewer" },
        { email: "a@example.com", role: "owner" },
        { email: "a@example.com", role: "OWNER" },
        { email: "a@example.com", role: "admin" },
        { email: "a@example.com", role: ["viewer"] },
        { email: "a@example.com", role: null },
        { email: ["a@example.com"], role: "viewer" },
        { email: `${"a".repeat(250)}@example.com`, role: "viewer" },
        { email: "a@example.com\nBcc: x@example.com", role: "viewer" },
        [],
      ]) {
        const res = await call(t, "POST", INVITE, o, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(res.json().code).toBe("VALIDATION_ERROR");
      }
      expect(await t.prisma.invitation.count()).toBe(0);
    });

    it.each(["manager", "employee", "viewer"] as const)("accepts the role %s", async (role) => {
      const f = await firmWithAllRoles(t);
      const res = await invite(f.cookies.owner, `${role}@example.com`, role);
      expect(res.statusCode).toBe(201);
      expect(res.json().data.role).toBe(role);
    });

    it("ignores smuggled fields: firm_id, status, invited_by_id, token_hash, expires_at", async () => {
      const f = await firmWithAllRoles(t);
      const other = await registerOwner(t, { firm_name: "Other" });
      const res = await invite(f.cookies.owner, "smuggle@example.com", "viewer", {
        firm_id: other.user.firm.id,
        status: "accepted",
        invited_by_id: other.user.id,
        token_hash: "abc",
        expires_at: "2099-01-01T00:00:00Z",
        accepted_at: "2020-01-01T00:00:00Z",
      });
      expect(res.statusCode).toBe(201);
      const row = await t.prisma.invitation.findFirstOrThrow();
      expect(row).toMatchObject({ firm_id: f.firmId, status: "pending", invited_by_id: f.userIds.owner, accepted_at: null });
      expect(row.token_hash).not.toBe("abc");
      expect(row.expires_at.getTime()).toBeLessThan(Date.now() + 8 * DAY);
    });

    it("409 when the email already belongs to a member of this firm (any role, active or not, any case)", async () => {
      const f = await firmWithAllRoles(t);
      const owner = await t.prisma.user.findUniqueOrThrow({ where: { id: f.userIds.owner } });
      const viewer = await t.prisma.user.findUniqueOrThrow({ where: { id: f.userIds.viewer } });
      await t.prisma.firmMember.updateMany({ where: { user_id: f.userIds.viewer }, data: { is_active: false } });
      for (const email of [owner.email, owner.email.toUpperCase(), viewer.email]) {
        const res = await invite(f.cookies.owner, email, "employee");
        expect(res.statusCode, email).toBe(409);
        expect(res.json()).toMatchObject({ success: false, code: "CONFLICT" });
        expect(res.json().errors[0].field).toBe("email");
      }
      expect(await t.prisma.invitation.count()).toBe(0);
      expect(t.mailer.invitations).toHaveLength(0);
    });

    it("409 for a second pending invitation (also with another role or other casing), 201 again after revoke", async () => {
      const f = await firmWithAllRoles(t);
      const first = await invite(f.cookies.owner, "dup@example.com", "viewer");
      expect(first.statusCode).toBe(201);
      for (const [email, role] of [["dup@example.com", "viewer"], ["DUP@Example.com", "manager"]] as const) {
        const res = await invite(f.cookies.owner, email, role);
        expect(res.statusCode).toBe(409);
        expect(res.json().errors[0].field).toBe("email");
      }
      expect(await t.prisma.invitation.count()).toBe(1);
      expect((await call(t, "DELETE", `${INVITATIONS}/${first.json().data.id}`, f.cookies.owner)).statusCode).toBe(200);
      expect((await invite(f.cookies.owner, "dup@example.com", "manager")).statusCode).toBe(201);
    });

    it("an expired pending invitation does not block a new one and is marked expired", async () => {
      const f = await firmWithAllRoles(t);
      const old = await invited(f, "late@example.com", "viewer");
      await t.prisma.invitation.update({ where: { id: old.id }, data: { expires_at: new Date(Date.now() - 1000) } });
      const res = await invite(f.cookies.owner, "late@example.com", "manager");
      expect(res.statusCode).toBe(201);
      const rows = await t.prisma.invitation.findMany({ orderBy: { created_at: "asc" } });
      expect(rows.map((r) => r.status)).toEqual(["expired", "pending"]);
      // the old token is dead, the new one works
      expect((await call(t, "GET", PREVIEW(old.token))).statusCode).toBe(404);
      expect((await call(t, "GET", PREVIEW(tokenOf(res)))).statusCode).toBe(200);
    });

    it("an accepted invitation does not block re-inviting once that user is gone from the firm (new email still free)", async () => {
      const f = await firmWithAllRoles(t);
      const a = await invited(f, "again@example.com", "viewer");
      expect((await accept(a.token)).statusCode).toBe(201);
      expect((await invite(f.cookies.owner, "again@example.com", "viewer")).statusCode).toBe(409); // member now
    });

    it("the same email can be invited by two different firms", async () => {
      const a = await firmWithAllRoles(t, "Firm A");
      const b = await firmWithAllRoles(t, "Firm B");
      expect((await invite(a.cookies.owner, "both@example.com")).statusCode).toBe(201);
      expect((await invite(b.cookies.owner, "both@example.com")).statusCode).toBe(201);
      expect(await t.prisma.invitation.count()).toBe(2);
    });

    it("an email that is a member of ANOTHER firm does not 409 the invite (the accept does)", async () => {
      const a = await firmWithAllRoles(t, "Firm A");
      const b = await firmWithAllRoles(t, "Firm B");
      const bOwner = await t.prisma.user.findUniqueOrThrow({ where: { id: b.userIds.owner } });
      const res = await invite(a.cookies.owner, bOwner.email, "viewer");
      expect(res.statusCode).toBe(201);
      const accepted = await accept(tokenOf(res));
      expect(accepted.statusCode).toBe(409);
      expect(accepted.json().errors[0].field).toBe("email");
    });

    it("race: simultaneous invites of one email give exactly one 201 and the rest 409", async () => {
      const f = await firmWithAllRoles(t);
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => invite(f.cookies.owner, "race@example.com", i % 2 ? "viewer" : "employee")),
      );
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 409, 409, 409, 409, 409]);
      expect(await t.prisma.invitation.count({ where: { email: "race@example.com" } })).toBe(1);
      expect(t.mailer.invitations).toHaveLength(1);
    });

    it("race: different emails in parallel all succeed", async () => {
      const f = await firmWithAllRoles(t);
      const results = await Promise.all(Array.from({ length: 5 }, (_, i) => invite(f.cookies.owner, `p${i}@example.com`)));
      expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
    });

    it("a mailer failure does not fail the invite", async () => {
      const f = await firmWithAllRoles(t);
      const spy = vi.spyOn(t.mailer, "sendInvitation").mockRejectedValueOnce(new Error("smtp down"));
      const res = await invite(f.cookies.owner, "mailfail@example.com");
      expect(res.statusCode).toBe(201);
      spy.mockRestore();
    });
  });

  describe("GET /invitations", () => {
    it("matrix: anonymous 401, manager/employee/viewer 403, owner 200", async () => {
      const f = await firmWithAllRoles(t);
      expect((await call(t, "GET", INVITATIONS)).statusCode).toBe(401);
      for (const role of ROLES) {
        const res = await call(t, "GET", INVITATIONS, f.cookies[role]);
        expect(res.statusCode, role).toBe(role === "owner" ? 200 : 403);
      }
    });

    it("returns the Invitation shape, newest first, with an exact total and no token fields", async () => {
      const f = await firmWithAllRoles(t);
      await invited(f, "one@example.com", "viewer");
      await invited(f, "two@example.com", "manager");
      await invited(f, "three@example.com", "employee");
      const res = await call(t, "GET", INVITATIONS, f.cookies.owner);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((i: { email: string }) => i.email)).toEqual([
        "three@example.com",
        "two@example.com",
        "one@example.com",
      ]);
      expect(res.json().meta).toEqual({ page: 1, limit: 20, total: 3 });
      for (const i of res.json().data) {
        expect(Object.keys(i).sort()).toEqual(INVITATION_KEYS);
        expect(i.invited_by).toEqual({ id: f.userIds.owner, name: "Test Owner" });
      }
      expect(res.body).not.toMatch(/token|invite_url/i);
    });

    it("paginates and validates page/limit/status", async () => {
      const f = await firmWithAllRoles(t);
      for (let i = 0; i < 5; i++) await invited(f, `pg${i}@example.com`);
      const p1 = await call(t, "GET", `${INVITATIONS}?limit=2&page=1`, f.cookies.owner);
      const p3 = await call(t, "GET", `${INVITATIONS}?limit=2&page=3`, f.cookies.owner);
      expect(p1.json().data).toHaveLength(2);
      expect(p3.json().data).toHaveLength(1);
      expect(p3.json().meta).toEqual({ page: 3, limit: 2, total: 5 });
      expect((await call(t, "GET", `${INVITATIONS}?page=4&limit=2`, f.cookies.owner)).json().data).toEqual([]);
      for (const qs of ["?page=0", "?limit=0", "?limit=101", "?limit=x", "?status=done", "?status=PENDING", "?status="]) {
        expect((await call(t, "GET", `${INVITATIONS}${qs}`, f.cookies.owner)).statusCode, qs).toBe(400);
      }
    });

    it("status filter with a derived expired status", async () => {
      const f = await firmWithAllRoles(t);
      const pending = await invited(f, "p@example.com");
      const accepted = await invited(f, "a@example.com");
      const revoked = await invited(f, "r@example.com");
      const expired = await invited(f, "e@example.com");
      const storedExpired = await invited(f, "s@example.com");
      await accept(accepted.token);
      await call(t, "DELETE", `${INVITATIONS}/${revoked.id}`, f.cookies.owner);
      await t.prisma.invitation.update({ where: { id: expired.id }, data: { expires_at: new Date(Date.now() - 1000) } });
      await t.prisma.invitation.update({ where: { id: storedExpired.id }, data: { status: "expired" } });

      const ids = async (status: string) =>
        (await call(t, "GET", `${INVITATIONS}?status=${status}`, f.cookies.owner))
          .json()
          .data.map((i: { id: string; status: string }) => {
            expect(i.status).toBe(status);
            return i.id;
          })
          .sort();
      expect(await ids("pending")).toEqual([pending.id]);
      expect(await ids("accepted")).toEqual([accepted.id]);
      expect(await ids("revoked")).toEqual([revoked.id]);
      expect(await ids("expired")).toEqual([expired.id, storedExpired.id].sort());
      const all = await call(t, "GET", INVITATIONS, f.cookies.owner);
      expect(all.json().meta.total).toBe(5);
      const byId = Object.fromEntries(all.json().data.map((i: { id: string; status: string }) => [i.id, i.status]));
      expect(byId[expired.id]).toBe("expired");
    });

    it("tenant isolation: only the caller's firm, exact counts, other firm's ids never shown", async () => {
      const a = await firmWithAllRoles(t, "Firm A");
      const b = await firmWithAllRoles(t, "Firm B");
      await invited(a, "a1@example.com");
      await invited(a, "a2@example.com");
      const bInv = await invited(b, "b1@example.com");
      await invited(b, "b2@example.com");
      await invited(b, "b3@example.com");
      const ra = await call(t, "GET", INVITATIONS, a.cookies.owner);
      expect(ra.json().meta.total).toBe(2);
      expect(ra.json().data.map((i: { email: string }) => i.email).sort()).toEqual(["a1@example.com", "a2@example.com"]);
      expect(ra.body).not.toContain(bInv.id);
      expect(ra.body).not.toContain("b1@example.com");
      for (const status of ["pending", "accepted", "revoked", "expired"]) {
        const res = await call(t, "GET", `${INVITATIONS}?status=${status}`, a.cookies.owner);
        expect(res.body).not.toContain("b1@example.com");
      }
      expect((await call(t, "GET", INVITATIONS, b.cookies.owner)).json().meta.total).toBe(3);
    });
  });

  describe("DELETE /invitations/:id (revoke)", () => {
    it("matrix: anonymous 401, manager/employee/viewer 403 (nothing revoked), owner 200", async () => {
      const f = await firmWithAllRoles(t);
      const inv = await invited(f, "x@example.com");
      expect((await call(t, "DELETE", `${INVITATIONS}/${inv.id}`)).statusCode).toBe(401);
      for (const role of ["manager", "employee", "viewer"] as const) {
        expect((await call(t, "DELETE", `${INVITATIONS}/${inv.id}`, f.cookies[role])).statusCode, role).toBe(403);
      }
      expect((await t.prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("pending");
      const res = await call(t, "DELETE", `${INVITATIONS}/${inv.id}`, f.cookies.owner);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ id: inv.id, email: "x@example.com", status: "revoked" });
      expect(Object.keys(res.json().data).sort()).toEqual(INVITATION_KEYS);
    });

    it("a revoked token can be neither previewed nor accepted, and nothing is created", async () => {
      const f = await firmWithAllRoles(t);
      const inv = await invited(f, "gone@example.com");
      await call(t, "DELETE", `${INVITATIONS}/${inv.id}`, f.cookies.owner);
      expect((await call(t, "GET", PREVIEW(inv.token))).statusCode).toBe(404);
      expect((await accept(inv.token)).statusCode).toBe(404);
      expect(await t.prisma.user.count({ where: { email: "gone@example.com" } })).toBe(0);
    });

    it("409 when not pending: revoked twice, accepted, expired (derived and stored)", async () => {
      const f = await firmWithAllRoles(t);
      const a = await invited(f, "a@example.com");
      await call(t, "DELETE", `${INVITATIONS}/${a.id}`, f.cookies.owner);
      const again = await call(t, "DELETE", `${INVITATIONS}/${a.id}`, f.cookies.owner);
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe("CONFLICT");

      const b = await invited(f, "b@example.com");
      await accept(b.token);
      expect((await call(t, "DELETE", `${INVITATIONS}/${b.id}`, f.cookies.owner)).statusCode).toBe(409);
      expect((await t.prisma.invitation.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("accepted");

      const c = await invited(f, "c@example.com");
      await t.prisma.invitation.update({ where: { id: c.id }, data: { expires_at: new Date(Date.now() - 1000) } });
      expect((await call(t, "DELETE", `${INVITATIONS}/${c.id}`, f.cookies.owner)).statusCode).toBe(409);
      const d = await invited(f, "d@example.com");
      await t.prisma.invitation.update({ where: { id: d.id }, data: { status: "expired" } });
      expect((await call(t, "DELETE", `${INVITATIONS}/${d.id}`, f.cookies.owner)).statusCode).toBe(409);
    });

    it("404 for unknown and malformed ids", async () => {
      const f = await firmWithAllRoles(t);
      for (const id of [NO_ONE, "nope", "1", "%00"]) {
        const res = await call(t, "DELETE", `${INVITATIONS}/${encodeURIComponent(id)}`, f.cookies.owner);
        expect(res.statusCode, id).toBe(404);
        expect(res.json().code).toBe("NOT_FOUND");
      }
    });

    it("tenant isolation: another firm's invitation is 404 (owner) and stays pending; other roles 403", async () => {
      const a = await firmWithAllRoles(t, "Firm A");
      const b = await firmWithAllRoles(t, "Firm B");
      const inv = await invited(b, "b@example.com");
      const res = await call(t, "DELETE", `${INVITATIONS}/${inv.id}`, a.cookies.owner);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(inv.id);
      for (const role of ["manager", "employee", "viewer"] as const) {
        expect((await call(t, "DELETE", `${INVITATIONS}/${inv.id}`, a.cookies[role])).statusCode).toBe(403);
      }
      expect((await t.prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("pending");
      expect((await call(t, "GET", PREVIEW(inv.token))).statusCode).toBe(200);
      // B's owner can still revoke it.
      expect((await call(t, "DELETE", `${INVITATIONS}/${inv.id}`, b.cookies.owner)).statusCode).toBe(200);
    });

    it("the revoked invitation allows a fresh invite for the same email", async () => {
      const f = await firmWithAllRoles(t);
      const inv = await invited(f, "again@example.com");
      await call(t, "DELETE", `${INVITATIONS}/${inv.id}`, f.cookies.owner);
      expect((await invite(f.cookies.owner, "again@example.com")).statusCode).toBe(201);
    });
  });

  describe("tenant isolation: inviting across firms", () => {
    it("firm B's invitation never collides with, or is visible to, firm A (same email)", async () => {
      const a = await firmWithAllRoles(t, "Firm A");
      const b = await firmWithAllRoles(t, "Firm B");
      await invited(b, "shared@example.com", "viewer");
      const res = await invite(a.cookies.owner, "shared@example.com", "manager");
      expect(res.statusCode).toBe(201);
      expect((await call(t, "GET", INVITATIONS, a.cookies.owner)).json().meta.total).toBe(1);
      expect((await call(t, "GET", INVITATIONS, b.cookies.owner)).json().meta.total).toBe(1);
      const bRow = await t.prisma.invitation.findFirstOrThrow({ where: { firm_id: b.firmId } });
      expect(bRow).toMatchObject({ role: "viewer", status: "pending" });
    });
  });

  describe("GET /auth/invitations/:token (public preview)", () => {
    it("returns exactly email, role, firm_name and expires_at, without a session", async () => {
      const f = await firmWithAllRoles(t, "Preview & Co");
      const inv = await invited(f, "peek@example.com", "manager");
      const res = await call(t, "GET", PREVIEW(inv.token));
      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.json().data).sort()).toEqual(["email", "expires_at", "firm_name", "role"]);
      expect(res.json().data).toMatchObject({ email: "peek@example.com", role: "manager", firm_name: "Preview & Co" });
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(res.body).not.toContain(inv.token);
      // not consumed by previewing
      expect((await call(t, "GET", PREVIEW(inv.token))).statusCode).toBe(200);
    });

    it("one generic 404 for unknown, tampered, expired, revoked, accepted and weird tokens", async () => {
      const f = await firmWithAllRoles(t);
      const good = await invited(f, "g@example.com");
      const expired = await invited(f, "e@example.com");
      const revoked = await invited(f, "r@example.com");
      const used = await invited(f, "u@example.com");
      await t.prisma.invitation.update({ where: { id: expired.id }, data: { expires_at: new Date(Date.now() - 1000) } });
      await call(t, "DELETE", `${INVITATIONS}/${revoked.id}`, f.cookies.owner);
      await accept(used.token);
      const flipped = good.token.slice(0, -1) + (good.token.endsWith("A") ? "B" : "A");
      const bodies = new Set<string>();
      for (const token of [
        "nope",
        flipped,
        good.token.slice(1),
        good.token + "x",
        good.token.toUpperCase(),
        sha256(good.token),
        expired.token,
        revoked.token,
        used.token,
        "x".repeat(600),
        "%00",
        "' OR 1=1 --",
      ]) {
        const res = await call(t, "GET", PREVIEW(token));
        expect(res.statusCode, token.slice(0, 20)).toBe(404);
        expect(res.json().code).toBe("NOT_FOUND");
        // Over-long path segments are rejected by the router in the same envelope (404) before the service runs.
        if (token.length <= 100) bodies.add(res.body);
      }
      expect(bodies.size).toBe(1);
      expect((await call(t, "GET", PREVIEW(good.token))).statusCode).toBe(200);
    });

    it("is not firm scoped by a session: another firm's owner cookie gets the same preview, nothing more", async () => {
      const a = await firmWithAllRoles(t, "Firm A");
      const b = await firmWithAllRoles(t, "Firm B");
      const inv = await invited(b, "b@example.com");
      const res = await call(t, "GET", PREVIEW(inv.token), a.cookies.owner);
      expect(Object.keys(res.json().data).sort()).toEqual(["email", "expires_at", "firm_name", "role"]);
    });
  });

  describe("POST /auth/accept-invitation", () => {
    it.each(["manager", "employee", "viewer"] as const)(
      "happy path for the role %s: signed in, correct role, listed, invitation accepted",
      async (role) => {
        const f = await firmWithAllRoles(t, "Happy Firm");
        const email = `new-${role}@example.com`;
        const inv = await invited(f, email, role);
        const res = await accept(inv.token, "  Fresh Person ", "Fresh-pass-77");
        expect(res.statusCode).toBe(201);
        expect(res.json().message).toBe("Invitation accepted");
        expect(res.json().data).toMatchObject({
          name: "Fresh Person",
          email,
          role,
          firm: { id: f.firmId, name: "Happy Firm", timezone: "Asia/Kolkata", onboarding_completed: false },
        });
        expect(Object.keys(res.json().data).sort()).toEqual(["email", "firm", "id", "name", "role"]);
        expect(res.body).not.toMatch(/password|hash/i);
        const cookie = cookieOf(res);
        expect(cookie).toBeTruthy();
        expect(String(res.headers["set-cookie"])).toMatch(/HttpOnly/i);

        // the cookie works
        const me = await call(t, "GET", ME, cookie);
        expect(me.json().data).toMatchObject({ email, role, firm: { id: f.firmId } });
        // the user can log in with the chosen password and not with another one
        const login = await call(t, "POST", LOGIN, undefined, { email, password: "Fresh-pass-77" });
        expect(login.statusCode).toBe(200);
        expect(login.json().data.role).toBe(role);
        expect((await call(t, "POST", LOGIN, undefined, { email, password: DEFAULT_PASSWORD })).statusCode).toBe(401);
        // appears in /users with the invited role
        const list = await call(t, "GET", USERS, f.cookies.owner);
        const row = list.json().data.find((u: { email: string }) => u.email === email);
        expect(row).toMatchObject({ id: res.json().data.id, role, is_active: true, name: "Fresh Person" });
        expect(list.json().meta.total).toBe(5);
        // invitation is accepted
        const invs = await call(t, "GET", `${INVITATIONS}?status=accepted`, f.cookies.owner);
        expect(invs.json().data.map((i: { id: string }) => i.id)).toEqual([inv.id]);
        const dbRow = await t.prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
        expect(dbRow.status).toBe("accepted");
        expect(dbRow.accepted_at).not.toBeNull();
        // stored password is hashed
        const user = await t.prisma.user.findUniqueOrThrow({ where: { email } });
        expect(user.password_hash).not.toContain("Fresh-pass-77");
        expect(user.password_hash.length).toBeGreaterThan(30);
        // the role really applies (manager can list users, others cannot)
        const users = await call(t, "GET", USERS, cookie);
        expect(users.statusCode).toBe(role === "manager" ? 200 : 403);
      },
    );

    it("a used token cannot be accepted again, and the second attempt changes nothing", async () => {
      const f = await firmWithAllRoles(t);
      const inv = await invited(f, "once@example.com");
      expect((await accept(inv.token, "First", "First-pass-1")).statusCode).toBe(201);
      const again = await accept(inv.token, "Second", "Second-pass-2");
      expect(again.statusCode).toBe(404);
      expect(again.json().code).toBe("NOT_FOUND");
      const user = await t.prisma.user.findUniqueOrThrow({ where: { email: "once@example.com" } });
      expect(user.name).toBe("First");
      expect((await call(t, "POST", LOGIN, undefined, { email: "once@example.com", password: "First-pass-1" })).statusCode).toBe(200);
    });

    it("expired, revoked, unknown and tampered tokens are 404 and create nothing", async () => {
      const f = await firmWithAllRoles(t);
      const expired = await invited(f, "e@example.com");
      const revoked = await invited(f, "r@example.com");
      const good = await invited(f, "g@example.com");
      await t.prisma.invitation.update({ where: { id: expired.id }, data: { expires_at: new Date(Date.now() - 1000) } });
      await call(t, "DELETE", `${INVITATIONS}/${revoked.id}`, f.cookies.owner);
      const users = await t.prisma.user.count();
      const members = await t.prisma.firmMember.count();
      const flipped = good.token.slice(0, -1) + (good.token.endsWith("A") ? "B" : "A");
      for (const token of [expired.token, revoked.token, "nope", flipped, good.token + "=", sha256(good.token)]) {
        const res = await accept(token);
        expect(res.statusCode, token.slice(0, 12)).toBe(404);
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
      expect(await t.prisma.user.count()).toBe(users);
      expect(await t.prisma.firmMember.count()).toBe(members);
      expect((await accept(good.token)).statusCode).toBe(201);
    });

    it("an invitation that expires between preview and accept is refused", async () => {
      const f = await firmWithAllRoles(t);
      const inv = await invited(f, "slow@example.com");
      expect((await call(t, "GET", PREVIEW(inv.token))).statusCode).toBe(200);
      await t.prisma.invitation.update({ where: { id: inv.id }, data: { expires_at: new Date(Date.now() - 1) } });
      expect((await accept(inv.token)).statusCode).toBe(404);
    });

    it("409 when the invited email is already registered (this or another firm); nothing created, invitation stays pending", async () => {
      const a = await firmWithAllRoles(t, "Firm A");
      const b = await firmWithAllRoles(t, "Firm B");
      const bUser = await createMember(t.prisma, { firm_id: b.firmId, role: "employee", email: "taken@example.com" });
      const inv = await invited(a, "late.signup@example.com");
      // the person registers on their own before accepting
      const reg = await call(t, "POST", "/api/v1/auth/register", undefined, {
        name: "Self Registered",
        email: "late.signup@example.com",
        password: "Self-pass-123",
        firm_name: "Own Firm",
      });
      expect(reg.statusCode).toBe(201);
      const members = await t.prisma.firmMember.count();
      const res = await accept(inv.token);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ success: false, code: "CONFLICT" });
      expect(res.json().errors[0].field).toBe("email");
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(await t.prisma.firmMember.count()).toBe(members);
      expect((await t.prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("pending");
      expect(await t.prisma.user.count({ where: { email: "late.signup@example.com" } })).toBe(1);

      const inv2 = await invited(a, bUser.email);
      const res2 = await accept(inv2.token);
      expect(res2.statusCode).toBe(409);
      expect((await t.prisma.firmMember.findMany({ where: { user_id: bUser.id } })).map((m) => m.firm_id)).toEqual([b.firmId]);
    });

    it("race: two simultaneous accepts of one token give exactly one 201 and one 404, one user", async () => {
      const f = await firmWithAllRoles(t);
      const inv = await invited(f, "twice@example.com", "viewer");
      const results = await Promise.all([
        accept(inv.token, "One", "First-pass-1"),
        accept(inv.token, "Two", "Second-pass-2"),
        accept(inv.token, "Three", "Third-pass-3"),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 404, 404]);
      expect(await t.prisma.user.count({ where: { email: "twice@example.com" } })).toBe(1);
      expect(await t.prisma.firmMember.count({ where: { user: { email: "twice@example.com" } } })).toBe(1);
    });

    it("race: invitations from two firms for one email accepted at once: one 201, one 409", async () => {
      const a = await firmWithAllRoles(t, "Firm A");
      const b = await firmWithAllRoles(t, "Firm B");
      const ia = await invited(a, "dual@example.com", "viewer");
      const ib = await invited(b, "dual@example.com", "manager");
      const results = await Promise.all([accept(ia.token), accept(ib.token)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(await t.prisma.user.count({ where: { email: "dual@example.com" } })).toBe(1);
      expect(await t.prisma.firmMember.count({ where: { user: { email: "dual@example.com" } } })).toBe(1);
    });

    it("validates name, password and token (400) and creates nothing", async () => {
      const f = await firmWithAllRoles(t);
      const inv = await invited(f, "val@example.com");
      const users = await t.prisma.user.count();
      for (const body of [
        {},
        { token: inv.token },
        { token: inv.token, name: "A" },
        { token: inv.token, password: "Fresh-pass-77" },
        { token: inv.token, name: "", password: "Fresh-pass-77" },
        { token: inv.token, name: "   ", password: "Fresh-pass-77" },
        { token: inv.token, name: "x".repeat(121), password: "Fresh-pass-77" },
        { token: inv.token, name: "a\u0000b", password: "Fresh-pass-77" },
        { token: inv.token, name: "a\nb", password: "Fresh-pass-77" },
        { token: inv.token, name: "Ok", password: "short1" },
        { token: inv.token, name: "Ok", password: "onlyletters" },
        { token: inv.token, name: "Ok", password: "12345678" },
        { token: inv.token, name: "Ok", password: `a1${"x".repeat(127)}` },
        { token: "", name: "Ok", password: "Fresh-pass-77" },
        { token: "x".repeat(513), name: "Ok", password: "Fresh-pass-77" },
        { token: [inv.token], name: "Ok", password: "Fresh-pass-77" },
        { token: inv.token, name: ["Ok"], password: "Fresh-pass-77" },
        [],
      ]) {
        const res = await call(t, "POST", ACCEPT, undefined, body);
        expect(res.statusCode, JSON.stringify(body).slice(0, 60)).toBe(400);
        expect(res.json().code).toBe("VALIDATION_ERROR");
      }
      expect(await t.prisma.user.count()).toBe(users);
      expect((await accept(inv.token)).statusCode).toBe(201);
    });

    it("mass assignment: role, email, firm_id and is_active in the body are ignored", async () => {
      const f = await firmWithAllRoles(t);
      const other = await registerOwner(t, { firm_name: "Other" });
      const inv = await invited(f, "mass@example.com", "viewer");
      const res = await call(t, "POST", ACCEPT, undefined, {
        token: inv.token,
        name: "Mass",
        password: "Fresh-pass-77",
        role: "owner",
        email: "someone.else@example.com",
        firm_id: other.user.firm.id,
        is_active: false,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toMatchObject({ email: "mass@example.com", role: "viewer", firm: { id: f.firmId } });
      expect(await t.prisma.user.count({ where: { email: "someone.else@example.com" } })).toBe(0);
      const member = await t.prisma.firmMember.findFirstOrThrow({ where: { user: { email: "mass@example.com" } } });
      expect([member.role, member.is_active, member.firm_id]).toEqual(["viewer", true, f.firmId]);
      expect(await t.prisma.firmMember.count({ where: { firm_id: f.firmId, role: "owner" } })).toBe(1);
      expect(await t.prisma.firmMember.count({ where: { firm_id: other.user.firm.id } })).toBe(1);
    });

    it("an invitation row with role owner (forged in the DB) can never be previewed or accepted", async () => {
      const f = await firmWithAllRoles(t);
      const inv = await invited(f, "sneaky@example.com", "viewer");
      await t.prisma.invitation.update({ where: { id: inv.id }, data: { role: "owner" } });
      expect((await call(t, "GET", PREVIEW(inv.token))).statusCode).toBe(404);
      expect((await accept(inv.token)).statusCode).toBe(404);
      expect(await t.prisma.firmMember.count({ where: { firm_id: f.firmId, role: "owner" } })).toBe(1);
    });

    it("the new user is isolated: sees only their firm and cannot reach another firm's users or invitations", async () => {
      const a = await firmWithAllRoles(t, "Firm A");
      const b = await firmWithAllRoles(t, "Firm B");
      const inv = await invited(a, "mgr@example.com", "manager");
      const cookie = cookieOf(await accept(inv.token))!;
      const list = await call(t, "GET", USERS, cookie);
      expect(list.json().meta.total).toBe(5);
      expect(list.body).not.toContain(b.userIds.owner);
      expect((await call(t, "GET", `${USERS}/${b.userIds.owner}`, cookie)).statusCode).toBe(404);
      expect((await call(t, "GET", INVITATIONS, cookie)).statusCode).toBe(403);
    });

    it("a deactivated invitee cannot sign in with the accept cookie afterwards", async () => {
      const f = await firmWithAllRoles(t);
      const inv = await invited(f, "off@example.com", "employee");
      const res = await accept(inv.token);
      const cookie = cookieOf(res)!;
      await call(t, "PATCH", `${USERS}/${res.json().data.id}/status`, f.cookies.owner, { is_active: false });
      expect((await call(t, "GET", ME, cookie)).statusCode).toBe(401);
    });

    it("anonymous malformed JSON on accept is a 400, not a crash", async () => {
      const res = await t.app.inject({
        method: "POST",
        url: ACCEPT,
        headers: { "content-type": "application/json" },
        payload: "{bad",
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("secrets in logs", () => {
    it("production mode writes the invitation token nowhere in the logs", async () => {
      const lines: string[] = [];
      const write = process.stdout.write.bind(process.stdout);
      const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        lines.push(String(chunk));
        return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as never);
      const prisma = t.prisma;
      const app = await buildApp({
        env: loadEnv({
          NODE_ENV: "production",
          LOG_LEVEL: "debug",
          DATABASE_URL: process.env["TEST_DATABASE_URL"]!,
          JWT_SECRET: TEST_JWT_SECRET,
          FRONTEND_URL: TEST_FRONTEND_URL,
        }),
        prisma,
      });
      try {
        const reg = await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { name: "Log Owner", email: "log.owner@example.com", password: "Log-pass-1234", firm_name: "Log Firm" },
        });
        const cookie = cookieOf(reg)!;
        const res = await app.inject({
          method: "POST",
          url: INVITE,
          headers: { cookie },
          payload: { email: "log.invitee@example.com", role: "viewer" },
        });
        const token = new URL(res.json().data.invite_url).searchParams.get("token")!;
        await app.inject({ method: "GET", url: PREVIEW(token) });
        await app.inject({ method: "POST", url: ACCEPT, payload: { token, name: "Log Invitee", password: "Invitee-pass-99" } });
        await new Promise((r) => setTimeout(r, 50));
        const out = lines.join("");
        expect(out).not.toContain(token);
        expect(out).not.toContain("Invitee-pass-99");
        expect(out).not.toContain("Log-pass-1234");
        expect(out).not.toContain("accept-invitation?token");
        expect(out).toContain("/api/v1/auth/invitations/[REDACTED]");
      } finally {
        spy.mockRestore();
        await app.close();
      }
    });
  });
});
