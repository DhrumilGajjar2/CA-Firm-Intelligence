import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasTestDb, loginCookie, makeTestApp, registerOwner, resetDb, type TestApp } from "./db-helpers.js";
import {
  ACCEPT,
  DAY,
  HOUR,
  INVITATIONS,
  INVITE,
  LOGIN,
  ME,
  PREVIEW,
  USERS,
  call,
  expectEnvelope,
  firmWithAllRoles,
  inviteVia,
  rawCall,
  tokenOf,
} from "./support/slice3.js";
import type { FirmFixture } from "./support/firms.js";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const PASSWORD = "Fresh-pass-77";

/** Every table, as one string: used to prove a secret is stored nowhere in clear. */
async function dumpDb(t: TestApp): Promise<string> {
  const [users, members, invitations, firms, tokens] = await Promise.all([
    t.prisma.user.findMany(),
    t.prisma.firmMember.findMany(),
    t.prisma.invitation.findMany(),
    t.prisma.firm.findMany(),
    t.prisma.passwordResetToken.findMany(),
  ]);
  return JSON.stringify({ users, members, invitations, firms, tokens });
}

describe.skipIf(!hasTestDb)("invitations: adversarial", () => {
  let t: TestApp;
  let f: FirmFixture;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    t.mailer.clear();
    f = await firmWithAllRoles(t);
  });

  const owner = () => f.cookies.owner;
  const accept = (token: unknown, name: unknown = "New Person", password: unknown = PASSWORD) =>
    call(t, "POST", ACCEPT, undefined, { token, name, password });
  const invite = (email: string, role: "manager" | "employee" | "viewer" = "employee") => inviteVia(t, owner(), email, role);
  const invitationRow = (id: string) => t.prisma.invitation.findUniqueOrThrow({ where: { id } });

  describe("token handling: stored hashed, shown once", () => {
    it("the database holds only the SHA-256 (64 hex), the raw token appears in no column of any table, before and after accept", async () => {
      const { token, id } = await invite("hash.check@example.com", "manager");
      const row = await invitationRow(id);
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.token_hash).toBe(sha256(token));
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url, no padding
      expect(await dumpDb(t)).not.toContain(token);
      const res = await accept(token, "Hash Checker", PASSWORD);
      expect(res.statusCode).toBe(201);
      const dump = await dumpDb(t);
      expect(dump).not.toContain(token);
      expect(dump).not.toContain(PASSWORD);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { email: "hash.check@example.com" } });
      expect(user.password_hash).toMatch(/^\$argon2id\$/);
      expect(user.password_hash).not.toContain(PASSWORD);
    });

    it("the raw token is present ONLY in invite_url of the 201 (and the mailer call); every other response of every endpoint is free of it and of the hash", async () => {
      const created = await call(t, "POST", INVITE, owner(), { email: "once.only@example.com", role: "employee" });
      const token = tokenOf(created);
      const hash = sha256(token);
      expect(created.body.split(token)).toHaveLength(2); // exactly one occurrence, inside invite_url
      expect(created.json().data.invite_url).toBe(`http://localhost:3000/accept-invitation?token=${token}`);
      expect(Object.keys(created.json().data).sort()).toEqual(["created_at", "email", "expires_at", "id", "invite_url", "invited_by", "role", "status"]);
      expect(created.body).not.toContain(hash);
      expect(t.mailer.invitations).toHaveLength(1);
      expect(t.mailer.invitations[0]!.invite_url).toBe(created.json().data.invite_url);

      const id = created.json().data.id;
      const others = [
        await call(t, "GET", `${INVITATIONS}?limit=100`, owner()),
        await call(t, "GET", `${USERS}?limit=100`, owner()),
        await call(t, "GET", PREVIEW(token)),
        await call(t, "POST", INVITE, owner(), { email: "once.only@example.com", role: "employee" }), // 409
        await call(t, "POST", INVITE, owner(), { email: "once.only2@example.com", role: "nope" }), // 400
        await call(t, "GET", ME, owner()),
        await call(t, "DELETE", `${INVITATIONS}/${id}`, owner()), // revoke response
        await call(t, "DELETE", `${INVITATIONS}/${id}`, owner()), // 409
      ];
      for (const res of others) {
        expect(res.body, `${res.statusCode}`).not.toContain(token);
        expect(res.body).not.toContain(hash);
        expect(res.body).not.toContain("invite_url");
        expect(res.body).not.toMatch(/token_hash/i);
      }
      // a second accepted invitation: accept response and the new user's views
      const second = await invite("second.one@example.com");
      const acc = await accept(second.token, "Second One");
      expect(acc.statusCode).toBe(201);
      const cookie = String(acc.headers["set-cookie"]).split(";")[0]!;
      for (const res of [acc, await call(t, "GET", ME, cookie), await call(t, "GET", `${INVITATIONS}?status=accepted`, owner())]) {
        expect(res.body).not.toContain(second.token);
        expect(res.body).not.toContain(sha256(second.token));
        expect(res.body).not.toMatch(/password|argon2|hash/i);
      }
    });

    it("a hash, an id or a token with one character changed is not a credential (preview and accept: 404, nothing created, real token still works)", async () => {
      const { token, id } = await invite("tamper@example.com", "viewer");
      const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
      const variants: [string, string][] = [
        ["first char changed", flip(token, 0)],
        ["middle char changed", flip(token, 20)],
        ["last char changed", flip(token, 42)],
        ["upper-cased", token.toUpperCase()],
        ["lower-cased", token.toLowerCase()],
        ["reversed", [...token].reverse().join("")],
        ["truncated by one", token.slice(0, -1)],
        ["truncated to half", token.slice(0, 21)],
        ["one char appended", `${token}A`],
        ["padding appended", `${token}=`],
        ["newline appended", `${token}\n`],
        ["space prepended", ` ${token}`],
        ["its own SHA-256", sha256(token)],
        ["the stored hash", (await invitationRow(id)).token_hash],
        ["the invitation id", id],
        ["doubled", token + token],
        ["single dash", "-"],
        ["null byte", `${token}\u0000`],
        ["unicode look-alike", `${token.slice(0, 5)}а${token.slice(6)}`],
        ["base64 (not url) alphabet", token.replace(/-/g, "+").replace(/_/g, "/") + "+"],
      ];
      for (const [label, candidate] of variants) {
        if (candidate === token) continue;
        const prev = await call(t, "GET", PREVIEW(candidate));
        expect(prev.statusCode, `preview ${label}`).toBe(404);
        expect(prev.statusCode).toBeLessThan(500);
        const acc = await accept(candidate);
        expect([404, 400], `accept ${label}`).toContain(acc.statusCode);
        expect(acc.statusCode).toBeLessThan(500);
      }
      expect(await t.prisma.user.count({ where: { email: "tamper@example.com" } })).toBe(0);
      expect((await invitationRow(id)).status).toBe("pending");
      expect((await accept(token)).statusCode).toBe(201);
    });

    it("oversized and odd tokens: path > 100 chars is a standard 404, body token 512 ok-length is 404, 513+ is 400, wrong types are 400, never 5xx", async () => {
      for (const len of [99, 100, 101, 128, 512, 513, 5000]) {
        const res = await call(t, "GET", PREVIEW("x".repeat(len)));
        expect(res.statusCode, `preview ${len}`).toBe(404);
        expectEnvelope(res, 404, "NOT_FOUND");
        expect(res.body).not.toContain("x".repeat(30)); // the path is not echoed
      }
      expect((await accept("x".repeat(512))).statusCode).toBe(404);
      expect((await accept("x".repeat(513))).statusCode).toBe(400);
      expect((await accept("x".repeat(50_000))).statusCode).toBe(400);
      for (const bad of ["", null, 123, true, [], ["a"], {}, { token: "a" }, undefined]) {
        const res = await accept(bad);
        expect(res.statusCode, JSON.stringify(bad)).toBe(400);
        expectEnvelope(res, 400, "VALIDATION_ERROR");
      }
      for (const weird of ["%", "%00", "%zz", "..", "../auth/me", "%2e%2e%2fauth%2fme", "a%2Fb", "\\", "'--", '"><script>', "{{7*7}}", "a b", "ä"]) {
        const res = await t.app.inject({ method: "GET", url: `/api/v1/auth/invitations/${weird}` });
        expect(res.statusCode, weird).toBeLessThan(500);
        expect([400, 404]).toContain(res.statusCode);
      }
    });

    it("a revoked, used, expired and unknown token all give a byte-identical 404 (no enumeration oracle)", async () => {
      const revoked = await invite("rev@example.com");
      await call(t, "DELETE", `${INVITATIONS}/${revoked.id}`, owner());
      const used = await invite("used@example.com");
      await accept(used.token, "Used One");
      const expired = await invite("exp@example.com");
      await t.prisma.invitation.update({ where: { id: expired.id }, data: { expires_at: new Date(Date.now() - 1000) } });
      const bodies = new Set<string>();
      for (const token of [revoked.token, used.token, expired.token, "totally-unknown-token"]) {
        const p = await call(t, "GET", PREVIEW(token));
        expect(p.statusCode).toBe(404);
        bodies.add(p.body);
        const a = await accept(token);
        expect(a.statusCode).toBe(404);
        bodies.add(`accept:${a.body}`);
        expect(a.headers["set-cookie"]).toBeUndefined();
      }
      expect(bodies.size).toBe(2); // one preview body, one accept body (the same generic message)
      const [previewBody, acceptBody] = [...bodies];
      expect(JSON.parse(previewBody!).message).toBe(JSON.parse(acceptBody!.replace("accept:", "")).message);
    });

    it("preview is read-only and repeatable: it never consumes the token, sets cookies or writes", async () => {
      const { token, id } = await invite("preview.many@example.com", "manager");
      const before = JSON.stringify(await invitationRow(id));
      for (let i = 0; i < 5; i++) {
        const res = await call(t, "GET", PREVIEW(token));
        expect(res.statusCode).toBe(200);
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
      expect(JSON.stringify(await invitationRow(id))).toBe(before);
    });
  });

  describe("expiry boundary", () => {
    it("expires_at is created_at + 7 days (within seconds) and the response agrees", async () => {
      const { id, res } = await invite("seven.days@example.com");
      const row = await invitationRow(id);
      const ttl = row.expires_at.getTime() - row.created_at.getTime();
      expect(Math.abs(ttl - 7 * DAY)).toBeLessThan(5000);
      expect(res.json().data.expires_at).toBe(row.expires_at.toISOString());
    });

    it("created 6 days 23 hours ago: valid (preview, list=pending, accept 201); created 7 days 1 minute ago: expired everywhere", async () => {
      const young = await invite("young@example.com", "manager");
      const old = await invite("old@example.com", "manager");
      const now = Date.now();
      await t.prisma.invitation.update({ where: { id: young.id }, data: { created_at: new Date(now - (6 * DAY + 23 * HOUR)), expires_at: new Date(now + HOUR) } });
      await t.prisma.invitation.update({ where: { id: old.id }, data: { created_at: new Date(now - (7 * DAY + 60_000)), expires_at: new Date(now - 60_000) } });

      expect((await call(t, "GET", PREVIEW(young.token))).statusCode).toBe(200);
      expect((await call(t, "GET", PREVIEW(old.token))).statusCode).toBe(404);
      const pending = await call(t, "GET", `${INVITATIONS}?status=pending&limit=100`, owner());
      expect(pending.json().data.map((i: { email: string }) => i.email)).toEqual(["young@example.com"]);
      const expired = await call(t, "GET", `${INVITATIONS}?status=expired&limit=100`, owner());
      expect(expired.json().data.map((i: { email: string }) => i.email)).toEqual(["old@example.com"]);
      expect((await call(t, "DELETE", `${INVITATIONS}/${old.id}`, owner())).statusCode).toBe(409);
      expect((await accept(old.token)).statusCode).toBe(404);
      expect(await t.prisma.user.count({ where: { email: "old@example.com" } })).toBe(0);
      const ok = await accept(young.token);
      expect(ok.statusCode).toBe(201);
      expect(ok.json().data.role).toBe("manager");
    });

    it("an invitation that runs out while we watch: valid, then 404/409 after the second passes (no clock slack that keeps it alive)", async () => {
      const { token, id } = await invite("ticking@example.com");
      await t.prisma.invitation.update({ where: { id }, data: { expires_at: new Date(Date.now() + 1500) } });
      expect((await call(t, "GET", PREVIEW(token))).statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 1800));
      expect((await call(t, "GET", PREVIEW(token))).statusCode).toBe(404);
      expect((await accept(token)).statusCode).toBe(404);
      expect((await call(t, "DELETE", `${INVITATIONS}/${id}`, owner())).statusCode).toBe(409);
      // the stored status is still "pending" (derived on read) and the list reports expired
      expect((await invitationRow(id)).status).toBe("pending");
      const list = await call(t, "GET", `${INVITATIONS}?status=expired`, owner());
      expect(list.json().meta.total).toBe(1);
      expect((await call(t, "GET", `${INVITATIONS}?status=pending`, owner())).json().meta.total).toBe(0);
    });

    it("re-inviting an address whose pending invitation expired is allowed (the old one is marked expired, the old token stays dead)", async () => {
      const first = await invite("again@example.com", "viewer");
      await t.prisma.invitation.update({ where: { id: first.id }, data: { expires_at: new Date(Date.now() - 1000) } });
      const second = await invite("again@example.com", "manager");
      expect(second.token).not.toBe(first.token);
      expect((await invitationRow(first.id)).status).toBe("expired");
      expect((await call(t, "GET", PREVIEW(first.token))).statusCode).toBe(404);
      const res = await accept(second.token);
      expect(res.statusCode).toBe(201);
      expect(res.json().data.role).toBe("manager");
    });

    it("duplicates: a second invitation while one is pending is 409 for any case/spacing/role; after revoke it works; the first token is dead", async () => {
      const first = await invite("dup@example.com", "viewer");
      for (const email of ["dup@example.com", "DUP@EXAMPLE.COM", "  Dup@Example.com  "]) {
        for (const role of ["viewer", "manager"]) {
          const res = await call(t, "POST", INVITE, owner(), { email, role });
          expectEnvelope(res, 409, "CONFLICT");
          expect(res.json().errors[0].field).toBe("email");
        }
      }
      expect(await t.prisma.invitation.count({ where: { email: "dup@example.com" } })).toBe(1);
      expect(t.mailer.invitations).toHaveLength(1);
      await call(t, "DELETE", `${INVITATIONS}/${first.id}`, owner());
      const again = await invite("dup@example.com", "manager");
      expect((await call(t, "GET", PREVIEW(first.token))).statusCode).toBe(404);
      expect((await call(t, "GET", PREVIEW(again.token))).statusCode).toBe(200);
    });
  });

  describe("concurrency", () => {
    it("12 simultaneous invites of one address (mixed case, spacing, roles): exactly one 201, eleven 409, one row, one mail", async () => {
      const variants = ["race@example.com", "RACE@example.com", " race@example.com", "Race@Example.Com "];
      const roles = ["manager", "employee", "viewer"] as const;
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => call(t, "POST", INVITE, owner(), { email: variants[i % 4], role: roles[i % 3] })),
      );
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 409)).toHaveLength(11);
      expect(await t.prisma.invitation.count({ where: { email: "race@example.com" } })).toBe(1);
      await new Promise((r) => setTimeout(r, 50));
      expect(t.mailer.invitations).toHaveLength(1);
    });

    it("six simultaneous accepts of one token with different names and passwords: one 201, five 404, one user, only the winner's password works", async () => {
      const { token } = await invite("six.way@example.com", "manager");
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => accept(token, `Racer ${i}`, `Racer-pass-${i}-xyz`)),
      );
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 404, 404, 404, 404, 404]);
      expect(await t.prisma.user.count({ where: { email: "six.way@example.com" } })).toBe(1);
      expect(await t.prisma.firmMember.count({ where: { user: { email: "six.way@example.com" } } })).toBe(1);
      const winner = results.findIndex((r) => r.statusCode === 201);
      for (let i = 0; i < 6; i++) {
        const res = await call(t, "POST", LOGIN, undefined, { email: "six.way@example.com", password: `Racer-pass-${i}-xyz` });
        expect(res.statusCode, `password ${i}`).toBe(i === winner ? 200 : 401);
      }
      expect((await t.prisma.user.findFirstOrThrow({ where: { email: "six.way@example.com" } })).name).toBe(`Racer ${winner}`);
    });

    it("accept racing revoke (8 rounds): never both succeed; the outcome is one consistent state", async () => {
      for (let i = 0; i < 8; i++) {
        const email = `ar${i}@example.com`;
        const { token, id } = await invite(email);
        const [acc, rev] = await Promise.all([accept(token, `AR ${i}`), call(t, "DELETE", `${INVITATIONS}/${id}`, owner())]);
        const row = await invitationRow(id);
        const users = await t.prisma.user.count({ where: { email } });
        if (acc.statusCode === 201) {
          expect([rev.statusCode, row.status, users], `round ${i}`).toEqual([409, "accepted", 1]);
        } else {
          expect([acc.statusCode, rev.statusCode, row.status, users], `round ${i}`).toEqual([404, 200, "revoked", 0]);
        }
      }
    });

    it("two simultaneous revokes: one 200, one 409", async () => {
      const { id } = await invite("rr@example.com");
      const results = await Promise.all([call(t, "DELETE", `${INVITATIONS}/${id}`, owner()), call(t, "DELETE", `${INVITATIONS}/${id}`, owner())]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    });

    it("registering the invited address while the invitation is being accepted: exactly one of them wins, never both, never a 5xx", async () => {
      for (let i = 0; i < 4; i++) {
        const email = `reg.race${i}@example.com`;
        const { token } = await invite(email);
        const [acc, reg] = await Promise.all([
          accept(token, "Invitee", PASSWORD),
          call(t, "POST", "/api/v1/auth/register", undefined, { name: "Registrant", email, password: PASSWORD, firm_name: `Race Firm ${i}` }),
        ]);
        expect(acc.statusCode, `accept ${i}`).toBeLessThan(500);
        expect(reg.statusCode, `register ${i}`).toBeLessThan(500);
        expect([acc.statusCode === 201, reg.statusCode === 201].filter(Boolean)).toHaveLength(1);
        expect(await t.prisma.user.count({ where: { email } })).toBe(1);
        expect(await t.prisma.firmMember.count({ where: { user: { email } } })).toBe(1);
      }
    });
  });

  describe("accept: what the new user gets", () => {
    it.each(["manager", "employee", "viewer"] as const)(
      "%s: exactly the invited role, cookie flags, JWT claims, login works (any email case), listed in /users, invitation 'accepted', second accept 404",
      async (role) => {
        const email = `join.${role}@example.com`;
        const { token, id } = await invite(email, role);
        const res = await accept(token, "  Joined Person  ");
        expect(res.statusCode).toBe(201);
        const data = res.json().data;
        expect(Object.keys(data).sort()).toEqual(["email", "firm", "id", "name", "role"]);
        expect(data).toMatchObject({ email, name: "Joined Person", role });
        expect(Object.keys(data.firm).sort()).toEqual(["id", "name", "onboarding_completed", "timezone"]);
        expect(data.firm.id).toBe(f.firmId);

        const setCookie = String(res.headers["set-cookie"]);
        expect(setCookie).toMatch(/^access_token=/);
        expect(setCookie).toMatch(/HttpOnly/i);
        expect(setCookie).toMatch(/SameSite=Lax/i);
        expect(setCookie).toMatch(/Path=\//);
        const jwt = setCookie.split(";")[0]!.replace("access_token=", "");
        const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
        expect(Object.keys(payload).sort()).toEqual(["exp", "firm_id", "iat", "role", "sub"]);
        expect(payload).toMatchObject({ sub: data.id, firm_id: f.firmId, role });

        const login = await call(t, "POST", LOGIN, undefined, { email: email.toUpperCase(), password: PASSWORD });
        expect(login.statusCode).toBe(200);
        expect(login.json().data.role).toBe(role);
        const listed = (await call(t, "GET", `${USERS}?search=${encodeURIComponent(email)}`, owner())).json().data;
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({ id: data.id, role, is_active: true, name: "Joined Person" });
        expect(listed[0].last_login_at).not.toBeNull(); // the login above
        const inv = (await call(t, "GET", `${INVITATIONS}?status=accepted`, owner())).json().data;
        expect(inv.map((i: { id: string }) => i.id)).toEqual([id]);
        const stored = await invitationRow(id);
        expect(stored.accepted_at).not.toBeNull();
        expect(Math.abs(stored.accepted_at!.getTime() - Date.now())).toBeLessThan(30_000);

        const again = await accept(token, "Joined Person");
        expectEnvelope(again, 404, "NOT_FOUND");
        expect(await t.prisma.user.count({ where: { email } })).toBe(1);
        expect(await t.prisma.firmMember.count({ where: { user_id: data.id } })).toBe(1);
      },
    );

    it("the invited role cannot be escalated by the body, the token, a header or a re-sent cookie", async () => {
      const { token } = await invite("no.escalate@example.com", "viewer");
      const res = await call(
        t,
        "POST",
        ACCEPT,
        f.cookies.owner,
        { token, name: "Climber", password: PASSWORD, role: "owner", firm_id: "00000000-0000-4000-8000-000000000000", is_active: false, email: "other@example.com", id: f.userIds.owner },
        { "x-role": "owner", "x-firm-id": "00000000-0000-4000-8000-000000000000" },
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toMatchObject({ email: "no.escalate@example.com", role: "viewer" });
      const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
      expect((await call(t, "GET", USERS, cookie)).statusCode).toBe(403);
      expect((await call(t, "POST", INVITE, cookie, { email: "x@example.com", role: "viewer" })).statusCode).toBe(403);
      expect((await call(t, "PATCH", `${USERS}/${f.userIds.owner}/status`, cookie, { is_active: false })).statusCode).toBe(403);
      expect(await t.prisma.firmMember.count({ where: { role: "owner" } })).toBe(1);
      expect(await t.prisma.user.count({ where: { email: "other@example.com" } })).toBe(0);
    });

    it("a forged invitation row with role owner can be neither previewed nor accepted, whatever else is true", async () => {
      const { token, id } = await invite("forged.owner@example.com", "viewer");
      await t.prisma.invitation.update({ where: { id }, data: { role: "owner" } });
      expect((await call(t, "GET", PREVIEW(token))).statusCode).toBe(404);
      expect((await accept(token)).statusCode).toBe(404);
      expect(await t.prisma.user.count({ where: { email: "forged.owner@example.com" } })).toBe(0);
    });

    it("an already-registered address (any case) is 409 and creates nothing; the invitation stays pending and the user keeps their own firm and password", async () => {
      const other = await registerOwner(t, { email: "taken@example.com", password: "Original-pass-1" });
      const { token, id } = await invite("TAKEN@example.com", "manager");
      const users = await t.prisma.user.count();
      const members = await t.prisma.firmMember.count();
      const res = await accept(token, "Impostor", "Impostor-pass-1");
      expectEnvelope(res, 409, "CONFLICT");
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(await t.prisma.user.count()).toBe(users);
      expect(await t.prisma.firmMember.count()).toBe(members);
      expect((await invitationRow(id)).status).toBe("pending");
      expect((await loginCookie(t, "taken@example.com", "Original-pass-1"))).toContain("access_token=");
      expect((await call(t, "POST", LOGIN, undefined, { email: "taken@example.com", password: "Impostor-pass-1" })).statusCode).toBe(401);
      expect((await call(t, "GET", ME, other.cookie)).json().data.firm.id).toBe(other.user.firm.id);
    });

    it("an accepted user who is later deactivated cannot use the accept cookie or log in; reactivation restores both", async () => {
      const { token } = await invite("later.off@example.com", "employee");
      const res = await accept(token);
      const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
      const id = res.json().data.id;
      await call(t, "PATCH", `${USERS}/${id}/status`, owner(), { is_active: false });
      expect((await call(t, "GET", ME, cookie)).statusCode).toBe(401);
      expect((await call(t, "POST", LOGIN, undefined, { email: "later.off@example.com", password: PASSWORD })).statusCode).toBe(401);
      await call(t, "PATCH", `${USERS}/${id}/status`, owner(), { is_active: true });
      expect((await call(t, "GET", ME, cookie)).statusCode).toBe(200);
    });

    it("a successful accept for a firm whose owner is later deactivated is unaffected (owner status cannot change; invitation stays accepted)", async () => {
      const { token, id } = await invite("owner.safe@example.com");
      expect((await accept(token)).statusCode).toBe(201);
      expect((await call(t, "PATCH", `${USERS}/${f.userIds.owner}/status`, owner(), { is_active: false })).statusCode).toBe(403);
      expect((await invitationRow(id)).status).toBe("accepted");
    });
  });

  describe("accept: input rules", () => {
    async function tryAccept(password: unknown, name: unknown = "Valid Name") {
      const email = `rule.${Math.random().toString(36).slice(2, 10)}@example.com`;
      const { token, id } = await invite(email);
      const res = await accept(token, name, password);
      return { res, token, id, email };
    }

    it.each([
      ["7 characters", "Abcdef1", 400],
      ["8 characters", "Abcdefg1", 201],
      ["128 characters", `${"a".repeat(127)}1`, 201],
      ["129 characters", `${"a".repeat(128)}1`, 400],
      ["letters only", "abcdefghij", 400],
      ["digits only", "1234567890", 400],
      ["symbols only", "!@#$%^&*()", 400],
      ["empty", "", 400],
      ["spaces and a digit", "      a 1", 201],
      ["non-ASCII letters and a digit", "ÄÖÜßñ日本語-1", 400], // only [A-Za-z] counts as a letter
      ["ascii + emoji + digit", "pass-🔐-word-1", 201],
      ["number type", 12345678, 400],
      ["array", ["Abcdefg1"], 400],
      ["null", null, 400],
      ["object", { password: "Abcdefg1" }, 400],
    ])("password %s -> %i, and a rejected attempt leaves the invitation usable", async (_label, password, status) => {
      const { res, token, id, email } = await tryAccept(password);
      expect(res.statusCode, JSON.stringify(password)).toBe(status);
      if (status === 400) {
        expect(res.json().errors.map((e: { field: string }) => e.field)).toContain("password");
        expect(res.headers["set-cookie"]).toBeUndefined();
        expect(await t.prisma.user.count({ where: { email } })).toBe(0);
        expect((await invitationRow(id)).status).toBe("pending");
        expect((await accept(token, "Valid Name", "Abcdefg1")).statusCode).toBe(201);
      } else {
        const login = await call(t, "POST", LOGIN, undefined, { email, password });
        expect(login.statusCode, "the accepted password logs in").toBe(200);
      }
    });

    it("a password with control characters or NUL never causes a 5xx; whatever is accepted can log in with exactly that password", async () => {
      for (const password of ["Abcdefg1\u0000", "Abc\u0000defg1", "Abcdefg1\n", "Abcdefg1\t", "\u0007Abcdefg1", "Abcdefg1‮", "Abcdefg1\ud800"]) {
        const { res, email } = await tryAccept(password);
        expect(res.statusCode, JSON.stringify(password)).toBeLessThan(500);
        if (res.statusCode === 201) {
          const login = await call(t, "POST", LOGIN, undefined, { email, password });
          expect(login.statusCode, `login with ${JSON.stringify(password)}`).toBe(200);
        }
      }
    });

    it("name rules: trimmed, 1-120 chars, no control characters (any of C0/C1), not whitespace-only; never a 5xx", async () => {
      const ok = await tryAccept(PASSWORD, "  Anita Rao  ");
      expect(ok.res.statusCode).toBe(201);
      expect(ok.res.json().data.name).toBe("Anita Rao");
      expect((await tryAccept(PASSWORD, "n".repeat(120))).res.statusCode).toBe(201);
      for (const [label, name] of [
        ["121 chars", "n".repeat(121)],
        ["empty", ""],
        ["spaces", "     "],
        ["NBSP only", "  "],
        ["tab only", "\t"],
        ["NUL inside", "Bad\u0000Name"],
        ["newline inside", "Bad\nName"],
        ["DEL", "Bad\u007fName"],
        ["C1 control", "Bad\u0085Name"],
        ["number", 5],
        ["array", ["x"]],
        ["null", null],
        ["object", { first: "x" }],
      ] as const) {
        const { res, id, email } = await tryAccept(PASSWORD, name);
        expect(res.statusCode, label).toBe(400);
        expect(res.json().errors.map((e: { field: string }) => e.field), label).toContain("name");
        expect(await t.prisma.user.count({ where: { email } })).toBe(0);
        expect((await invitationRow(id)).status).toBe("pending");
      }
      // exotic but legal: stored verbatim, no 5xx
      for (const name of ["<script>alert(1)</script>", "'; DROP TABLE users;--", "Zoë 日本 🙂", "A​B"]) {
        const { res } = await tryAccept(PASSWORD, name);
        expect(res.statusCode, name).toBe(201);
        expect(res.json().data.name).toBe(name);
      }
      expect(await t.prisma.user.count()).toBeGreaterThan(4);
    });

    it("odd bodies: null, array, string, empty, missing fields, duplicate JSON keys (last wins) never reach the database as a 5xx", async () => {
      const { token } = await invite("odd.body@example.com");
      for (const body of ["null", "[]", '"x"', "1", "{}", `{"token":"${token}"}`, `{"name":"x","password":"${PASSWORD}"}`]) {
        const res = await rawCall(t, "POST", ACCEPT, undefined, body);
        expect(res.statusCode, body).toBe(400);
      }
      const dup = await rawCall(t, "POST", ACCEPT, undefined, `{"token":"wrong","token":"${token}","name":"Dup Keys","password":"${PASSWORD}"}`);
      expect(dup.statusCode).toBe(201);
    });
  });

  describe("invite: input rules and lists", () => {
    it("email rules: trimmed and lower-cased, 254 ok / 255 rejected, junk and control characters 400, never a 5xx", async () => {
      const r254 = await call(t, "POST", INVITE, owner(), { email: `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`, role: "viewer" });
      expect(r254.statusCode).toBe(201);
      const r255 = await call(t, "POST", INVITE, owner(), { email: `${"a".repeat(65)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`, role: "viewer" });
      expect(r255.statusCode).toBe(400);
      const norm = await call(t, "POST", INVITE, owner(), { email: "  Mixed.Case+Tag@Example.COM \t", role: "viewer" });
      expect(norm.json().data.email).toBe("mixed.case+tag@example.com");
      for (const email of ["", "   ", "plain", "a@b", "a@@b.com", "a b@example.com", "Name <a@example.com>", "a@example.com,b@example.com", "a@example.com\nBcc: x@example.com", "a\u0000@example.com", "tést@example.com", "x".repeat(10_000), 5, null, ["a@example.com"], { a: 1 }]) {
        const res = await call(t, "POST", INVITE, owner(), { email, role: "viewer" });
        expect(res.statusCode, JSON.stringify(email)?.slice(0, 60)).toBe(400);
      }
      expect(await t.prisma.invitation.count()).toBe(2);
    });

    it("GET /invitations: newest first with a stable order, pagination boundaries, filters and exact totals", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) ids.push((await invite(`list${i}@example.com`)).id);
      // same created_at for all: order must still be total and stable
      await t.prisma.invitation.updateMany({ data: { created_at: new Date("2026-11-01T10:00:00.000Z") } });
      const first = await call(t, "GET", `${INVITATIONS}?limit=100`, owner());
      const second = await call(t, "GET", `${INVITATIONS}?limit=100`, owner());
      expect(first.json().data.map((i: { id: string }) => i.id)).toEqual(second.json().data.map((i: { id: string }) => i.id));
      const seen: string[] = [];
      for (const page of [1, 2, 3, 4]) {
        const res = await call(t, "GET", `${INVITATIONS}?page=${page}&limit=2`, owner());
        expect(res.json().meta).toEqual({ page, limit: 2, total: 7 });
        for (const i of res.json().data) seen.push(i.id);
      }
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      expect([...seen].sort()).toEqual([...ids].sort());
      const beyond = await call(t, "GET", `${INVITATIONS}?page=999&limit=2`, owner());
      expect(beyond.statusCode).toBe(200);
      expect(beyond.json().data).toEqual([]);
      expect(beyond.json().meta.total).toBe(7);
      for (const qs of ["page=0", "page=-1", "page=1.5", "page=abc", "page=", "limit=0", "limit=101", "limit=-1", "limit=abc", "limit=", "status=PENDING", "status=all", "status=pending&status=accepted", "page=1&page=2"]) {
        const res = await call(t, "GET", `${INVITATIONS}?${qs}`, owner());
        expect(res.statusCode, qs).toBe(400);
        expectEnvelope(res, 400, "VALIDATION_ERROR");
      }
      expect((await call(t, "GET", `${INVITATIONS}?limit=100`, owner())).statusCode).toBe(200);
      expect((await call(t, "GET", `${INVITATIONS}?limit=1`, owner())).json().data).toHaveLength(1);
      expect((await call(t, "GET", `${INVITATIONS}?page=99999999999999999999`, owner())).statusCode).toBeLessThan(500);
    });

    it("invited_by shows the inviting user's id and name", async () => {
      const res = await invite("by.owner@example.com");
      expect(res.res.json().data.invited_by).toEqual({ id: f.userIds.owner, name: "Test Owner" });
    });
  });

  describe("mailer", () => {
    it("exactly one message per created invitation (none for 409/400/403), carrying the same URL the owner got", async () => {
      await invite("mail.one@example.com", "manager");
      await call(t, "POST", INVITE, owner(), { email: "mail.one@example.com", role: "manager" });
      await call(t, "POST", INVITE, owner(), { email: "bad", role: "manager" });
      await call(t, "POST", INVITE, f.cookies.manager, { email: "mail.two@example.com", role: "viewer" });
      await call(t, "POST", INVITE, undefined, { email: "mail.three@example.com", role: "viewer" });
      await new Promise((r) => setTimeout(r, 50));
      expect(t.mailer.invitations).toHaveLength(1);
      expect(t.mailer.invitations[0]).toMatchObject({ to: "mail.one@example.com", role: "manager", firm_name: "Role Matrix & Co" });
    });
  });
});

describe.skipIf(!hasTestDb)("invitations: all four roles can be created by the owner only once per address across statuses", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });
  it("address lifecycle: invite -> revoke -> invite -> accept -> invite again is 409 (already a member)", async () => {
    await resetDb(t.prisma);
    const f = await firmWithAllRoles(t);
    const a = await inviteVia(t, f.cookies.owner, "life@example.com", "viewer");
    expect((await call(t, "DELETE", `${INVITATIONS}/${a.id}`, f.cookies.owner)).statusCode).toBe(200);
    const b = await inviteVia(t, f.cookies.owner, "life@example.com", "viewer");
    expect((await call(t, "POST", ACCEPT, undefined, { token: b.token, name: "Life Cycle", password: PASSWORD })).statusCode).toBe(201);
    const c = await call(t, "POST", INVITE, f.cookies.owner, { email: "life@example.com", role: "manager" });
    expectEnvelope(c, 409, "CONFLICT");
    expect((await call(t, "GET", `${INVITATIONS}?limit=100`, f.cookies.owner)).json().meta.total).toBe(2);
  });
});
