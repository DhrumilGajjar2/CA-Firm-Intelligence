import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cookieOf,
  createMember,
  DEFAULT_PASSWORD,
  hasTestDb,
  makeTestApp,
  registerOwner,
  resetDb,
  type TestApp,
} from "./db-helpers.js";

const BASE = "/api/v1/auth";
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** A password of exactly `n` characters that satisfies the letter + digit rule. */
const passwordOfLength = (n: number) =>
  `Aa1${"x".repeat(Math.max(0, n - 3))}`.slice(0, n);

/**
 * Adversarial input and abuse cases for the six slice-1 auth endpoints, run against the real app and
 * the PostgreSQL test database (see docs/DEPLOYMENT.md "Test database").
 */
describe.skipIf(!hasTestDb)("auth endpoints: adversarial input (real PostgreSQL)", () => {
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

  const post = (url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    t.app.inject({
      method: "POST",
      url: `${BASE}${url}`,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      headers,
    });
  const validRegister = (over: Record<string, unknown> = {}) => ({
    name: "Asha Rao",
    email: "asha@example.com",
    password: DEFAULT_PASSWORD,
    firm_name: "Demo CA Associates",
    ...over,
  });
  const assertErrorEnvelope = (res: { json: () => unknown; body: string }) => {
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["code", "errors", "message", "success"]);
    expect(body["success"]).toBe(false);
    // No stack traces, SQL or driver messages in any error body.
    expect(res.body).not.toMatch(
      /\bat\s+\S+\s+\(|node_modules|prisma|postgres|SELECT |INSERT /i,
    );
  };

  describe("POST /auth/register", () => {
    it("ignores smuggled fields: the registrant is always the OWNER of a brand-new firm (no mass assignment)", async () => {
      const existing = await registerOwner(t, { firm_name: "Existing Firm" });
      const res = await post(
        "/register",
        validRegister({
          email: "attacker@example.com",
          firm_id: existing.user.firm.id,
          role: "manager",
          is_active: false,
          id: "00000000-0000-4000-8000-000000000000",
          password_hash: "$argon2id$v=19$evil",
          last_login_at: "2020-01-01T00:00:00Z",
          timezone: "America/New_York",
          settings: { onboarding_completed: true, financial_year_start_month: 1 },
          memberships: [{ firm_id: existing.user.firm.id, role: "owner" }],
        }),
      );
      expect(res.statusCode).toBe(201);
      const data = res.json().data;
      expect(data.role).toBe("owner");
      expect(data.firm.id).not.toBe(existing.user.firm.id);
      expect(data.firm.name).toBe("Demo CA Associates");
      expect(data.firm.timezone).toBe("Asia/Kolkata");
      expect(data.firm.onboarding_completed).toBe(false);
      expect(data.id).not.toBe("00000000-0000-4000-8000-000000000000");

      const user = await t.prisma.user.findUniqueOrThrow({
        where: { email: "attacker@example.com" },
        include: { memberships: true },
      });
      expect(user.password_hash.startsWith("$argon2id$")).toBe(true);
      expect(user.password_hash).not.toContain("evil");
      expect(user.last_login_at).toBeNull();
      // Exactly one membership, in the new firm, as active owner. Nothing in the existing firm.
      expect(user.memberships).toHaveLength(1);
      expect(user.memberships[0]).toMatchObject({
        firm_id: data.firm.id,
        role: "owner",
        is_active: true,
      });
      expect(
        await t.prisma.firmMember.count({ where: { firm_id: existing.user.firm.id } }),
      ).toBe(1);
      expect(await t.prisma.firm.count()).toBe(2);
    });

    it("normalises whitespace and mixed-case emails and rejects case-insensitive duplicates", async () => {
      const first = await post(
        "/register",
        validRegister({ email: "  MiXed.Case@Example.COM  " }),
      );
      expect(first.statusCode).toBe(201);
      expect(first.json().data.email).toBe("mixed.case@example.com");
      expect(
        (await t.prisma.user.findFirstOrThrow()).email,
        "stored lowercase and trimmed",
      ).toBe("mixed.case@example.com");

      for (const variant of [
        "mixed.case@example.com",
        "MIXED.CASE@EXAMPLE.COM",
        " mixed.CASE@example.com\t",
      ]) {
        const dup = await post("/register", validRegister({ email: variant }));
        expect(dup.statusCode, variant).toBe(409);
        expect(dup.json()).toMatchObject({
          code: "CONFLICT",
          errors: [{ field: "email" }],
        });
        expect(cookieOf(dup)).toBeUndefined();
      }
      expect(await t.prisma.user.count()).toBe(1);
      expect(await t.prisma.firm.count()).toBe(1);
    });

    it("two simultaneous registrations of the same email: one 201, one 409, never a 500 or an orphan firm", async () => {
      const results = await Promise.all([
        post("/register", validRegister({ firm_name: "Race One" })),
        post("/register", validRegister({ firm_name: "Race Two" })),
      ]);
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 409]);
      expect(await t.prisma.user.count()).toBe(1);
      expect(await t.prisma.firm.count()).toBe(1);
      expect(await t.prisma.firmMember.count()).toBe(1);
    });

    it("stores SQL-looking and quote-heavy names verbatim and leaves the schema intact", async () => {
      const name = "Robert'); DROP TABLE users;--";
      const firm_name = `O'Brien & "Sons" <script>alert(1)</script>`;
      const res = await post(
        "/register",
        validRegister({ name, firm_name, email: "o'brien+tag@example.com" }),
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().data.name).toBe(name);
      expect(res.json().data.firm.name).toBe(firm_name);
      expect(await t.prisma.user.count()).toBe(1);
      const stored = await t.prisma.user.findFirstOrThrow();
      expect(stored.name).toBe(name);
      expect(stored.email).toBe("o'brien+tag@example.com");
    });

    it("round-trips odd unicode (accents, CJK, emoji, RTL) in names", async () => {
      const name = "Zoë 张伟 🙂 مرحبا";
      const firm_name = "Ünïcödé Associates 事務所";
      const res = await post("/register", validRegister({ name, firm_name }));
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toMatchObject({ name, firm: { name: firm_name } });
    });

    it("P1-003: never answers 500 for a NUL byte or other control characters in text fields", async () => {
      for (const field of ["name", "firm_name"]) {
        for (const value of ["bad\u0000name", "line\nbreak", "tab\there", "‮evil"]) {
          const res = await post(
            "/register",
            validRegister({
              [field]: value,
              email: `ctl-${Math.random().toString(36).slice(2)}@example.com`,
            }),
          );
          expect(res.statusCode, `${field}=${JSON.stringify(value)}`).toBeLessThan(500);
        }
      }
      // Nothing half-created by a failed attempt.
      expect(await t.prisma.firmMember.count()).toBe(await t.prisma.user.count());
      expect(await t.prisma.firm.count()).toBe(await t.prisma.user.count());
    });

    it("trims name/firm_name and rejects whitespace-only values", async () => {
      const ok = await post(
        "/register",
        validRegister({ name: "   Asha   ", firm_name: "  Firm  " }),
      );
      expect(ok.json().data).toMatchObject({ name: "Asha", firm: { name: "Firm" } });
      for (const field of ["name", "firm_name"]) {
        const res = await post(
          "/register",
          validRegister({ [field]: "     ", email: "ws@example.com" }),
        );
        expect(res.statusCode, field).toBe(400);
        expect(res.json().errors[0].field).toBe(field);
      }
    });

    it.each([
      ["name", 120, 121],
      ["firm_name", 200, 201],
    ])("%s length boundary: %i accepted, %i rejected", async (field, max, over) => {
      const ok = await post(
        "/register",
        validRegister({ [field]: "a".repeat(max), email: "len-ok@example.com" }),
      );
      expect(ok.statusCode).toBe(201);
      const bad = await post(
        "/register",
        validRegister({ [field]: "a".repeat(over), email: "len-bad@example.com" }),
      );
      expect(bad.statusCode).toBe(400);
      expect(bad.json().errors[0].field).toBe(field);
    });

    it("rejects an over-long email (> 254) and malformed addresses", async () => {
      const tooLong = `${"a".repeat(60)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`;
      expect(tooLong.length).toBeGreaterThan(254);
      for (const email of [
        tooLong,
        "plain",
        "@example.com",
        "a@",
        "a b@example.com",
        "a@@example.com",
        "a@example..com",
        "",
      ]) {
        const res = await post("/register", validRegister({ email }));
        expect(res.statusCode, email.slice(0, 40)).toBe(400);
        expect(
          res.json().errors.some((e: { field?: string }) => e.field === "email"),
        ).toBe(true);
      }
      expect(await t.prisma.user.count()).toBe(0);
    });

    describe("password policy boundaries", () => {
      it.each([
        ["7 characters", passwordOfLength(7), 400],
        ["8 characters", passwordOfLength(8), 201],
        ["128 characters", passwordOfLength(128), 201],
        ["129 characters", passwordOfLength(129), 400],
        ["letters only (12)", "abcdefghijkl", 400],
        ["digits only (12)", "123456789012", 400],
        ["symbols only (12)", "!@#$%^&*()_+", 400],
        ["8 spaces", "        ", 400],
        ["empty", "", 400],
      ])("%s -> %i", async (_label, password, status) => {
        const res = await post("/register", validRegister({ password }));
        expect(res.statusCode).toBe(status);
        if (status === 400) {
          expect(
            res.json().errors.some((e: { field?: string }) => e.field === "password"),
          ).toBe(true);
          expect(await t.prisma.user.count()).toBe(0);
        } else {
          expect(await t.prisma.user.count()).toBe(1);
        }
      });

      it("does not trim or alter the password: surrounding spaces are part of it", async () => {
        const password = "  Spaced-pass-1  ";
        expect((await post("/register", validRegister({ password }))).statusCode).toBe(
          201,
        );
        const without = await post("/login", {
          email: "asha@example.com",
          password: "Spaced-pass-1",
        });
        expect(without.statusCode).toBe(401);
        const exact = await post("/login", { email: "asha@example.com", password });
        expect(exact.statusCode).toBe(200);
      });
    });

    it.each([
      ["name is a number", { name: 123 }, "name"],
      ["name is an object", { name: { first: "A" } }, "name"],
      ["email is an array", { email: ["a@example.com"] }, "email"],
      ["email is an object (NoSQL-style)", { email: { $ne: "" } }, "email"],
      ["password is an object", { password: { $gt: "" } }, "password"],
      ["password is a number", { password: 12345678 }, "password"],
      ["firm_name is null", { firm_name: null }, "firm_name"],
      ["firm_name is a boolean", { firm_name: true }, "firm_name"],
    ])("rejects wrong types: %s", async (_label, over, field) => {
      const res = await post("/register", validRegister(over));
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_ERROR");
      expect(res.json().errors.some((e: { field?: string }) => e.field === field)).toBe(
        true,
      );
      assertErrorEnvelope(res);
      expect(await t.prisma.user.count()).toBe(0);
    });

    it("reports every missing field when the body is empty, null, an array or a string", async () => {
      const empty = await post("/register", {});
      expect(empty.statusCode).toBe(400);
      const fields = empty
        .json()
        .errors.map((e: { field: string }) => e.field)
        .sort();
      expect(fields).toEqual(["email", "firm_name", "name", "password"]);

      for (const raw of ["null", "[]", '"a string"', "123", "true"]) {
        const res = await post("/register", raw, { "content-type": "application/json" });
        expect(res.statusCode, raw).toBe(400);
        assertErrorEnvelope(res);
      }
      const noBody = await t.app.inject({
        method: "POST",
        url: `${BASE}/register`,
        headers: { "content-type": "application/json" },
      });
      expect(noBody.statusCode).toBe(400);
      assertErrorEnvelope(noBody);
      expect(await t.prisma.user.count()).toBe(0);
    });

    it("answers malformed JSON with a 400 envelope and a wrong Content-Type with 4xx, never a 500", async () => {
      const malformed = await post("/register", '{"name": "A", ', {
        "content-type": "application/json",
      });
      expect(malformed.statusCode).toBe(400);
      assertErrorEnvelope(malformed);

      const text = await post("/register", "name=A&email=a@example.com", {
        "content-type": "text/plain",
      });
      // Fastify parses text/plain as a string, which then fails body validation.
      expect(text.statusCode).toBe(400);
      assertErrorEnvelope(text);

      const form = await post("/register", "name=A", {
        "content-type": "application/x-www-form-urlencoded",
      });
      expect(form.statusCode).toBe(415);
    });

    it("a failed registration leaves no user, firm or membership behind (validation and conflict)", async () => {
      await post("/register", validRegister({ password: "short" }));
      expect(await t.prisma.user.count()).toBe(0);
      expect(await t.prisma.firm.count()).toBe(0);
      expect(await t.prisma.firmMember.count()).toBe(0);
    });
  });

  describe("POST /auth/login", () => {
    it("normalises whitespace and case in the email", async () => {
      const owner = await registerOwner(t);
      const res = await post("/login", {
        email: `   ${owner.email.toUpperCase()}\t`,
        password: owner.password,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.email).toBe(owner.email);
    });

    it("ignores smuggled role / firm_id fields: the session is the user's own", async () => {
      const a = await registerOwner(t, { firm_name: "Firm A" });
      const b = await registerOwner(t, { firm_name: "Firm B" });
      const viewer = await createMember(t.prisma, {
        firm_id: a.user.firm.id,
        role: "viewer",
      });
      const res = await post("/login", {
        email: viewer.email,
        password: viewer.password,
        role: "owner",
        firm_id: b.user.firm.id,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        role: "viewer",
        firm: { id: a.user.firm.id },
      });
      const me = await t.app.inject({
        method: "GET",
        url: `${BASE}/me`,
        headers: { cookie: cookieOf(res)! },
      });
      expect(me.json().data).toMatchObject({
        role: "viewer",
        firm: { id: a.user.firm.id },
      });
    });

    it.each([
      ["email is an array", { email: ["a@example.com"], password: "x" }],
      ["email is an object", { email: { $ne: null }, password: "x" }],
      ["password is an object", { email: "a@example.com", password: { $ne: "" } }],
      ["password is a number", { email: "a@example.com", password: 123 }],
      ["SQL in the email", { email: "' OR '1'='1' --", password: "x" }],
      ["password longer than 128", { email: "a@example.com", password: "p".repeat(129) }],
      ["empty body", {}],
    ])("rejects %s with 400 and no session", async (_label, payload) => {
      await registerOwner(t, { email: "a@example.com" });
      const res = await post("/login", payload);
      expect(res.statusCode).toBe(400);
      expect(cookieOf(res)).toBeUndefined();
      assertErrorEnvelope(res);
    });

    it("a SQL-injection password is just a wrong password (401, same body as any other wrong password)", async () => {
      const owner = await registerOwner(t);
      const wrong = await post("/login", {
        email: owner.email,
        password: "Wrong-pass-9",
      });
      const sqli = await post("/login", { email: owner.email, password: "' OR '1'='1" });
      expect(sqli.statusCode).toBe(401);
      expect(sqli.payload).toBe(wrong.payload);
      expect(cookieOf(sqli)).toBeUndefined();
    });

    it("failed logins (wrong password, inactive user) never update last_login_at or set a cookie", async () => {
      const owner = await registerOwner(t);
      const inactive = await createMember(t.prisma, {
        firm_id: owner.user.firm.id,
        role: "employee",
        is_active: false,
      });
      await post("/login", { email: owner.email, password: "Wrong-pass-9" });
      const res = await post("/login", {
        email: inactive.email,
        password: inactive.password,
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers["set-cookie"]).toBeUndefined();
      const rows = await t.prisma.user.findMany({ select: { last_login_at: true } });
      expect(rows.every((r) => r.last_login_at === null)).toBe(true);
    });

    it("the 401 for unknown, wrong-password, inactive and membership-less users is byte-identical", async () => {
      const owner = await registerOwner(t);
      const inactive = await createMember(t.prisma, {
        firm_id: owner.user.firm.id,
        role: "manager",
        is_active: false,
      });
      const orphan = await createMember(t.prisma, {
        firm_id: owner.user.firm.id,
        role: "viewer",
      });
      await t.prisma.firmMember.deleteMany({ where: { user_id: orphan.id } });

      const responses = await Promise.all([
        post("/login", { email: "ghost@example.com", password: DEFAULT_PASSWORD }),
        post("/login", { email: owner.email, password: "Wrong-pass-9" }),
        post("/login", { email: inactive.email, password: inactive.password }),
        post("/login", { email: orphan.email, password: orphan.password }),
      ]);
      const first = responses[0]!;
      for (const res of responses) {
        expect(res.statusCode).toBe(401);
        expect(res.payload).toBe(first.payload);
        expect(res.headers["content-length"]).toBe(first.headers["content-length"]);
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
    });
  });

  describe("POST /auth/logout", () => {
    it("is idempotent without a cookie, with a garbage cookie and with an expired/forged token", async () => {
      for (const headers of [
        {} as Record<string, string>,
        { cookie: "access_token=garbage" },
        { cookie: "access_token=" },
        { authorization: "Bearer nonsense" },
      ]) {
        const res = await post("/logout", undefined, headers);
        expect(res.statusCode, JSON.stringify(headers)).toBe(200);
        expect(res.json()).toMatchObject({ success: true, data: null });
        expect(String(res.headers["set-cookie"])).toMatch(/^access_token=;/);
      }
    });

    it("works twice in a row for a real session", async () => {
      const owner = await registerOwner(t);
      expect(
        (await post("/logout", undefined, { cookie: owner.cookie })).statusCode,
      ).toBe(200);
      expect(
        (await post("/logout", undefined, { cookie: owner.cookie })).statusCode,
      ).toBe(200);
    });

    it("the clearing cookie carries the same Path/HttpOnly/SameSite as the session cookie (so the browser really removes it)", async () => {
      const res = await post("/logout");
      const header = String(res.headers["set-cookie"]);
      expect(header).toMatch(/Path=\//);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);
      expect(header).toMatch(/Expires=Thu, 01 Jan 1970/i);
    });
  });

  describe("POST /auth/forgot-password", () => {
    it("normalises the email (case/whitespace) so the right user gets the link", async () => {
      const owner = await registerOwner(t);
      const res = await post("/forgot-password", {
        email: `  ${owner.email.toUpperCase()}  `,
      });
      expect(res.statusCode).toBe(200);
      expect(t.mailer.resets).toHaveLength(1);
      expect(t.mailer.resets[0]!.to).toBe(owner.email);
    });

    it("for an inactive user answers exactly like for an unknown one, and login stays impossible after a reset", async () => {
      const owner = await registerOwner(t);
      const inactive = await createMember(t.prisma, {
        firm_id: owner.user.firm.id,
        role: "employee",
        is_active: false,
      });
      const known = await post("/forgot-password", { email: inactive.email });
      const unknown = await post("/forgot-password", { email: "ghost@example.com" });
      expect(known.statusCode).toBe(200);
      expect(known.payload).toBe(unknown.payload);

      const token = t.mailer.lastResetToken(inactive.email);
      if (token) {
        // A reset must not reactivate a deactivated membership.
        const reset = await post("/reset-password", {
          token,
          password: "Brand-new-pass-2",
        });
        expect(reset.statusCode).toBe(200);
      }
      const login = await post("/login", {
        email: inactive.email,
        password: "Brand-new-pass-2",
      });
      expect(login.statusCode).toBe(401);
      const member = await t.prisma.firmMember.findFirstOrThrow({
        where: { user_id: inactive.id },
      });
      expect(member.is_active).toBe(false);
    });

    it.each([
      ["array", { email: ["a@example.com"] }],
      ["object", { email: { $ne: "" } }],
      ["missing", {}],
      ["empty string", { email: "" }],
      ["SQL", { email: "x'; DROP TABLE users;--@example.com" }],
    ])(
      "rejects an email that is %s with 400 and creates no token",
      async (_label, payload) => {
        await registerOwner(t);
        const res = await post("/forgot-password", payload);
        expect(res.statusCode).toBe(400);
        expect(t.mailer.resets).toHaveLength(0);
        expect(await t.prisma.passwordResetToken.count()).toBe(0);
      },
    );

    it("never returns the token or link in the response, for known or unknown emails", async () => {
      const owner = await registerOwner(t);
      const res = await post("/forgot-password", { email: owner.email });
      const token = t.mailer.lastResetToken(owner.email)!;
      expect(res.body).not.toContain(token);
      expect(res.body).not.toContain("reset-password");
      expect(res.headers["location"]).toBeUndefined();
    });
  });

  describe("POST /auth/reset-password", () => {
    async function requestToken(email: string): Promise<string> {
      await post("/forgot-password", { email });
      const token = t.mailer.lastResetToken(email);
      if (!token) throw new Error("no reset token captured");
      return token;
    }

    it("a token only ever resets the password of ITS user (token of user B cannot change user A)", async () => {
      const a = await registerOwner(t);
      const b = await registerOwner(t);
      const tokenOfB = await requestToken(b.email);

      const res = await post("/reset-password", {
        token: tokenOfB,
        password: "Attacker-pass-9",
      });
      expect(res.statusCode).toBe(200);

      // A is untouched: the old password still works, the new one does not.
      expect(
        (await post("/login", { email: a.email, password: a.password })).statusCode,
      ).toBe(200);
      expect(
        (await post("/login", { email: a.email, password: "Attacker-pass-9" }))
          .statusCode,
      ).toBe(401);
      // B's password did change.
      expect(
        (await post("/login", { email: b.email, password: "Attacker-pass-9" }))
          .statusCode,
      ).toBe(200);
      expect(
        (await post("/login", { email: b.email, password: b.password })).statusCode,
      ).toBe(401);
    });

    it("a used token stays dead and the used_at / password change happen exactly once", async () => {
      const owner = await registerOwner(t);
      const token = await requestToken(owner.email);
      expect(
        (await post("/reset-password", { token, password: "First-pass-1" })).statusCode,
      ).toBe(200);
      const hashAfterFirst = (await t.prisma.user.findFirstOrThrow()).password_hash;

      for (let i = 0; i < 3; i++) {
        const again = await post("/reset-password", {
          token,
          password: `Replay-pass-${i}`,
        });
        expect(again.statusCode).toBe(400);
        expect(again.json().message).toBe("Reset link is invalid or has expired");
      }
      expect((await t.prisma.user.findFirstOrThrow()).password_hash).toBe(hashAfterFirst);
      expect(
        (await post("/login", { email: owner.email, password: "First-pass-1" }))
          .statusCode,
      ).toBe(200);
    });

    it("two simultaneous resets with the same token: exactly one wins", async () => {
      const owner = await registerOwner(t);
      const token = await requestToken(owner.email);
      const results = await Promise.all([
        post("/reset-password", { token, password: "Racer-one-pass-1" }),
        post("/reset-password", { token, password: "Racer-two-pass-2" }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
      const winnerPassword =
        results[0]!.statusCode === 200 ? "Racer-one-pass-1" : "Racer-two-pass-2";
      expect(
        (await post("/login", { email: owner.email, password: winnerPassword }))
          .statusCode,
      ).toBe(200);
    });

    it("expiry boundary: valid just before expires_at, rejected just after; password unchanged on rejection", async () => {
      const owner = await registerOwner(t);
      const token = await requestToken(owner.email);

      await t.prisma.passwordResetToken.updateMany({
        data: { expires_at: new Date(Date.now() - 1) },
      });
      const late = await post("/reset-password", { token, password: "Late-pass-1" });
      expect(late.statusCode).toBe(400);
      expect(
        (await post("/login", { email: owner.email, password: owner.password }))
          .statusCode,
      ).toBe(200);

      await t.prisma.passwordResetToken.updateMany({
        data: { expires_at: new Date(Date.now() + 30_000) },
      });
      const ok = await post("/reset-password", { token, password: "Timely-pass-1" });
      expect(ok.statusCode).toBe(200);
    });

    it.each([
      ["empty", ""],
      ["whitespace only", "   "],
      ["token with surrounding whitespace", "__REAL__ "],
      ["513 characters", "t".repeat(513)],
      ["SQL-looking", "' OR '1'='1"],
      ["its own SHA-256 hash (the stored value) used as a token", "__HASH__"],
      ["a prefix of the real token", "__PREFIX__"],
    ])("rejects a bad token: %s", async (_label, raw) => {
      const owner = await registerOwner(t);
      const real = await requestToken(owner.email);
      const token = raw
        .replace("__REAL__", real)
        .replace("__HASH__", sha256(real))
        .replace("__PREFIX__", real.slice(0, 20));
      const res = await post("/reset-password", { token, password: "Brand-new-pass-2" });
      expect([400]).toContain(res.statusCode);
      assertErrorEnvelope(res);
      // Password unchanged, real token still usable.
      expect(
        (await post("/login", { email: owner.email, password: owner.password }))
          .statusCode,
      ).toBe(200);
      expect((await t.prisma.passwordResetToken.findFirstOrThrow()).used_at).toBeNull();
    });

    it("rejects wrong-typed token/password fields", async () => {
      const owner = await registerOwner(t);
      const token = await requestToken(owner.email);
      for (const payload of [
        { token: ["x"], password: "Brand-new-pass-2" },
        { token: { $ne: "" }, password: "Brand-new-pass-2" },
        { token, password: { $ne: "" } },
        { token, password: 12345678 },
        { password: "Brand-new-pass-2" },
        { token },
      ]) {
        const res = await post("/reset-password", payload);
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        assertErrorEnvelope(res);
      }
      expect((await t.prisma.passwordResetToken.findFirstOrThrow()).used_at).toBeNull();
    });

    describe("new-password policy boundaries (the token survives every rejection)", () => {
      it.each([
        ["7 characters", passwordOfLength(7), 400],
        ["129 characters", passwordOfLength(129), 400],
        ["letters only", "abcdefghijkl", 400],
        ["digits only", "123456789012", 400],
        ["8 characters", passwordOfLength(8), 200],
        ["128 characters", passwordOfLength(128), 200],
      ])("%s -> %i", async (_label, password, status) => {
        const owner = await registerOwner(t);
        const token = await requestToken(owner.email);
        const res = await post("/reset-password", { token, password });
        expect(res.statusCode).toBe(status);
        if (status === 400) {
          expect(res.json().errors[0].field).toBe("password");
          expect(
            (await t.prisma.passwordResetToken.findFirstOrThrow()).used_at,
          ).toBeNull();
          expect(
            (await post("/login", { email: owner.email, password: owner.password }))
              .statusCode,
          ).toBe(200);
        } else {
          expect(
            (await post("/login", { email: owner.email, password })).statusCode,
          ).toBe(200);
        }
      });
    });

    it("reset does not log in, does not touch last_login_at, other users or other firms", async () => {
      const a = await registerOwner(t);
      const b = await registerOwner(t);
      const hashB = (await t.prisma.user.findUniqueOrThrow({ where: { email: b.email } }))
        .password_hash;
      const token = await requestToken(a.email);
      const res = await post("/reset-password", { token, password: "Brand-new-pass-2" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(
        (await t.prisma.user.findUniqueOrThrow({ where: { email: a.email } }))
          .last_login_at,
      ).toBeNull();
      expect(
        (await t.prisma.user.findUniqueOrThrow({ where: { email: b.email } }))
          .password_hash,
      ).toBe(hashB);
    });

    it("a new forgot-password request does not revoke an earlier unused token until one is used (documented single-use rule)", async () => {
      const owner = await registerOwner(t);
      const first = await requestToken(owner.email);
      const second = await requestToken(owner.email);
      expect(await t.prisma.passwordResetToken.count({ where: { used_at: null } })).toBe(
        2,
      );
      expect(
        (await post("/reset-password", { token: second, password: "Second-pass-1" }))
          .statusCode,
      ).toBe(200);
      expect(
        (await post("/reset-password", { token: first, password: "First-pass-1" }))
          .statusCode,
      ).toBe(400);
    });
  });
});
