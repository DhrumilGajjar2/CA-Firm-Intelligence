import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  errorResponseSchema,
  failure,
  success,
  successResponseSchema,
} from "../../utils/response.js";

const healthDataSchema = z.object({
  status: z.literal("ok"),
  database: z.literal("up"),
  uptime_seconds: z.number(),
  timestamp: z.string(),
});

export async function healthRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/health",
    {
      schema: {
        tags: ["System"],
        summary: "Health check",
        description:
          "Confirms the API is running and can reach PostgreSQL. Public — no authentication.",
        response: {
          200: successResponseSchema(healthDataSchema),
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await app.prisma.$queryRaw`SELECT 1`;
      } catch (err) {
        request.log.error({ err }, "Database health check failed");
        return reply
          .status(503)
          .send(failure("SERVICE_UNAVAILABLE", "Database is not reachable"));
      }

      return success(
        {
          status: "ok" as const,
          database: "up" as const,
          uptime_seconds: Math.round(process.uptime()),
          timestamp: new Date().toISOString(),
        },
        "API is healthy",
      );
    },
  );
}
