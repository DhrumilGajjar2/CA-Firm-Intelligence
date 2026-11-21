import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { docsEnabled, type Env } from "./config/env.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { registerErrorHandling } from "./middleware/error-handler.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { authenticationPlugin } from "./plugins/authentication.js";
import { databasePlugin } from "./plugins/database.js";

export const API_PREFIX = "/api/v1";

export interface BuildAppOptions {
  env: Env;
  /** Inject a Prisma client (tests). */
  prisma?: PrismaClient;
}

export async function buildApp({ env, prisma }: BuildAppOptions) {
  const isProduction = env.NODE_ENV === "production";

  const app = Fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            level: env.LOG_LEVEL,
            // PRD: no sensitive data in logs.
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers['set-cookie']",
            ],
            ...(isProduction
              ? {}
              : {
                  transport: {
                    target: "pino-pretty",
                    options: { translateTime: "HH:MM:ss" },
                  },
                }),
          },
  }).withTypeProvider<ZodTypeProvider>();

  // Zod drives request validation, response serialization and OpenAPI generation.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandling(app);

  await app.register(helmet);
  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  if (docsEnabled(env)) {
    await app.register(swagger, {
      openapi: {
        openapi: "3.0.3",
        info: {
          title: "CA Firm Intelligence API",
          description:
            "REST API for CA Firm Intelligence. All responses use the standard envelope: `{ success, message, data, meta }` or `{ success: false, message, code, errors }`.",
          version: "0.1.0",
        },
        servers: [
          { url: `http://localhost:${env.PORT}`, description: "Local development" },
        ],
        components: {
          securitySchemes: {
            cookieAuth: { type: "apiKey", in: "cookie", name: env.COOKIE_NAME },
          },
        },
        tags: [{ name: "System", description: "Health and diagnostics" }],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  await app.register(databasePlugin, { databaseUrl: env.DATABASE_URL, prisma });
  await app.register(authenticationPlugin, {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    cookieName: env.COOKIE_NAME,
    isProduction,
  });

  // All business routes live under /api/v1 (PRD §9). Feature modules register here as they are built.
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
