/**
 * Child-process probe for tests/slice3-logs.test.ts. Builds the REAL app (real log mailer: no injected mailer)
 * against the test database in the mode given by PROBE_MODE (production | development), drives the
 * slice-3 endpoints (invite, preview, accept, login, users, invitations) with recognisable secrets and prints
 * the secrets as JSON on STDERR. The parent test greps the captured STDOUT (the real logs).
 */
import { createHash } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createTestPrisma, resetDb } from "../db-helpers.js";

const url = process.env["TEST_DATABASE_URL"];
if (!url) throw new Error("TEST_DATABASE_URL is required");
const mode = process.env["PROBE_MODE"] === "development" ? "development" : "production";
const JWT_SECRET = "probe3-jwt-secret-that-is-at-least-32-characters-long";

const prisma = createTestPrisma();
await resetDb(prisma);
const app = await buildApp({
  env: loadEnv({
    NODE_ENV: mode,
    LOG_LEVEL: "debug",
    DATABASE_URL: url,
    JWT_SECRET,
    FRONTEND_URL: "http://localhost:3000",
  }),
  prisma,
});

const ownerEmail = "probe3.owner@example.com";
const ownerPassword = "Probe3-Owner-Secret-11";
const inviteeEmail = "probe3.invitee@example.com";
const inviteePassword = "Probe3-Invitee-Secret-22";
const badPassword = "Probe3-Bad-Secret-33";
const badToken = "Probe3-Bad-Invite-Token-xyz";
const longToken = "Probe3L".repeat(25);

const req = (method: string, path: string, opts: { payload?: unknown; cookie?: string } = {}) =>
  app.inject({
    method: method as "GET",
    url: `/api/v1${path}`,
    ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
    ...(opts.cookie ? { headers: { cookie: opts.cookie } } : {}),
  });

const reg = await req("POST", "/auth/register", {
  payload: { name: "Probe Owner", email: ownerEmail, password: ownerPassword, firm_name: "Probe Three Firm" },
});
const ownerCookie = String(reg.headers["set-cookie"]).split(";")[0]!;
const ownerJwt = ownerCookie.replace("access_token=", "");

const invite = await req("POST", "/users/invite", { cookie: ownerCookie, payload: { email: inviteeEmail, role: "manager" } });
const inviteUrl = invite.json().data.invite_url as string;
const token = new URL(inviteUrl).searchParams.get("token")!;
const invitationId = invite.json().data.id as string;
await req("POST", "/users/invite", { cookie: ownerCookie, payload: { email: inviteeEmail, role: "manager" } }); // 409

await req("GET", `/auth/invitations/${token}`);
await req("GET", `/auth/invitations/${token}`); // twice
await req("GET", `/auth/invitations/${badToken}`);
await req("GET", `/auth/invitations/${longToken}`);
await req("GET", `/auth/invitations/${token}/extra`); // unknown route containing the token
await req("POST", "/auth/accept-invitation", { payload: { token, name: "Probe Invitee", password: badPassword.slice(0, 5) } }); // 400
const accepted = await req("POST", "/auth/accept-invitation", { payload: { token, name: "Probe Invitee", password: inviteePassword } });
const inviteeCookie = String(accepted.headers["set-cookie"]).split(";")[0]!;
const inviteeJwt = inviteeCookie.replace("access_token=", "");
await req("POST", "/auth/accept-invitation", { payload: { token, name: "Probe Invitee", password: inviteePassword } }); // 404
await req("POST", "/auth/login", { payload: { email: inviteeEmail, password: inviteePassword } });
await req("POST", "/auth/login", { payload: { email: inviteeEmail, password: badPassword } });
const inviteeId = accepted.json().data.id as string;

await req("GET", "/users?limit=5", { cookie: ownerCookie });
await req("GET", "/invitations", { cookie: ownerCookie });
await req("GET", `/users/${inviteeId}`, { cookie: inviteeCookie });
await req("PATCH", `/users/${inviteeId}`, { cookie: inviteeCookie, payload: { name: "Probe Renamed" } });
await req("PATCH", `/users/${inviteeId}/role`, { cookie: ownerCookie, payload: { role: "viewer" } });
await req("PATCH", `/users/${inviteeId}/status`, { cookie: ownerCookie, payload: { is_active: false } });
await req("GET", "/users", { cookie: inviteeCookie }); // 401 (deactivated)
await req("DELETE", `/invitations/${invitationId}`, { cookie: ownerCookie }); // 409
const second = await req("POST", "/users/invite", { cookie: ownerCookie, payload: { email: "probe3.second@example.com", role: "viewer" } });
const secondToken = new URL(second.json().data.invite_url).searchParams.get("token")!;
await req("DELETE", `/invitations/${second.json().data.id}`, { cookie: ownerCookie }); // revoke
await req("GET", `/auth/invitations/${secondToken}`); // 404 after revoke

const hashes = (await prisma.user.findMany({ select: { password_hash: true } })).map((u) => u.password_hash);
const tokenHashes = (await prisma.invitation.findMany({ select: { token_hash: true } })).map((i) => i.token_hash);
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

await new Promise((r) => setTimeout(r, 800)); // let the (pretty) log transport flush
await app.close();
await prisma.$disconnect();

process.stderr.write(
  `\n__SECRETS__${JSON.stringify({
    token,
    secondToken,
    tokenSha: sha(token),
    tokenHashes,
    inviteUrl,
    ownerPassword,
    inviteePassword,
    badPassword,
    badToken,
    longToken,
    ownerJwt,
    inviteeJwt,
    hashes,
    jwtSecret: JWT_SECRET,
    inviteeEmail,
  })}__END__\n`,
);
