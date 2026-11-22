/**
 * Child-process probe for tests/auth-logs.test.ts. Builds the REAL app in production mode (so Fastify
 * writes its real JSON request logs to stdout at debug level) against the test database, drives every
 * slice-1 auth endpoint with recognisable secrets, and prints the secrets as JSON on STDERR.
 * The parent test then checks that none of them appear in STDOUT (the logs).
 */
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createTestPrisma, DEFAULT_PASSWORD, resetDb } from "../db-helpers.js";

const url = process.env["TEST_DATABASE_URL"];
if (!url) throw new Error("TEST_DATABASE_URL is required");
const JWT_SECRET = "probe-jwt-secret-that-is-at-least-32-characters-long";

const resets: { to: string; reset_url: string }[] = [];
const prisma = createTestPrisma();
await resetDb(prisma);

const app = await buildApp({
  env: loadEnv({
    NODE_ENV: "production",
    LOG_LEVEL: "debug",
    DATABASE_URL: url,
    JWT_SECRET,
    FRONTEND_URL: "http://localhost:3000",
  }),
  prisma,
  mailer: {
    async sendPasswordReset(m) {
      resets.push(m);
    },
  },
});

const email = "probe.user@example.com";
const password = "Probe-Secret-Pass-77";
const newPassword = "Probe-New-Secret-88";
const bad = { email, password: "Probe-Wrong-Pass-99" };

const post = (path: string, payload?: unknown, cookie?: string) =>
  app.inject({
    method: "POST",
    url: `/api/v1/auth${path}`,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    ...(cookie ? { headers: { cookie } } : {}),
  });

const reg = await post("/register", {
  name: "Probe User",
  email,
  password,
  firm_name: "Probe Firm",
});
const cookie = String(reg.headers["set-cookie"]).split(";")[0]!;
const jwt = cookie.replace("access_token=", "");
await post("/login", { email, password });
await post("/login", bad);
await post("/register", { name: "x", email: "bad", password: "Probe-Invalid-1" }); // 400
await post("/register", { name: "Dup", email, password, firm_name: "Dup" }); // 409
await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
await app.inject({
  method: "GET",
  url: "/api/v1/auth/me",
  headers: { cookie: "access_token=Probe-Garbage-Token" },
});
await post("/forgot-password", { email });
await post("/forgot-password", { email: "nobody@example.com" });
const resetToken = new URL(resets[0]!.reset_url).searchParams.get("token")!;
await post("/reset-password", { token: "Probe-Bad-Reset-Token", password: newPassword });
await post("/reset-password", { token: resetToken, password: newPassword });
await post("/logout", undefined, cookie);

const hashes = (await prisma.user.findMany({ select: { password_hash: true } })).map(
  (u) => u.password_hash,
);
const tokenHashes = (await prisma.passwordResetToken.findMany()).map((r) => r.token_hash);

await app.close();
await prisma.$disconnect();

process.stderr.write(
  `\n__SECRETS__${JSON.stringify({
    password,
    newPassword,
    wrongPassword: bad.password,
    jwt,
    garbageToken: "Probe-Garbage-Token",
    resetToken,
    badResetToken: "Probe-Bad-Reset-Token",
    hashes,
    tokenHashes,
    jwtSecret: JWT_SECRET,
  })}__END__\n`,
);
