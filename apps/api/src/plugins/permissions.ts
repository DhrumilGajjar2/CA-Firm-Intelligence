import type { FastifyRequest } from "fastify";
import type { UserRole } from "../generated/prisma/client.js";
import { AppError } from "../utils/app-error.js";

/**
 * Role-based access control (PRD §3). The backend enforces this independently of the frontend.
 *
 * Usage:
 *   app.get("/users", { preHandler: [app.authenticate, requireRole("owner", "manager")] }, handler)
 */
export function requireRole(...allowed: UserRole[]) {
  return async (request: FastifyRequest) => {
    if (!request.user) throw AppError.unauthenticated();
    if (!allowed.includes(request.user.role)) throw AppError.forbidden();
  };
}

/**
 * The firm every query must be scoped to. Always read it from the verified token — never from the
 * request body, params or query — so a user can never reach another firm's records.
 */
export function firmIdOf(request: FastifyRequest): string {
  if (!request.user) throw AppError.unauthenticated();
  return request.user.firm_id;
}
