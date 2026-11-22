import {
  inviteUserSchema,
  listUsersQuerySchema,
  updateUserRoleSchema,
  updateUserSchema,
  updateUserStatusSchema,
} from "@ca-firm/validation";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { firmIdOf, requireRole } from "../../plugins/permissions.js";
import {
  errorResponseSchema,
  success,
  successResponseSchema,
} from "../../utils/response.js";
import { createdInvitationSchema } from "../invitations/invitations.schemas.js";
import { createInvitationsService } from "../invitations/invitations.service.js";
import { firmUserSchema, userIdParamsSchema } from "./users.schemas.js";
import { createUsersService, type Actor } from "./users.service.js";

interface UsersRoutesOptions {
  frontendUrl: string;
}

const actorOf = (request: FastifyRequest): Actor => ({
  id: request.user.sub,
  firm_id: firmIdOf(request),
  role: request.user.role,
});

/**
 * Users of the current firm and invitation creation. The firm always comes from the verified session.
 * Authentication and the role check run in `onRequest` (before the body is parsed): 401, then 403, then 400.
 * `GET /users/:id` and `PATCH /users/:id` have an id-dependent rule (own id), so they check it in the
 * service after the existence check: another firm's id is 404 for every role.
 */
export async function userRoutes(app: FastifyInstance, opts: UsersRoutesOptions) {
  const users = createUsersService({ prisma: app.prisma });
  const invitations = createInvitationsService({
    prisma: app.prisma,
    mailer: app.mailer,
    frontendUrl: opts.frontendUrl,
    log: app.log,
  });
  const r = app.withTypeProvider<ZodTypeProvider>();
  const everyRole = requireRole("owner", "manager", "employee", "viewer");
  const ownerOrManager = requireRole("owner", "manager");
  const ownerOnly = requireRole("owner");
  const security = [{ cookieAuth: [] }];

  r.get(
    "/users",
    {
      onRequest: [app.authenticate, ownerOrManager],
      schema: {
        tags: ["Users"],
        summary: "List the firm's users",
        description:
          "Owner and manager. Paginated (default 20, max 100); `search` matches name or email (case-insensitive, wildcards are literal); filter by `role` and `status`. Sorted by name, then created_at.",
        security,
        querystring: listUsersQuerySchema,
        response: {
          200: successResponseSchema(z.array(firmUserSchema)),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const query = request.query;
      const { users: rows, total } = await users.list(firmIdOf(request), query);
      return success(rows, "Users retrieved successfully", {
        page: query.page,
        limit: query.limit,
        total,
      });
    },
  );

  r.post(
    "/users/invite",
    {
      onRequest: [app.authenticate, ownerOnly],
      schema: {
        tags: ["Users"],
        summary: "Invite a user",
        description:
          "Owner only. Roles: manager, employee, viewer (never owner). The invitation expires in 7 days. `invite_url` carries the raw token and is returned only here, once. 409 if the email is already a member of the firm or has a pending, unexpired invitation.",
        security,
        body: inviteUserSchema,
        response: {
          201: successResponseSchema(createdInvitationSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await invitations.invite(
        firmIdOf(request),
        request.user.sub,
        request.body,
      );
      return reply.status(201).send(success(created, "Invitation created"));
    },
  );

  r.get(
    "/users/:id",
    {
      onRequest: [app.authenticate, everyRole],
      schema: {
        tags: ["Users"],
        summary: "Get a user",
        description:
          "Owner and manager: any user of the firm. Employee and viewer: only their own id (403 otherwise). A user id of another firm is 404 for every role.",
        security,
        params: userIdParamsSchema,
        response: {
          200: successResponseSchema(firmUserSchema),
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const user = await users.get(actorOf(request), request.params.id);
      return success(user, "User retrieved successfully");
    },
  );

  r.patch(
    "/users/:id",
    {
      onRequest: [app.authenticate, everyRole],
      schema: {
        tags: ["Users"],
        summary: "Update a user's name",
        description:
          "Name only. Owner: any user of the firm. Manager, employee, viewer: only their own id (403 otherwise). Other fields in the body are ignored.",
        security,
        params: userIdParamsSchema,
        body: updateUserSchema,
        response: {
          200: successResponseSchema(firmUserSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const user = await users.updateName(
        actorOf(request),
        request.params.id,
        request.body.name,
      );
      return success(user, "User updated successfully");
    },
  );

  r.patch(
    "/users/:id/role",
    {
      onRequest: [app.authenticate, ownerOnly],
      schema: {
        tags: ["Users"],
        summary: "Change a user's role",
        description:
          "Owner only. The new role is manager, employee or viewer (never owner). The owner and the caller cannot be changed (403). Takes effect on the user's very next request.",
        security,
        params: userIdParamsSchema,
        body: updateUserRoleSchema,
        response: {
          200: successResponseSchema(firmUserSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const user = await users.changeRole(
        actorOf(request),
        request.params.id,
        request.body.role,
      );
      return success(user, "User role updated successfully");
    },
  );

  r.patch(
    "/users/:id/status",
    {
      onRequest: [app.authenticate, ownerOnly],
      schema: {
        tags: ["Users"],
        summary: "Deactivate or reactivate a user",
        description:
          "Owner only. The owner and the caller cannot be changed (403). A deactivated user cannot log in and their existing session stops working immediately (401); reactivation restores access.",
        security,
        params: userIdParamsSchema,
        body: updateUserStatusSchema,
        response: {
          200: successResponseSchema(firmUserSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const user = await users.changeStatus(
        actorOf(request),
        request.params.id,
        request.body.is_active,
      );
      return success(user, "User status updated successfully");
    },
  );
}
