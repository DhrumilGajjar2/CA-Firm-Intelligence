import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyReply } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { docsEnabled, type Env } from "./config/env.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { registerErrorHandling } from "./middleware/error-handler.js";
import { failure } from "./utils/response.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { firmRoutes } from "./modules/firms/firms.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { invitationRoutes } from "./modules/invitations/invitations.routes.js";
import { userRoutes } from "./modules/users/users.routes.js";
import { authenticationPlugin } from "./plugins/authentication.js";
import { databasePlugin } from "./plugins/database.js";
import { mailerPlugin, type Mailer } from "./plugins/mailer.js";

export const API_PREFIX = "/api/v1";

/** Log fields that must never reach a log line (cookies, credentials, request bodies). */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "req.body",
  "body.password",
  "body.token",
] as const;

/**
 * The invitation preview carries its secret token in the URL path (`GET /auth/invitations/:token`), so the
 * request logger must never print that segment.
 */
export function redactUrl(url: string): string {
  return url.replace(/^(\/api\/v1\/auth\/invitations\/)[^/?#]+/, "$1[REDACTED]");
}

export interface BuildAppOptions {
  env: Env;
  /** Inject a Prisma client (tests). */
  prisma?: PrismaClient;
  /** Inject a mailer (tests capture links). Missing methods fall back to the dev-only logging mailer. */
  mailer?: Partial<Mailer>;
}

export async function buildApp({ env, prisma, mailer }: BuildAppOptions) {
  const isProduction = env.NODE_ENV === "production";

  const app = Fastify({
    // Router-level failures (e.g. a path parameter longer than 100 chars) never reach the error handler:
    // answer them in the standard envelope, without echoing the path.
    frameworkErrors: (error, _request, reply) => {
      const res = reply as unknown as FastifyReply;
      if (error.code === "FST_ERR_MAX_PARAM_LENGTH") {
        return res.status(404).send(failure("NOT_FOUND", "Resource not found"));
      }
      return res.status(400).send(failure("BAD_REQUEST", "Bad request"));
    },
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            level: env.LOG_LEVEL,
            // PRD: no sensitive data in logs.
            redact: [...REDACT_PATHS],
            serializers: {
              req: (request: { method?: string; url?: string; host?: string; ip?: string }) => ({
                method: request.method,
                url: redactUrl(request.url ?? ""),
                host: request.host,
                remoteAddress: request.ip,
              }),
            },
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

  // Fastify's default JSON parser rejects an EMPTY body announced as `application/json` (400
  // FST_ERR_CTP_EMPTY_JSON_BODY), which is what curl -H, Postman and axios-in-Node send on body-less calls
  // such as POST /auth/logout and DELETE /invitations/:id. An empty or whitespace-only body is "no body"
  // (undefined): routes that need fields still fail schema validation (400 VALIDATION_ERROR). Non-empty
  // bodies go through Fastify's own parser unchanged (secure-json-parse: malformed JSON is 400, and
  // __proto__ / constructor poisoning is rejected); the body size limit still applies.
  const defaultJsonParser = app.getDefaultJsonParser("error", "error");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    if (typeof body === "string" && body.trim().length === 0) {
      done(null, undefined);
      return;
    }
    defaultJsonParser(req, body as string, done);
  });

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
        tags: [
          { name: "System", description: "Health and diagnostics" },
          {
            name: "Auth",
            description: "Registration, login, logout, current user, password reset and invitation acceptance",
          },
          { name: "Firms", description: "Current firm profile and settings" },
          {
            name: "Users",
            description: "Firm users, roles, activation, and inviting people to join",
          },
          { name: "Invitations", description: "Pending invitations: list and revoke" },
        ],
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
  await app.register(mailerPlugin, { mailer, isProduction });

  // All business routes live under /api/v1 (PRD §9). Feature modules register here as they are built.
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { frontendUrl: env.FRONTEND_URL });
      await api.register(firmRoutes);
      await api.register(userRoutes, { frontendUrl: env.FRONTEND_URL });
      await api.register(invitationRoutes, { frontendUrl: env.FRONTEND_URL });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
