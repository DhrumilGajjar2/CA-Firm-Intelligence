import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMember,
  hasTestDb,
  loginCookie,
  makeTestApp,
  registerOwner,
  resetDb,
  TEST_JWT_SECRET,
  type TestApp,
} from "./db-helpers.js";
import {
  nowSeconds,
  payloadOf,
  signJwt,
  tamperSignature,
  unsignedJwt,
  withPayload,
} from "./support/jwt.js";

/**
 * Critical scenario #10 (expired / unauthorised sessions cannot reach protected endpoints) and the
 * session part of #1 (never serve another firm's data), attacked at the token level against the
 * real app + PostgreSQL test database. GET /auth/me is the only protected P1-slice-1 endpoint.
 */
describe.skipIf(!hasTestDb)("session / JWT attacks on a protected endpoint", () => {
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

  const meWith = (token: string) =>
    t.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: `access_token=${token}` },
    });
  const expect401 = (res: Awaited<ReturnType<typeof meWith>>) => {
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
    // A rejected session must never leak anything about users or firms.
    expect(res.json()).not.toHaveProperty("data");
  };

  /** A firm with an owner; returns the real claims for it. */
  async function victim() {
    const owner = await registerOwner(t, { firm_name: "Victim Firm Pvt Ltd" });
    return {
      owner,
      claims: { sub: owner.user.id, firm_id: owner.user.firm.id, role: "owner" as const },
    };
  }

  it("control: a hand-signed token with the right secret and valid claims IS accepted", async () => {
    const { claims, owner } = await victim();
    const token = signJwt(
      { ...claims, iat: nowSeconds(), exp: nowSeconds() + 600 },
      TEST_JWT_SECRET,
    );
    const res = await meWith(token);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(owner.user.id);
  });

  it("rejects a token whose signature was tampered with", async () => {
    const { owner } = await victim();
    const real = owner.cookie.replace("access_token=", "");
    expect401(await meWith(tamperSignature(real)));
  });

  it("rejects a token whose payload was edited but keeps the old signature (privilege escalation)", async () => {
    const { owner } = await victim();
    const staff = await createMember(t.prisma, {
      firm_id: owner.user.firm.id,
      role: "viewer",
    });
    const real = (await loginCookie(t, staff.email, staff.password)).replace(
      "access_token=",
      "",
    );
    const claims = payloadOf(real);
    expect401(await meWith(withPayload(real, { ...claims, role: "owner" })));
    expect401(await meWith(withPayload(real, { ...claims, sub: owner.user.id })));
  });

  it("rejects a token signed with a different secret", async () => {
    const { claims } = await victim();
    const token = signJwt(
      { ...claims, iat: nowSeconds(), exp: nowSeconds() + 600 },
      "another-secret-that-is-also-32-chars-long!!",
    );
    expect401(await meWith(token));
  });

  it.each(["none", "None", "NONE", "nOnE"])(
    'rejects an unsigned token with alg "%s" (alg:none attack)',
    async (alg) => {
      const { claims } = await victim();
      const payload = { ...claims, iat: nowSeconds(), exp: nowSeconds() + 600 };
      expect401(await meWith(unsignedJwt(payload, alg)));
    },
  );

  it.each(["RS256", "ES256", "PS256"])(
    "rejects an HMAC-signed token that claims alg %s (algorithm confusion)",
    async (alg) => {
      const { claims } = await victim();
      const token = signJwt(
        { ...claims, iat: nowSeconds(), exp: nowSeconds() + 600 },
        TEST_JWT_SECRET,
        { alg, typ: "JWT" },
      );
      expect401(await meWith(token));
    },
  );

  it("rejects an expired token even though the signature is valid", async () => {
    const { claims } = await victim();
    const token = signJwt(
      { ...claims, iat: nowSeconds() - 7200, exp: nowSeconds() - 60 },
      TEST_JWT_SECRET,
    );
    expect401(await meWith(token));
  });

  it("rejects a token that is not valid yet (nbf in the future)", async () => {
    const { claims } = await victim();
    const token = signJwt(
      {
        ...claims,
        iat: nowSeconds(),
        nbf: nowSeconds() + 3600,
        exp: nowSeconds() + 7200,
      },
      TEST_JWT_SECRET,
    );
    expect401(await meWith(token));
  });

  it("rejects tokens with a missing, non-UUID or wrongly typed sub / firm_id", async () => {
    const { claims } = await victim();
    const exp = nowSeconds() + 600;
    const bad: Record<string, unknown>[] = [
      { firm_id: claims.firm_id, role: "owner", exp },
      { sub: claims.sub, role: "owner", exp },
      { ...claims, sub: "' OR 1=1 --", exp },
      { ...claims, firm_id: "'; DROP TABLE firms; --", exp },
      { ...claims, sub: 12345, exp },
      { ...claims, sub: { $ne: null }, exp },
      { ...claims, sub: "", exp },
    ];
    for (const payload of bad) {
      expect401(await meWith(signJwt(payload, TEST_JWT_SECRET)));
    }
    // The schema is still intact afterwards.
    expect(await t.prisma.firm.count()).toBe(1);
  });

  it("P1-002: rejects a signed token whose sub / firm_id is an array holding a valid UUID (401, not 500)", async () => {
    const { claims } = await victim();
    const exp = nowSeconds() + 600;
    for (const payload of [
      { ...claims, firm_id: [claims.firm_id], exp },
      { ...claims, sub: [claims.sub], exp },
    ]) {
      expect401(await meWith(signJwt(payload, TEST_JWT_SECRET)));
    }
  });

  it("rejects empty, malformed and oversized cookie values without a 500", async () => {
    await victim();
    for (const value of ["", " ", "a", "a.b", "a.b.c", ".", "..", "x".repeat(8000)]) {
      const res = await t.app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie: `access_token=${value}` },
      });
      expect(res.statusCode, `cookie value of length ${value.length}`).toBe(401);
    }
  });

  it("rejects a tampered token supplied as a Bearer header too", async () => {
    const { owner } = await victim();
    const real = owner.cookie.replace("access_token=", "");
    const res = await t.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${tamperSignature(real)}` },
    });
    expect401(res);
  });

  it("rejects a valid token once the user row is deleted", async () => {
    const { owner } = await victim();
    expect((await meWith(owner.cookie.replace("access_token=", ""))).statusCode).toBe(
      200,
    );
    await t.prisma.user.delete({ where: { id: owner.user.id } });
    expect401(await meWith(owner.cookie.replace("access_token=", "")));
  });

  it("rejects a valid token once the membership row is deleted", async () => {
    const { owner } = await victim();
    await t.prisma.firmMember.deleteMany({ where: { user_id: owner.user.id } });
    expect401(await meWith(owner.cookie.replace("access_token=", "")));
  });

  it("rejects a forged token for an INACTIVE membership (even with correct claims)", async () => {
    const { owner } = await victim();
    const staff = await createMember(t.prisma, {
      firm_id: owner.user.firm.id,
      role: "manager",
      is_active: false,
    });
    const forged = signJwt(
      {
        sub: staff.id,
        firm_id: owner.user.firm.id,
        role: "manager",
        exp: nowSeconds() + 600,
      },
      TEST_JWT_SECRET,
    );
    expect401(await meWith(forged));
  });

  it("DB role wins: a viewer holding a token that claims owner is still a viewer", async () => {
    const { owner } = await victim();
    const viewer = await createMember(t.prisma, {
      firm_id: owner.user.firm.id,
      role: "viewer",
    });
    const token = signJwt(
      {
        sub: viewer.id,
        firm_id: owner.user.firm.id,
        role: "owner",
        exp: nowSeconds() + 600,
      },
      TEST_JWT_SECRET,
    );
    const res = await meWith(token);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe("viewer");
  });

  it("cross-firm claim: a real user of firm A with firm B in the token gets 401 and no data of B", async () => {
    const a = await registerOwner(t, { firm_name: "Firm Alpha" });
    const b = await registerOwner(t, { firm_name: "Firm Bravo Secret" });
    const exp = nowSeconds() + 600;

    // A's user id + B's firm id.
    const res1 = await meWith(
      signJwt(
        { sub: a.user.id, firm_id: b.user.firm.id, role: "owner", exp },
        TEST_JWT_SECRET,
      ),
    );
    expect401(res1);
    // B's user id + A's firm id.
    const res2 = await meWith(
      signJwt(
        { sub: b.user.id, firm_id: a.user.firm.id, role: "owner", exp },
        TEST_JWT_SECRET,
      ),
    );
    expect401(res2);

    for (const res of [res1, res2]) {
      expect(res.body).not.toContain("Firm Bravo Secret");
      expect(res.body).not.toContain("Firm Alpha");
      expect(res.body).not.toContain(a.email);
      expect(res.body).not.toContain(b.email);
    }
  });

  it("two firms registered back to back: each session only ever sees its own firm", async () => {
    const a = await registerOwner(t, { firm_name: "Firm Alpha", name: "Alpha Owner" });
    const b = await registerOwner(t, { firm_name: "Firm Bravo", name: "Bravo Owner" });
    expect(a.user.firm.id).not.toBe(b.user.firm.id);

    const resA = await t.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: a.cookie },
    });
    const resB = await t.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: b.cookie },
    });
    expect(resA.json().data).toMatchObject({
      id: a.user.id,
      name: "Alpha Owner",
      email: a.email,
      firm: { id: a.user.firm.id, name: "Firm Alpha" },
    });
    expect(resB.json().data).toMatchObject({
      id: b.user.id,
      name: "Bravo Owner",
      email: b.email,
      firm: { id: b.user.firm.id, name: "Firm Bravo" },
    });
    expect(resA.body).not.toContain("Bravo");
    expect(resA.body).not.toContain(b.email);
    expect(resB.body).not.toContain("Alpha");
  });

  it("client-supplied firm/user identifiers (query, headers) cannot change whose data /auth/me returns", async () => {
    const a = await registerOwner(t, { firm_name: "Firm Alpha" });
    const b = await registerOwner(t, { firm_name: "Firm Bravo" });
    const res = await t.app.inject({
      method: "GET",
      url: `/api/v1/auth/me?firm_id=${b.user.firm.id}&user_id=${b.user.id}`,
      headers: {
        cookie: a.cookie,
        "x-firm-id": b.user.firm.id,
        "x-user-id": b.user.id,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      id: a.user.id,
      firm: { id: a.user.firm.id, name: "Firm Alpha" },
    });
    expect(res.body).not.toContain("Firm Bravo");
  });

  it("deactivating one firm's member does not affect another firm's sessions", async () => {
    const a = await registerOwner(t);
    const b = await registerOwner(t);
    await t.prisma.firmMember.updateMany({
      where: { user_id: a.user.id },
      data: { is_active: false },
    });
    const resA = await meWith(a.cookie.replace("access_token=", ""));
    const resB = await meWith(b.cookie.replace("access_token=", ""));
    expect(resA.statusCode).toBe(401);
    expect(resB.statusCode).toBe(200);
  });

  it("the session JWT carries only sub, firm_id, role, iat, exp (no email, name or password data)", async () => {
    const owner = await registerOwner(t, { name: "Asha Rao" });
    const claims = payloadOf(owner.cookie.replace("access_token=", ""));
    expect(Object.keys(claims).sort()).toEqual(["exp", "firm_id", "iat", "role", "sub"]);
    expect(JSON.stringify(claims)).not.toContain(owner.email);
    expect(JSON.stringify(claims)).not.toContain("Asha");
    // The default session lifetime is 8 hours.
    expect((claims["exp"] as number) - (claims["iat"] as number)).toBe(8 * 3600);
  });
});
