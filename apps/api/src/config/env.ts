import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Auth (PRD FR-01): JWT stored in an httpOnly cookie.
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  COOKIE_NAME: z.string().default("access_token"),

  // CORS: the Next.js app origin (PRD §17: localhost:3000 in development).
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),

  // Swagger UI at /docs. Defaults to on outside production.
  ENABLE_DOCS: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  // Used from later phases (imports, background jobs). Optional in P0.
  REDIS_URL: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // Never print values: they may contain secrets.
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

export function docsEnabled(env: Env): boolean {
  return env.ENABLE_DOCS ?? env.NODE_ENV !== "production";
}
