import { vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";

export const testEnv = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
});

export function fakePrisma(queryRaw = vi.fn().mockResolvedValue([{ "?column?": 1 }])) {
  return { $queryRaw: queryRaw, $disconnect: vi.fn() } as unknown as PrismaClient;
}

export async function makeApp(prisma: PrismaClient = fakePrisma()) {
  return buildApp({ env: testEnv, prisma });
}
