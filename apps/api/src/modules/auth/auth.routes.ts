import {
  acceptInvitationSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@ca-firm/validation";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { firmIdOf } from "../../plugins/permissions.js";
import {
  errorResponseSchema,
  success,
  successResponseSchema,
} from "../../utils/response.js";
import { invitationPreviewSchema } from "../invitations/invitations.schemas.js";
import { currentUserSchema } from "./auth.schemas.js";
import { createAuthService } from "./auth.service.js";

interface AuthRoutesOptions {
  frontendUrl: string;
}

const nullData = successResponseSchema(z.null());

/**
 * Auth endpoints. Request bodies hold passwords and tokens: nothing here logs them, and the
 * services never return the password hash or a reset token.
 */
export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions) {
  const service = createAuthService({
    prisma: app.prisma,
    mailer: app.mailer,
    frontendUrl: opts.frontendUrl,
    log: app.log,
  });
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/auth/register",
    {
      schema: {
        tags: ["Auth"],
        summary: "Register a firm and its owner",
        description:
          "Creates the user, the firm (default settings) and the owner membership in one transaction, then signs the user in (httpOnly cookie).",
        body: registerSchema,
        response: {
          201: successResponseSchema(currentUserSchema),
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await service.register(request.body);
      await app.issueAuthCookie(reply, session.claims);
      return reply.status(201).send(success(session.user, "Registration successful"));
    },
  );

  r.post(
    "/auth/login",
    {
      schema: {
        tags: ["Auth"],
        summary: "Log in",
        description:
          "Sets the httpOnly `access_token` cookie. Unknown email, wrong password and inactive users all return the same 401.",
        body: loginSchema,
        response: {
          200: successResponseSchema(currentUserSchema),
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await service.login(request.body);
      await app.issueAuthCookie(reply, session.claims);
      return success(session.user, "Login successful");
    },
  );

  r.post(
    "/auth/logout",
    {
      schema: {
        tags: ["Auth"],
        summary: "Log out",
        description:
          "Clears the auth cookie. Idempotent: always 200, with or without a session.",
        response: { 200: nullData },
      },
    },
    async (_request, reply) => {
      app.clearAuthCookie(reply);
      return success(null, "Logged out");
    },
  );

  r.get(
    "/auth/me",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["Auth"],
        summary: "Current user",
        description:
          "The signed-in user, their role and firm. Roles: owner, manager, employee, viewer.",
        security: [{ cookieAuth: [] }],
        response: {
          200: successResponseSchema(currentUserSchema),
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const user = await service.currentUser(request.user.sub, firmIdOf(request));
      return success(user, "Current user retrieved successfully");
    },
  );

  r.post(
    "/auth/forgot-password",
    {
      schema: {
        tags: ["Auth"],
        summary: "Request a password reset link",
        description:
          "Always returns the same 200 message, whether or not the email is registered.",
        body: forgotPasswordSchema,
        response: { 200: nullData, 400: errorResponseSchema },
      },
    },
    async (request) => {
      await service.forgotPassword(request.body.email);
      return success(null, "If an account exists, a reset link has been sent");
    },
  );

  r.post(
    "/auth/reset-password",
    {
      schema: {
        tags: ["Auth"],
        summary: "Reset a password with a token",
        description:
          "The token is single-use and expires after 1 hour. Does not log the user in.",
        body: resetPasswordSchema,
        response: { 200: nullData, 400: errorResponseSchema },
      },
    },
    async (request) => {
      await service.resetPassword(request.body);
      return success(null, "Password has been reset");
    },
  );

  r.get(
    "/auth/invitations/:token",
    {
      schema: {
        tags: ["Auth"],
        summary: "Preview an invitation",
        description:
          "Public. Shows the invited email, role, firm name and expiry for the accept-invitation page. Unknown, expired, revoked and already accepted tokens all return the same generic 404.",
        params: z.object({ token: z.string().min(1).max(512) }),
        response: {
          200: successResponseSchema(invitationPreviewSchema),
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const preview = await service.previewInvitation(request.params.token);
      return success(preview, "Invitation retrieved successfully");
    },
  );

  r.post(
    "/auth/accept-invitation",
    {
      schema: {
        tags: ["Auth"],
        summary: "Accept an invitation",
        description:
          "Public. In one transaction creates the user (email from the invitation) and the firm membership with the invited role and marks the invitation accepted, then signs the user in (httpOnly cookie). Invalid, expired, revoked or used token: 404. Email already registered: 409.",
        body: acceptInvitationSchema,
        response: {
          201: successResponseSchema(currentUserSchema),
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await service.acceptInvitation(request.body);
      await app.issueAuthCookie(reply, session.claims);
      return reply.status(201).send(success(session.user, "Invitation accepted"));
    },
  );
}
