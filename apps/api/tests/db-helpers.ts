import type { LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type UserRole } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/modules/auth/password.js";
import type { Mailer } from "../src/plugins/mailer.js";
import { assertSafeTestDatabase, testDatabaseUrl } from "./support/db-guard.js";

/** True when TEST_DATABASE_URL is configured. DB-backed suites use `describe.skipIf(!hasTestDb)`. */
export const hasTestDb = Boolean(testDatabaseUrl());

export const DEFAULT_PASSWORD = "Sample-pass-1";
export const TEST_JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";
export const TEST_FRONTEND_URL = "http://localhost:3000";

function requireTestUrl(): string {
  const url = testDatabaseUrl();
  if (!url)
    throw new Error("TEST_DATABASE_URL is not set: DB-backed tests must be skipped.");
  assertSafeTestDatabase(url);
  return url;
}

export function createTestPrisma(): PrismaClient {
  const url = requireTestUrl();
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/**
 * Empties every table of the TEST database between tests. HARD GUARD: it asks PostgreSQL itself which
 * database it is connected to and refuses unless the name contains "test", so it can never wipe the
 * development database, even if a wrong client is passed in.
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const db = rows[0]?.db;
  if (!db || !/test/i.test(db)) {
    throw new Error(
      `resetDb refused: connected database "${db}" does not look like a test database.`,
    );
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename.replace(/"/g, '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Mailer that records messages instead of sending them. */
export class CapturingMailer implements Mailer {
  readonly resets: { to: string; reset_url: string }[] = [];
  readonly invitations: { to: string; invite_url: string; firm_name: string; role: string }[] =
    [];

  async sendInvitation(message: {
    to: string;
    invite_url: string;
    firm_name: string;
    role: string;
  }) {
    this.invitations.push(message);
  }

  /** The raw token from the most recent invitation link sent to `to`. */
  lastInviteToken(to: string): string | undefined {
    const message = [...this.invitations].reverse().find((m) => m.to === to);
    return message
      ? (new URL(message.invite_url).searchParams.get("token") ?? undefined)
      : undefined;
  }

  async sendPasswordReset(message: { to: string; reset_url: string }) {
    this.resets.push(message);
  }

  /** The raw token from the most recent reset link sent to `to`. */
  lastResetToken(to: string): string | undefined {
    const message = [...this.resets].reverse().find((m) => m.to === to);
    return message
      ? (new URL(message.reset_url).searchParams.get("token") ?? undefined)
      : undefined;
  }

  clear() {
    this.resets.length = 0;
    this.invitations.length = 0;
  }
}

/** The real app wired to the test database with a capturing mailer. */
export async function makeTestApp() {
  const url = requireTestUrl();
  const prisma = createTestPrisma();
  const mailer = new CapturingMailer();
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: url,
    JWT_SECRET: TEST_JWT_SECRET,
    FRONTEND_URL: TEST_FRONTEND_URL,
  });
  const app = await buildApp({ env, prisma, mailer });
  return {
    app,
    prisma,
    mailer,
    async close() {
      await app.close();
      await prisma.$disconnect();
    },
  };
}
export type TestApp = Awaited<ReturnType<typeof makeTestApp>>;

/** `access_token=...` ready to send as a Cookie header, or undefined when no cookie was set. */
export function cookieOf(res: LightMyRequestResponse): string | undefined {
  const raw = res.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const pair = header?.split(";")[0];
  return pair && !pair.endsWith("=") ? pair : undefined;
}

export interface RegisteredOwner {
  cookie: string;
  email: string;
  password: string;
  user: { id: string; email: string; role: UserRole; firm: { id: string } };
}

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Registers a firm + owner through the real endpoint and returns the session cookie. */
export async function registerOwner(
  t: Pick<TestApp, "app">,
  overrides: Partial<{
    name: string;
    email: string;
    password: string;
    firm_name: string;
  }> = {},
): Promise<RegisteredOwner> {
  const email = overrides.email ?? `owner-${unique()}@example.com`;
  const password = overrides.password ?? DEFAULT_PASSWORD;
  const res = await t.app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      name: overrides.name ?? "Test Owner",
      email,
      password,
      firm_name: overrides.firm_name ?? "Test CA Associates",
    },
  });
  if (res.statusCode !== 201) throw new Error(`registerOwner failed: ${res.statusCode}`);
  const cookie = cookieOf(res);
  if (!cookie) throw new Error("registerOwner: no auth cookie was set");
  return { cookie, email, password, user: res.json().data };
}

/** Inserts a member (with a really hashed password) directly in the DB; returns the user id. */
export async function createMember(
  prisma: PrismaClient,
  opts: {
    firm_id: string;
    role: UserRole;
    email?: string;
    password?: string;
    name?: string;
    is_active?: boolean;
  },
): Promise<{ id: string; email: string; password: string }> {
  const email = opts.email ?? `${opts.role}-${unique()}@example.com`;
  const password = opts.password ?? DEFAULT_PASSWORD;
  const user = await prisma.user.create({
    data: {
      email,
      name: opts.name ?? `Test ${opts.role}`,
      password_hash: await hashPassword(password),
      memberships: {
        create: {
          firm_id: opts.firm_id,
          role: opts.role,
          is_active: opts.is_active ?? true,
        },
      },
    },
  });
  return { id: user.id, email, password };
}

/** Logs in through the real endpoint and returns the session cookie. */
export async function loginCookie(
  t: Pick<TestApp, "app">,
  email: string,
  password = DEFAULT_PASSWORD,
): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  const cookie = cookieOf(res);
  if (res.statusCode !== 200 || !cookie)
    throw new Error(`loginCookie failed: ${res.statusCode}`);
  return cookie;
}
