import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import {
  createTestPrisma,
  DEFAULT_PASSWORD,
  hasTestDb,
  resetDb,
  TEST_FRONTEND_URL,
  TEST_JWT_SECRET,
} from "./db-helpers.js";
import { testEnv, makeApp } from "./helpers.js";
import { testDatabaseUrl } from "./support/db-guard.js";

const AUTH = "/api/v1/auth";

describe("CORS and security headers (no database needed)", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => app?.close());

  const preflight = (origin: string, path = `${AUTH}/login`) =>
    app.inject({
      method: "OPTIONS",
      url: path,
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

  it("allows exactly the FRONTEND_URL origin, with credentials", async () => {
    const res = await preflight(TEST_FRONTEND_URL);
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe(TEST_FRONTEND_URL);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it.each([
    "http://evil.example",
    "https://localhost:3000", // wrong scheme
    "http://localhost:3001", // wrong port
    "http://localhost:3000.evil.example", // suffix trick
    "http://evil.example/http://localhost:3000",
    "null", // sandboxed iframe / file: origin
  ])(
    "does not grant origin %s (a browser at that origin would be blocked)",
    async (origin) => {
      const res = await preflight(origin);
      // With a fixed origin, @fastify/cors always answers with the configured FRONTEND_URL. The browser
      // compares it with the requesting origin and blocks the response, so the foreign origin is never
      // echoed and never gets the wildcard.
      const allowed = res.headers["access-control-allow-origin"];
      expect(allowed).not.toBe(origin);
      expect(allowed).not.toBe("*");
      expect([undefined, TEST_FRONTEND_URL]).toContain(allowed);
    },
  );

  it("never answers with a wildcard origin, for any request", async () => {
    for (const origin of [TEST_FRONTEND_URL, "http://evil.example"]) {
      const res = await app.inject({
        method: "POST",
        url: `${AUTH}/logout`,
        headers: { origin },
      });
      expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    }
  });

  it("a real (non-preflight) request from a foreign origin is not granted to that origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${AUTH}/logout`,
      headers: { origin: "http://evil.example" },
    });
    const allowed = res.headers["access-control-allow-origin"];
    expect(allowed).not.toBe("http://evil.example");
    expect(allowed).not.toBe("*");
  });

  it("sends baseline security headers (helmet) and no framework fingerprint", async () => {
    const res = await app.inject({ method: "POST", url: `${AUTH}/logout` });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("returns the standard 401 envelope (no stack, no hints) for /auth/me without a session", async () => {
    const res = await app.inject({ method: "GET", url: `${AUTH}/me` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      success: false,
      message: "Authentication required",
      code: "UNAUTHENTICATED",
      errors: [],
    });
  });

  it("answers wrong methods and unknown auth routes in the standard envelope", async () => {
    for (const [method, url] of [
      ["GET", `${AUTH}/login`],
      ["GET", `${AUTH}/register`],
      ["POST", `${AUTH}/me`],
      ["GET", `${AUTH}/reset-password`],
      ["POST", `${AUTH}/does-not-exist`],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json()).toMatchObject({ success: false, code: "NOT_FOUND" });
    }
  });
});

/**
 * Cookie flags that only differ in production (Secure). The app is built with NODE_ENV=production
 * against the TEST database, with logging silenced.
 */
describe.skipIf(!hasTestDb)("session cookie attributes in production mode", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prisma: ReturnType<typeof createTestPrisma>;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "production",
        LOG_LEVEL: "silent",
        DATABASE_URL: testDatabaseUrl()!,
        JWT_SECRET: TEST_JWT_SECRET,
        FRONTEND_URL: TEST_FRONTEND_URL,
      }),
      prisma,
      mailer: { sendPasswordReset: async () => {} },
    });
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });

  const registerBody = {
    name: "Asha Rao",
    email: "asha@example.com",
    password: DEFAULT_PASSWORD,
    firm_name: "Demo CA Associates",
  };

  it("register and login cookies are Secure + HttpOnly + SameSite=Lax + Path=/ + Max-Age=8h", async () => {
    const reg = await app.inject({
      method: "POST",
      url: `${AUTH}/register`,
      payload: registerBody,
    });
    const login = await app.inject({
      method: "POST",
      url: `${AUTH}/login`,
      payload: { email: registerBody.email, password: registerBody.password },
    });
    for (const res of [reg, login]) {
      const header = String(res.headers["set-cookie"]);
      expect(header).toMatch(/^access_token=[\w-]+\.[\w-]+\.[\w-]+;/);
      expect(header).toMatch(/;\s*Secure/i);
      expect(header).toMatch(/;\s*HttpOnly/i);
      expect(header).toMatch(/;\s*SameSite=Lax/i);
      expect(header).toMatch(/;\s*Path=\//);
      expect(header).toMatch(/;\s*Max-Age=28800\b/);
      // Host-only: no Domain attribute that would widen the cookie to sibling subdomains.
      expect(header).not.toMatch(/Domain=/i);
    }
  });

  it("the logout cookie is Secure too and expires in the past", async () => {
    const res = await app.inject({ method: "POST", url: `${AUTH}/logout` });
    const header = String(res.headers["set-cookie"]);
    expect(header).toMatch(/^access_token=;/);
    expect(header).toMatch(/;\s*Secure/i);
    expect(header).toMatch(/;\s*HttpOnly/i);
    expect(header).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  it("does not serve Swagger UI in production by default", async () => {
    const res = await app.inject({ method: "GET", url: "/docs" });
    expect(res.statusCode).toBe(404);
  });
});

describe("session cookie in non-production mode", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => app?.close());

  it("is not Secure over plain http in development/test (so localhost works)", async () => {
    app = await makeApp();
    expect(testEnv.NODE_ENV).toBe("test");
    app.get("/__test/cookie", async (_req, reply) => {
      await app.issueAuthCookie(reply, {
        sub: "11111111-1111-4111-8111-111111111111",
        firm_id: "22222222-2222-4222-8222-222222222222",
        role: "owner",
      });
      return { ok: true };
    });
    const res = await app.inject({ method: "GET", url: "/__test/cookie" });
    expect(String(res.headers["set-cookie"])).not.toMatch(/Secure/i);
  });
});
