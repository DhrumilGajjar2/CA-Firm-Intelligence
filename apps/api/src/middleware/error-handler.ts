import type { FastifyError, FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";
import { AppError } from "../utils/app-error.js";
import { failure } from "../utils/response.js";

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
};

/** Every error leaves the API in the PRD §9.1 shape. Internal details are logged, never returned. */
export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(
        failure(
          "NOT_FOUND",
          `Route ${request.method} ${request.url.split("?")[0]} not found`,
        ),
      );
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(failure(error.code, error.message, error.errors));
    }

    if (
      hasZodFastifySchemaValidationErrors(error) ||
      (error as FastifyError).validation
    ) {
      const issues = (error as FastifyError).validation ?? [];
      const errors = issues.map((issue) => ({
        field:
          (issue.instancePath ?? "").replace(/^\//, "").replace(/\//g, ".") || undefined,
        message: issue.message ?? "Invalid value",
      }));
      return reply
        .status(400)
        .send(failure("VALIDATION_ERROR", "Validation failed", errors));
    }

    const fastifyError = error as FastifyError;

    // Missing/invalid/expired JWT from @fastify/jwt.
    if (
      typeof fastifyError.code === "string" &&
      fastifyError.code.startsWith("FST_JWT")
    ) {
      return reply
        .status(401)
        .send(failure("UNAUTHENTICATED", "Authentication required"));
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, "Response did not match its schema");
      return reply.status(500).send(failure("INTERNAL_ERROR", "Internal server error"));
    }

    const status = fastifyError.statusCode;
    if (status && status >= 400 && status < 500) {
      return reply
        .status(status)
        .send(failure(STATUS_CODES[status] ?? "REQUEST_ERROR", fastifyError.message));
    }

    request.log.error({ err: error }, "Unhandled error");
    return reply.status(500).send(failure("INTERNAL_ERROR", "Internal server error"));
  });
}
