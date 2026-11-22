import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasTestDb } from "./db-helpers.js";

/**
 * Gate item: "no secrets or passwords in logs". logging.test.ts only checks the redaction list in
 * isolation; this test runs the real app in a child process (production mode, debug level, so the real
 * pino JSON logs go to stdout) while it handles every slice-1 auth request with recognisable secrets,
 * then greps the captured logs.
 */
describe.skipIf(!hasTestDb)("real server logs never contain secrets", () => {
  it("passwords, JWTs, reset tokens, token hashes and password hashes are absent from stdout/stderr logs", () => {
    const probe = path.resolve(__dirname, "support", "log-probe.ts");
    const child = spawnSync(process.execPath, ["--import", "tsx", probe], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 90_000,
    });
    expect(child.status, `probe failed:\n${child.stderr}`).toBe(0);

    const match = /__SECRETS__(.*?)__END__/s.exec(child.stderr);
    expect(match, "probe did not report its secrets").not.toBeNull();
    const secrets = JSON.parse(match![1]!) as Record<string, string | string[]>;
    const stdout = child.stdout;
    const stderrLogs = child.stderr.replace(/__SECRETS__.*?__END__/s, "");

    // Sanity: the logger really was active (otherwise the absence checks prove nothing).
    expect(stdout).toContain('"msg":"incoming request"');
    expect(stdout).toContain("/api/v1/auth/login");
    expect(stdout).toContain("/api/v1/auth/reset-password");
    expect(stdout.split("\n").filter(Boolean).length).toBeGreaterThan(20);

    const forbidden: [string, string][] = [];
    for (const [name, value] of Object.entries(secrets)) {
      for (const v of Array.isArray(value) ? value : [value]) forbidden.push([name, v]);
    }
    expect(forbidden.length).toBeGreaterThan(8);
    for (const [name, value] of forbidden) {
      expect(stdout, `stdout leaks ${name}`).not.toContain(value);
      expect(stderrLogs, `stderr leaks ${name}`).not.toContain(value);
    }
    // Structural leaks, whatever the values were.
    expect(stdout).not.toMatch(/\$argon2/);
    expect(stdout).not.toMatch(/password_hash/i);
    expect(stdout).not.toMatch(/"password"\s*:/i);
    expect(stdout).not.toMatch(/set-cookie/i);
    expect(stdout).not.toMatch(/access_token=/i);
    expect(stdout).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // any JWT-looking string
    expect(stdout).not.toMatch(/reset-password\?token=/);
  }, 120_000);
});
