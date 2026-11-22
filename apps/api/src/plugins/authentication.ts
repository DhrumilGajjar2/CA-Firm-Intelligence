import fastifyCookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "../generated/prisma/client.js";
import { AppError } from "../utils/app-error.js";

/**
 * Authentication architecture (decided in P0, implemented in P1):
 *  - Login issues a signed JWT, delivered ONLY in an httpOnly cookie (never readable by frontend JS).
 *  - Payload carries just what authorization needs: user id, firm id and role.
 *  - Every protected route uses `onRequest: [app.authenticate, requireRole(...)]` (before body parsing, so the
 *    order is 401, 403, then 400/415); firm scoping always comes from the
 *    token (`request.user.firm_id`), never from client-supplied input.
 *  - Role checks live in plugins/permissions.ts.
 *  - On EVERY request the membership is re-read from the database (it must exist and be active) and
 *    `request.user.role` is the DATABASE role, not the role inside the token. Deactivation and role
 *    changes therefore apply immediately even though the JWT itself stays valid until it expires.
 */
export interface AuthUser {
  /** User id */
  sub: string;
  firm_id: string;
  role: UserRole;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Sign a token and set it as the auth cookie. Used by login / invitation-accept in P1. */
    issueAuthCookie: (reply: FastifyReply, user: AuthUser) => Promise<void>;
    clearAuthCookie: (reply: FastifyReply) => void;
  }
}

interface AuthOptions {
  jwtSecret: string;
  jwtExpiresIn: string;
  cookieName: string;
  isProduction: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Converts "8h" / "15m" / "7d" / "3600" into seconds for the cookie Max-Age. */
function toSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return 8 * 3600;
  const n = Number(match[1]);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] ?? "s"] ?? 1;
  return n * unit;
}

export const authenticationPlugin = fp<AuthOptions>(
  async (app, opts) => {
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, {
      secret: opts.jwtSecret,
      cookie: { cookieName: opts.cookieName, signed: false },
      sign: { expiresIn: opts.jwtExpiresIn },
    });

    const cookieOptions = {
      path: "/",
      httpOnly: true,
      secure: opts.isProduction,
      sameSite: "lax" as const,
    };

    app.decorate("authenticate", async (request: FastifyRequest) => {
      let payload: AuthUser;
      try {
        payload = await request.jwtVerify<AuthUser>();
      } catch {
        throw AppError.unauthenticated();
      }
      // Claims must be real strings: String([uuid]) would otherwise pass the UUID test and reach Prisma.
      if (
        typeof payload.sub !== "string" ||
        typeof payload.firm_id !== "string" ||
        !UUID_RE.test(payload.sub) ||
        !UUID_RE.test(payload.firm_id)
      ) {
        throw AppError.unauthenticated();
      }

      const membership = await app.prisma.firmMember.findUnique({
        where: { firm_id_user_id: { firm_id: payload.firm_id, user_id: payload.sub } },
        select: { role: true, is_active: true },
      });
      if (!membership || !membership.is_active) throw AppError.unauthenticated();

      request.user = {
        sub: payload.sub,
        firm_id: payload.firm_id,
        role: membership.role,
      };
    });

    app.decorate("issueAuthCookie", async (reply: FastifyReply, user: AuthUser) => {
      const token = await reply.jwtSign(user);
      reply.setCookie(opts.cookieName, token, {
        ...cookieOptions,
        maxAge: toSeconds(opts.jwtExpiresIn),
      });
    });

    app.decorate("clearAuthCookie", (reply: FastifyReply) => {
      reply.clearCookie(opts.cookieName, cookieOptions);
    });
  },
  { name: "authentication" },
);
