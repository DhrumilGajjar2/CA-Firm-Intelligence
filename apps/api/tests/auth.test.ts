import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../src/modules/auth/password.js";
import {
  cookieOf,
  createMember,
  DEFAULT_PASSWORD,
  hasTestDb,
  loginCookie,
  makeTestApp,
  registerOwner,
  resetDb,
  type TestApp,
} from "./db-helpers.js";

const BASE = "/api/v1/auth";

describe.skipIf(!hasTestDb)("auth endpoints (real PostgreSQL test database)", () => {
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

  const post = (url: string, payload?: unknown, cookie?: string) =>
    t.app.inject({
      method: "POST",
      url: `${BASE}${url}`,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      ...(cookie ? { headers: { cookie } } : {}),
    });
  const me = (cookie?: string) =>
    t.app.inject({
      method: "GET",
      url: `${BASE}/me`,
      ...(cookie ? { headers: { cookie } } : {}),
    });

  const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

  describe("POST /auth/register", () => {
    it("creates user + firm + owner membership and signs the user in", async () => {
      const res = await post("/register", {
        name: "Asha Rao",
        email: "  Asha@Example.COM ",
        password: DEFAULT_PASSWORD,
        firm_name: "Demo CA Associates",
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({
        success: true,
        data: {
          name: "Asha Rao",
          email: "asha@example.com",
          role: "owner",
          firm: {
            name: "Demo CA Associates",
            timezone: "Asia/Kolkata",
            onboarding_completed: false,
          },
        },
      });
      expect(cookieOf(res)).toBeDefined();

      const firm = await t.prisma.firm.findUniqueOrThrow({
        where: { id: body.data.firm.id },
      });
      expect(firm.settings).toEqual({
        financial_year_start_month: 4,
        onboarding_completed: false,
      });
      const member = await t.prisma.firmMember.findFirstOrThrow({
        where: { user_id: body.data.id },
      });
      expect(member).toMatchObject({ role: "owner", is_active: true, firm_id: firm.id });
    });

    it("sets an httpOnly, Path=/, SameSite=Lax cookie", async () => {
      const res = await post("/register", {
        name: "A",
        email: "a@example.com",
        password: DEFAULT_PASSWORD,
        firm_name: "F",
      });
      const header = String(res.headers["set-cookie"]);
      expect(header).toMatch(/^access_token=/);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/Path=\//);
      expect(header).toMatch(/SameSite=Lax/i);
      expect(header).toMatch(/Max-Age=\d+/i);
    });

    it("stores the password hashed (Argon2id), never the plaintext", async () => {
      const owner = await registerOwner(t);
      const user = await t.prisma.user.findUniqueOrThrow({
        where: { email: owner.email },
      });
      expect(user.password_hash).not.toBe(owner.password);
      expect(user.password_hash).not.toContain(owner.password);
      expect(user.password_hash.startsWith("$argon2id$")).toBe(true);
      expect(await verifyPassword(user.password_hash, owner.password)).toBe(true);
      expect(await verifyPassword(user.password_hash, "Wrong-pass-1")).toBe(false);
    });

    it("returns 409 with a field error for a duplicate email (case-insensitive) and creates nothing extra", async () => {
      await registerOwner(t, { email: "dup@example.com" });
      const res = await post("/register", {
        name: "Other",
        email: "DUP@example.com",
        password: DEFAULT_PASSWORD,
        firm_name: "Second Firm",
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        success: false,
        code: "CONFLICT",
        errors: [{ field: "email" }],
      });
      // The failed registration is rolled back as a whole: no orphan firm.
      expect(await t.prisma.firm.count()).toBe(1);
      expect(await t.prisma.user.count()).toBe(1);
    });

    it("returns 400 with field errors for invalid input", async () => {
      const res = await post("/register", {
        name: "",
        email: "not-an-email",
        password: "short",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
      const fields = body.errors.map((e: { field: string }) => e.field);
      expect(fields).toEqual(
        expect.arrayContaining(["name", "email", "password", "firm_name"]),
      );
      expect(await t.prisma.user.count()).toBe(0);
    });

    it("rejects a password without a digit", async () => {
      const res = await post("/register", {
        name: "A",
        email: "a@example.com",
        password: "onlyletters",
        firm_name: "F",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0].field).toBe("password");
    });
  });

  describe("POST /auth/login", () => {
    it("logs in, sets the cookie and updates last_login_at", async () => {
      const owner = await registerOwner(t);
      const before = await t.prisma.user.findUniqueOrThrow({
        where: { email: owner.email },
      });
      expect(before.last_login_at).toBeNull();

      const res = await post("/login", {
        email: owner.email.toUpperCase(),
        password: owner.password,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        success: true,
        message: "Login successful",
        data: { email: owner.email, role: "owner" },
      });
      const header = String(res.headers["set-cookie"]);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);

      const after = await t.prisma.user.findUniqueOrThrow({
        where: { email: owner.email },
      });
      expect(after.last_login_at).toBeInstanceOf(Date);
    });

    it("returns the same generic 401 for unknown email, wrong password and inactive user", async () => {
      const owner = await registerOwner(t);
      const inactive = await createMember(t.prisma, {
        firm_id: owner.user.firm.id,
        role: "employee",
        is_active: false,
      });

      const unknown = await post("/login", {
        email: "nobody@example.com",
        password: DEFAULT_PASSWORD,
      });
      const wrong = await post("/login", {
        email: owner.email,
        password: "Wrong-pass-9",
      });
      const deactivated = await post("/login", {
        email: inactive.email,
        password: inactive.password,
      });

      for (const res of [unknown, wrong, deactivated]) {
        expect(res.statusCode).toBe(401);
        expect(cookieOf(res)).toBeUndefined();
      }
      expect(unknown.json()).toEqual({
        success: false,
        message: "Invalid email or password",
        code: "UNAUTHENTICATED",
        errors: [],
      });
      expect(wrong.json()).toEqual(unknown.json());
      expect(deactivated.json()).toEqual(unknown.json());
    });

    it("returns 401 (same message) for a user without any membership", async () => {
      const owner = await registerOwner(t);
      await t.prisma.firmMember.deleteMany({ where: { firm_id: owner.user.firm.id } });
      const res = await post("/login", { email: owner.email, password: owner.password });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe("Invalid email or password");
    });

    it("returns 400 with field errors for malformed input", async () => {
      const res = await post("/login", { email: "bad", password: "" });
      expect(res.statusCode).toBe(400);
      const fields = res.json().errors.map((e: { field: string }) => e.field);
      expect(fields).toEqual(expect.arrayContaining(["email", "password"]));
    });
  });

  describe("POST /auth/logout", () => {
    it("clears the cookie and returns 200 with a session", async () => {
      const owner = await registerOwner(t);
      const res = await post("/logout", undefined, owner.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true, data: null });
      const header = String(res.headers["set-cookie"]);
      expect(header).toMatch(/^access_token=;/);
      expect(header).toMatch(/Expires=Thu, 01 Jan 1970/i);
      expect(header).toMatch(/Path=\//);
      expect(header).toMatch(/HttpOnly/i);
    });

    it("is idempotent: 200 without any session", async () => {
      const res = await post("/logout");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true, data: null });
    });
  });

  describe("GET /auth/me", () => {
    it("returns 401 without a cookie and with a garbage cookie", async () => {
      const none = await me();
      expect(none.statusCode).toBe(401);
      expect(none.json()).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
      const garbage = await me("access_token=garbage");
      expect(garbage.statusCode).toBe(401);
    });

    it("returns the current user with the firm for each of the four roles", async () => {
      const owner = await registerOwner(t, { firm_name: "Role Test Firm" });
      const firmId = owner.user.firm.id;
      for (const role of ["owner", "manager", "employee", "viewer"] as const) {
        let cookie = owner.cookie;
        if (role !== "owner") {
          const member = await createMember(t.prisma, { firm_id: firmId, role });
          cookie = await loginCookie(t, member.email, member.password);
        }
        const res = await me(cookie);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
          success: true,
          data: {
            role,
            firm: { id: firmId, name: "Role Test Firm", onboarding_completed: false },
          },
        });
      }
    });

    it("derives firm.onboarding_completed from the firm settings", async () => {
      const owner = await registerOwner(t);
      await t.prisma.firm.update({
        where: { id: owner.user.firm.id },
        data: { settings: { financial_year_start_month: 4, onboarding_completed: true } },
      });
      expect((await me(owner.cookie)).json().data.firm.onboarding_completed).toBe(true);
    });

    it("rejects a still-valid cookie once the user is deactivated (401)", async () => {
      const owner = await registerOwner(t);
      const staff = await createMember(t.prisma, {
        firm_id: owner.user.firm.id,
        role: "employee",
      });
      const cookie = await loginCookie(t, staff.email, staff.password);
      expect((await me(cookie)).statusCode).toBe(200);

      await t.prisma.firmMember.updateMany({
        where: { user_id: staff.id },
        data: { is_active: false },
      });
      const res = await me(cookie);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("UNAUTHENTICATED");
    });

    it("reflects a role change in the database on the very next request", async () => {
      const owner = await registerOwner(t);
      const staff = await createMember(t.prisma, {
        firm_id: owner.user.firm.id,
        role: "employee",
      });
      const cookie = await loginCookie(t, staff.email, staff.password);
      expect((await me(cookie)).json().data.role).toBe("employee");

      await t.prisma.firmMember.updateMany({
        where: { user_id: staff.id },
        data: { role: "manager" },
      });
      expect((await me(cookie)).json().data.role).toBe("manager");
    });

    it("rejects a validly signed token for a firm the user does not belong to (401)", async () => {
      const a = await registerOwner(t);
      const b = await registerOwner(t);
      const forged = t.app.jwt.sign({
        sub: a.user.id,
        firm_id: b.user.firm.id,
        role: "owner" as const,
      });
      const res = await me(`access_token=${forged}`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe("password reset", () => {
    const forgot = (email: string) => post("/forgot-password", { email });

    it("answers identically for known and unknown emails; the mailer only gets a link for the known one", async () => {
      const owner = await registerOwner(t);
      const known = await forgot(owner.email);
      const unknown = await forgot("ghost@example.com");

      expect(known.statusCode).toBe(200);
      expect(unknown.statusCode).toBe(known.statusCode);
      expect(unknown.json()).toEqual(known.json());
      expect(known.json()).toEqual({
        success: true,
        message: "If an account exists, a reset link has been sent",
        data: null,
      });

      expect(t.mailer.resets).toHaveLength(1);
      expect(t.mailer.resets[0]!.to).toBe(owner.email);
      expect(t.mailer.resets[0]!.reset_url).toMatch(
        /^http:\/\/localhost:3000\/reset-password\?token=[A-Za-z0-9_-]{43}$/,
      );
      // No token row for the unknown address.
      expect(await t.prisma.passwordResetToken.count()).toBe(1);
    });

    it("rejects a malformed email with 400", async () => {
      const res = await forgot("nope");
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0].field).toBe("email");
    });

    it("stores only the SHA-256 hash of the token, expiring in about 1 hour", async () => {
      const owner = await registerOwner(t);
      await forgot(owner.email);
      const token = t.mailer.lastResetToken(owner.email)!;
      expect(token).toBeDefined();

      const rows = await t.prisma.passwordResetToken.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token_hash).toBe(sha256(token));
      expect(rows[0]!.token_hash).not.toBe(token);
      expect(JSON.stringify(rows)).not.toContain(token);
      const ttl = rows[0]!.expires_at.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(59 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000);
    });

    it("resets the password, is single-use, and does not log the user in", async () => {
      const owner = await registerOwner(t);
      await forgot(owner.email);
      const token = t.mailer.lastResetToken(owner.email)!;

      const res = await post("/reset-password", { token, password: "Brand-new-pass-2" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true, data: null });
      expect(cookieOf(res)).toBeUndefined();

      const oldLogin = await post("/login", {
        email: owner.email,
        password: owner.password,
      });
      expect(oldLogin.statusCode).toBe(401);
      const newLogin = await post("/login", {
        email: owner.email,
        password: "Brand-new-pass-2",
      });
      expect(newLogin.statusCode).toBe(200);

      const again = await post("/reset-password", { token, password: "Another-pass-3" });
      expect(again.statusCode).toBe(400);
      expect(again.json()).toMatchObject({
        code: "BAD_REQUEST",
        message: "Reset link is invalid or has expired",
      });
    });

    it("rejects an expired token", async () => {
      const owner = await registerOwner(t);
      await forgot(owner.email);
      const token = t.mailer.lastResetToken(owner.email)!;
      await t.prisma.passwordResetToken.updateMany({
        data: { expires_at: new Date(Date.now() - 1000) },
      });
      const res = await post("/reset-password", { token, password: "Brand-new-pass-2" });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("Reset link is invalid or has expired");
      // Password unchanged.
      const login = await post("/login", {
        email: owner.email,
        password: owner.password,
      });
      expect(login.statusCode).toBe(200);
    });

    it("rejects an unknown token with the same error", async () => {
      const res = await post("/reset-password", {
        token: "x".repeat(43),
        password: "Brand-new-pass-2",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("Reset link is invalid or has expired");
    });

    it("a successful reset invalidates the user's other unused tokens", async () => {
      const owner = await registerOwner(t);
      await forgot(owner.email);
      const first = t.mailer.lastResetToken(owner.email)!;
      await forgot(owner.email);
      const second = t.mailer.lastResetToken(owner.email)!;
      expect(second).not.toBe(first);

      const ok = await post("/reset-password", {
        token: first,
        password: "Brand-new-pass-2",
      });
      expect(ok.statusCode).toBe(200);
      const res = await post("/reset-password", {
        token: second,
        password: "Third-pass-3",
      });
      expect(res.statusCode).toBe(400);
      expect(await t.prisma.passwordResetToken.count({ where: { used_at: null } })).toBe(
        0,
      );
    });

    it("validates the new password (400 with field error) and keeps the token usable", async () => {
      const owner = await registerOwner(t);
      await forgot(owner.email);
      const token = t.mailer.lastResetToken(owner.email)!;
      const bad = await post("/reset-password", { token, password: "short" });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().errors[0].field).toBe("password");
      const ok = await post("/reset-password", { token, password: "Brand-new-pass-2" });
      expect(ok.statusCode).toBe(200);
    });
  });

  describe("sensitive data never appears in responses", () => {
    it("no password, password_hash, reset token or token hash in any auth response body", async () => {
      const owner = await registerOwner(t);
      const responses = [
        await post("/register", {
          name: "B",
          email: "b@example.com",
          password: "Secret-pass-77",
          firm_name: "B Firm",
        }),
        await post("/login", { email: owner.email, password: owner.password }),
        await me(owner.cookie),
        await post("/login", { email: owner.email, password: "wrong-pass-1" }),
        await post("/forgot-password", { email: owner.email }),
      ];
      const token = t.mailer.lastResetToken(owner.email)!;
      responses.push(
        await post("/reset-password", { token, password: "Brand-new-pass-2" }),
      );
      responses.push(await post("/logout"));

      const user = await t.prisma.user.findUniqueOrThrow({
        where: { email: owner.email },
      });
      for (const res of responses) {
        const text = res.body;
        expect(text).not.toMatch(/password_hash/i);
        expect(text).not.toMatch(/"password"/i);
        expect(text).not.toContain("$argon2");
        expect(text).not.toContain(user.password_hash);
        expect(text).not.toContain(token);
        expect(text).not.toContain(sha256(token));
        expect(text).not.toContain("Secret-pass-77");
        expect(text).not.toContain("Brand-new-pass-2");
      }
    });
  });
});
