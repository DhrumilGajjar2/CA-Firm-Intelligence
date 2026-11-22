import { listInvitationsQuerySchema } from "@ca-firm/validation";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { firmIdOf, requireRole } from "../../plugins/permissions.js";
import {
  errorResponseSchema,
  success,
  successResponseSchema,
} from "../../utils/response.js";
import { invitationIdParamsSchema, invitationSchema } from "./invitations.schemas.js";
import { createInvitationsService } from "./invitations.service.js";

interface InvitationsRoutesOptions {
  frontendUrl: string;
}

/**
 * Invitation management (owner only). Creating an invitation is `POST /users/invite` (users module); the
 * public preview and accept endpoints are in the auth module. Responses never contain a token or its hash.
 * The firm comes from the verified session; another firm's invitation id is 404.
 */
export async function invitationRoutes(
  app: FastifyInstance,
  opts: InvitationsRoutesOptions,
) {
  const service = createInvitationsService({
    prisma: app.prisma,
    mailer: app.mailer,
    frontendUrl: opts.frontendUrl,
    log: app.log,
  });
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ownerOnly = requireRole("owner");
  const security = [{ cookieAuth: [] }];

  r.get(
    "/invitations",
    {
      onRequest: [app.authenticate, ownerOnly],
      schema: {
        tags: ["Invitations"],
        summary: "List the firm's invitations",
        description:
          "Owner only. Paginated (default 20, max 100), newest first. `status` filters by pending, accepted, revoked or expired (a pending invitation past its expiry is reported and filtered as expired).",
        security,
        querystring: listInvitationsQuerySchema,
        response: {
          200: successResponseSchema(z.array(invitationSchema)),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const query = request.query;
      const { invitations, total } = await service.list(firmIdOf(request), query);
      return success(invitations, "Invitations retrieved successfully", {
        page: query.page,
        limit: query.limit,
        total,
      });
    },
  );

  r.delete(
    "/invitations/:id",
    {
      onRequest: [app.authenticate, ownerOnly],
      schema: {
        tags: ["Invitations"],
        summary: "Revoke an invitation",
        description:
          "Owner only. Revokes a pending invitation and returns it with status `revoked`. 404 for an unknown id or another firm's invitation; 409 when it is not pending (accepted, revoked or expired).",
        security,
        params: invitationIdParamsSchema,
        response: {
          200: successResponseSchema(invitationSchema),
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const invitation = await service.revoke(firmIdOf(request), request.params.id);
      return success(invitation, "Invitation revoked");
    },
  );
}
