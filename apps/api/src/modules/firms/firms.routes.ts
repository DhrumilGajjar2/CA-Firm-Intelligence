import { updateFirmSchema, updateFirmSettingsSchema } from "@ca-firm/validation";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { firmIdOf, requireRole } from "../../plugins/permissions.js";
import {
  errorResponseSchema,
  success,
  successResponseSchema,
} from "../../utils/response.js";
import { firmProfileSchema, firmSettingsSchema } from "./firms.schemas.js";
import { createFirmsService } from "./firms.service.js";

/**
 * Current-firm endpoints. There is no firm id in any path, body or query: the firm is always the one
 * in the verified session. Reads: every role. Writes: owner only.
 *
 * Authentication and role checks run in the `onRequest` hook, which fires BEFORE the body is parsed, so an
 * anonymous or forbidden caller always gets 401/403 (never a 400/415 about the body). Order: 401, 403, 400/415.
 */
export async function firmRoutes(app: FastifyInstance) {
  const service = createFirmsService({ prisma: app.prisma });
  const r = app.withTypeProvider<ZodTypeProvider>();
  const everyRole = requireRole("owner", "manager", "employee", "viewer");
  const ownerOnly = requireRole("owner");

  r.get(
    "/firms/current",
    {
      onRequest: [app.authenticate, everyRole],
      schema: {
        tags: ["Firms"],
        summary: "Current firm profile",
        description:
          "The signed-in user's firm. Roles: owner, manager, employee, viewer.",
        security: [{ cookieAuth: [] }],
        response: {
          200: successResponseSchema(firmProfileSchema),
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const firm = await service.getProfile(firmIdOf(request));
      return success(firm, "Firm retrieved successfully");
    },
  );

  r.patch(
    "/firms/current",
    {
      onRequest: [app.authenticate, ownerOnly],
      schema: {
        tags: ["Firms"],
        summary: "Update the firm profile",
        description:
          "Owner only. Partial update of name, address, email, phone and timezone (IANA); at least one field. An empty string clears address, email or phone. Unknown fields (including `id` / `firm_id`) are ignored.",
        security: [{ cookieAuth: [] }],
        body: updateFirmSchema,
        response: {
          200: successResponseSchema(firmProfileSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const firm = await service.updateProfile(firmIdOf(request), request.body);
      return success(firm, "Firm updated successfully");
    },
  );

  r.get(
    "/firms/current/settings",
    {
      onRequest: [app.authenticate, everyRole],
      schema: {
        tags: ["Firms"],
        summary: "Current firm settings",
        description:
          "Defaults apply for missing keys: financial_year_start_month 4, onboarding_completed false. Roles: owner, manager, employee, viewer.",
        security: [{ cookieAuth: [] }],
        response: {
          200: successResponseSchema(firmSettingsSchema),
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const settings = await service.getSettings(firmIdOf(request));
      return success(settings, "Firm settings retrieved successfully");
    },
  );

  r.patch(
    "/firms/current/settings",
    {
      onRequest: [app.authenticate, ownerOnly],
      schema: {
        tags: ["Firms"],
        summary: "Update the firm settings",
        description:
          "Owner only. Partial update: only the provided keys change and unknown stored keys are kept. `financial_year_start_month` is 1-12. `onboarding_completed` can only be set to `true`; `false` is a 400 VALIDATION_ERROR.",
        security: [{ cookieAuth: [] }],
        body: updateFirmSettingsSchema,
        response: {
          200: successResponseSchema(firmSettingsSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const settings = await service.updateSettings(firmIdOf(request), request.body);
      return success(settings, "Firm settings updated successfully");
    },
  );
}
