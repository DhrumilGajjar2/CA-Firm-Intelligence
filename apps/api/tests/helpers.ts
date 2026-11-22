import { vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import type { PrismaClient, UserRole } from "../src/generated/prisma/client.js";
import type { Mailer } from "../src/plugins/mailer.js";

export const testEnv = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
});

/** A membership row as `app.authenticate` reads it. `null` means "no membership". */
export type FakeMembership = { role: UserRole; is_active: boolean } | null;

/**
 * Minimal stand-in for Prisma in unit-style tests (no database). Supports the health query and the
 * membership lookup that `app.authenticate` performs on every request.
 */
export function fakePrisma(
  queryRaw = vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  membership: FakeMembership = { role: "owner", is_active: true },
) {
  return {
    $queryRaw: queryRaw,
    $disconnect: vi.fn(),
    firmMember: { findUnique: vi.fn().mockResolvedValue(membership) },
  } as unknown as PrismaClient;
}

export async function makeApp(prisma: PrismaClient = fakePrisma(), mailer?: Mailer) {
  return buildApp({ env: testEnv, prisma, ...(mailer ? { mailer } : {}) });
}
