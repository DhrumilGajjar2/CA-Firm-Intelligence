import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasTestDb } from "./db-helpers.js";

/**
 * Gate item "no secrets in logs" for slice 3: the REAL server (real log mailer, real pino output) in a child
 * process handles invite, preview, accept, login, users and invitation requests with recognisable secrets,
 * then the captured stdout/stderr is searched.
 */
function runProbe(mode: "production" | "development") {
  const probe = path.resolve(__dirname, "support", "log-probe-slice3.ts");
  const child = spawnSync(process.execPath, ["--import", "tsx", probe], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, NODE_ENV: mode, PROBE_MODE: mode },
    encoding: "utf8",
    timeout: 150_000,
  });
  expect(child.status, `probe failed:\n${child.stderr}`).toBe(0);
  const match = /__SECRETS__(.*?)__END__/s.exec(child.stderr);
  expect(match, "probe did not report its secrets").not.toBeNull();
  const secrets = JSON.parse(match![1]!) as Record<string, string | string[]>;
  const logs = `${child.stdout}\n${child.stderr.replace(/__SECRETS__.*?__END__/s, "")}`;
  return { secrets, stdout: child.stdout, logs };
}

const flat = (secrets: Record<string, string | string[]>, skip: string[] = []) => {
  const out: [string, string][] = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (skip.includes(name)) continue;
    for (const v of Array.isArray(value) ? value : [value]) out.push([name, v]);
  }
  return out;
};

describe.skipIf(!hasTestDb)("slice 3: real server logs never contain secrets", () => {
  it("production: no invitation token (raw or hashed), invite_url, password, hash, JWT or invitee address appears; the preview path is redacted", () => {
    const { secrets, stdout, logs } = runProbe("production");
    // the logger really ran and saw the slice-3 traffic
    expect(stdout).toContain('"msg":"incoming request"');
    expect(stdout).toContain("/api/v1/users/invite");
    expect(stdout).toContain("/api/v1/auth/accept-invitation");
    expect(stdout).toContain("/api/v1/invitations");
    expect(stdout.split("\n").filter(Boolean).length).toBeGreaterThan(40);
    // the preview requests are logged with the token segment redacted
    expect(stdout).toContain("/api/v1/auth/invitations/[REDACTED]");
    expect(stdout).not.toMatch(/\/auth\/invitations\/(?!\[REDACTED\])[A-Za-z0-9_-]{10,}/);

    const forbidden = flat(secrets);
    expect(forbidden.length).toBeGreaterThan(12);
    for (const [name, value] of forbidden) {
      expect(logs, `logs leak ${name}`).not.toContain(value);
    }
    expect(logs).not.toMatch(/accept-invitation\?token/);
    expect(logs).not.toMatch(/\$argon2/);
    expect(logs).not.toMatch(/password_hash|token_hash/i);
    expect(logs).not.toMatch(/"password"\s*:/i);
    expect(logs).not.toMatch(/set-cookie|access_token=/i);
    expect(logs).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    expect(logs).not.toContain("DEV MAILER");
  }, 200_000);

  it("development: the dev mailer prints the link ONCE by design (documented decision 5); passwords, hashes, JWTs and token hashes still never appear", () => {
    const { secrets, logs } = runProbe("development");
    const token = secrets["token"] as string;
    expect(logs).toContain("DEV MAILER: invitation link");
    // the raw token is in the dev mailer line only (invite_url), never in a request line
    const occurrences = logs.split(token).length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);
    expect(logs).toContain("/api/v1/auth/invitations/[REDACTED]");

    const forbidden = flat(secrets, ["token", "secondToken", "inviteUrl", "inviteeEmail"]);
    for (const [name, value] of forbidden) {
      expect(logs, `dev logs leak ${name}`).not.toContain(value);
    }
    // the second invitation's link is also only in its dev mailer line, and never after its revocation
    expect(logs.split(secrets["secondToken"] as string).length - 1).toBeLessThanOrEqual(1);
    expect(logs).not.toMatch(/\$argon2/);
    expect(logs).not.toMatch(/password_hash|token_hash/i);
    expect(logs).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
  }, 200_000);
});
