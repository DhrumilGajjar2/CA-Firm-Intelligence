import type { CurrentUser, InvitationPreview } from "@ca-firm/shared-types";
import type { AcceptInvitationInput, RegisterInput } from "@ca-firm/validation";
import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Mailer } from "../../plugins/mailer.js";
import { AppError } from "../../utils/app-error.js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password.js";
import { generateToken, hashToken } from "./tokens.js";

export const DEFAULT_FIRM_SETTINGS = {
  financial_year_start_month: 4,
  onboarding_completed: false,
} as const;

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";
export const INVALID_RESET_MESSAGE = "Reset link is invalid or has expired";
/** One generic message for an unknown, expired, revoked or already used invitation token. */
export const INVALID_INVITATION_MESSAGE = "Invitation is invalid or has expired";

const FIRM_SELECT = { id: true, name: true, timezone: true, settings: true } as const;

interface MembershipWithRelations {
  role: CurrentUser["role"];
  user: { id: string; name: string; email: string };
  firm: { id: string; name: string; timezone: string; settings: unknown };
}

function onboardingCompleted(settings: unknown): boolean {
  return (
    typeof settings === "object" &&
    settings !== null &&
    (settings as Record<string, unknown>)["onboarding_completed"] === true
  );
}

/** Builds the `CurrentUser` response. Never includes the password hash. */
export function toCurrentUser(m: MembershipWithRelations): CurrentUser {
  return {
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    firm: {
      id: m.firm.id,
      name: m.firm.name,
      timezone: m.firm.timezone,
      onboarding_completed: onboardingCompleted(m.firm.settings),
    },
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

export interface AuthServiceDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  frontendUrl: string;
  log: FastifyBaseLogger;
}

export interface AuthSession {
  user: CurrentUser;
  /** Claims for the auth cookie. */
  claims: { sub: string; firm_id: string; role: CurrentUser["role"] };
}

function sessionOf(m: MembershipWithRelations): AuthSession {
  return {
    user: toCurrentUser(m),
    claims: { sub: m.user.id, firm_id: m.firm.id, role: m.role },
  };
}

export function createAuthService({ prisma, mailer, frontendUrl, log }: AuthServiceDeps) {
  const duplicateEmail = () =>
    new AppError(409, "CONFLICT", "An account with this email already exists", [
      { field: "email", message: "This email is already registered" },
    ]);

  return {
    /** One transaction: user + firm (default settings) + owner membership. */
    async register(input: RegisterInput): Promise<AuthSession> {
      const password_hash = await hashPassword(input.password);
      try {
        const membership = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { name: input.name, email: input.email, password_hash },
            select: { id: true, name: true, email: true },
          });
          const firm = await tx.firm.create({
            data: { name: input.firm_name, settings: { ...DEFAULT_FIRM_SETTINGS } },
            select: { id: true, name: true, timezone: true, settings: true },
          });
          const member = await tx.firmMember.create({
            data: { firm_id: firm.id, user_id: user.id, role: "owner" },
            select: { role: true },
          });
          return { role: member.role, user, firm };
        });
        return sessionOf(membership);
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicateEmail();
        throw err;
      }
    },

    /** The same 401 for unknown email, wrong password, inactive user and missing membership. */
    async login(input: { email: string; password: string }): Promise<AuthSession> {
      const user = await prisma.user.findUnique({
        where: { email: input.email },
        select: {
          id: true,
          name: true,
          email: true,
          password_hash: true,
          memberships: {
            take: 1,
            orderBy: { created_at: "asc" },
            select: {
              role: true,
              is_active: true,
              firm: { select: { id: true, name: true, timezone: true, settings: true } },
            },
          },
        },
      });

      const passwordOk = user
        ? await verifyPassword(user.password_hash, input.password)
        : await verifyAgainstDummy(input.password);
      const membership = user?.memberships[0];

      if (!user || !passwordOk || !membership || !membership.is_active) {
        throw AppError.unauthenticated(INVALID_CREDENTIALS_MESSAGE);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { last_login_at: new Date() },
      });

      return sessionOf({
        role: membership.role,
        firm: membership.firm,
        user: { id: user.id, name: user.name, email: user.email },
      });
    },

    /** Public preview. Unknown, expired, revoked and accepted tokens are all the same generic 404. */
    async previewInvitation(token: string): Promise<InvitationPreview> {
      const invitation = await prisma.invitation.findUnique({
        where: { token_hash: hashToken(token) },
        select: {
          email: true,
          role: true,
          status: true,
          expires_at: true,
          firm: { select: { name: true } },
        },
      });
      if (
        !invitation ||
        invitation.status !== "pending" ||
        invitation.expires_at < new Date() ||
        invitation.role === "owner"
      ) {
        throw AppError.notFound(INVALID_INVITATION_MESSAGE);
      }
      return {
        email: invitation.email,
        role: invitation.role,
        firm_name: invitation.firm.name,
        expires_at: invitation.expires_at.toISOString(),
      };
    },

    /**
     * One transaction: lock the invitation row, then create the user (email from the invitation), the firm
     * membership with the invited role and mark the invitation accepted. Two simultaneous accepts of one
     * token: the second waits on the lock, then finds it accepted (404). An email that is already registered
     * (any firm) is a 409 and nothing is created. The invited role can never be owner.
     */
    async acceptInvitation(input: AcceptInvitationInput): Promise<AuthSession> {
      const token_hash = hashToken(input.token);
      const invalid = () => AppError.notFound(INVALID_INVITATION_MESSAGE);

      // Cheap pre-check so a bad token never pays for an Argon2 hash.
      const known = await prisma.invitation.findUnique({
        where: { token_hash },
        select: { status: true, expires_at: true },
      });
      if (!known || known.status !== "pending" || known.expires_at < new Date()) {
        throw invalid();
      }

      const password_hash = await hashPassword(input.password);
      try {
        const membership = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM invitations WHERE token_hash = ${token_hash} FOR UPDATE`;
          const invitation = await tx.invitation.findUnique({
            where: { token_hash },
            select: {
              id: true,
              firm_id: true,
              email: true,
              role: true,
              status: true,
              expires_at: true,
            },
          });
          const now = new Date();
          if (
            !invitation ||
            invitation.status !== "pending" ||
            invitation.expires_at < now ||
            invitation.role === "owner"
          ) {
            throw invalid();
          }

          const taken = await tx.user.findUnique({
            where: { email: invitation.email },
            select: { id: true },
          });
          if (taken) throw duplicateEmail();

          const user = await tx.user.create({
            data: { name: input.name, email: invitation.email, password_hash },
            select: { id: true, name: true, email: true },
          });
          const member = await tx.firmMember.create({
            data: { firm_id: invitation.firm_id, user_id: user.id, role: invitation.role },
            select: { role: true, firm: { select: FIRM_SELECT } },
          });
          await tx.invitation.update({
            where: { id: invitation.id },
            data: { status: "accepted", accepted_at: now },
          });
          return { role: member.role, firm: member.firm, user };
        });
        return sessionOf(membership);
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicateEmail();
        throw err;
      }
    },

    async currentUser(userId: string, firmId: string): Promise<CurrentUser> {
      const membership = await prisma.firmMember.findUnique({
        where: { firm_id_user_id: { firm_id: firmId, user_id: userId } },
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true } },
          firm: { select: { id: true, name: true, timezone: true, settings: true } },
        },
      });
      if (!membership) throw AppError.unauthenticated();
      return toCurrentUser(membership);
    },

    /**
     * Always resolves the same way. Unknown and known emails run the same steps (user lookup, token
     * generation and hashing); only the known path stores the hash and hands the link to the mailer,
     * and the mail is dispatched in the background so mailer latency cannot reveal the difference.
     */
    async forgotPassword(email: string): Promise<void> {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true },
      });
      const { token, token_hash } = generateToken();
      if (!user) return;

      await prisma.passwordResetToken.create({
        data: {
          user_id: user.id,
          token_hash,
          expires_at: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });

      const reset_url = `${frontendUrl}/reset-password?token=${token}`;
      void mailer.sendPasswordReset({ to: user.email, reset_url }).catch(() => {
        // Never include the link or the address in this log line.
        log.error("Failed to hand the password reset email to the mailer");
      });
    },

    /** Single-use: the token is consumed atomically; the user's other unused tokens are invalidated. */
    async resetPassword(input: { token: string; password: string }): Promise<void> {
      const token_hash = hashToken(input.token);
      const now = new Date();
      const record = await prisma.passwordResetToken.findUnique({
        where: { token_hash },
      });
      if (!record || record.used_at || record.expires_at <= now) {
        throw AppError.badRequest(INVALID_RESET_MESSAGE);
      }

      const password_hash = await hashPassword(input.password);
      await prisma.$transaction(async (tx) => {
        const consumed = await tx.passwordResetToken.updateMany({
          where: { id: record.id, used_at: null },
          data: { used_at: now },
        });
        if (consumed.count !== 1) throw AppError.badRequest(INVALID_RESET_MESSAGE);

        await tx.user.update({ where: { id: record.user_id }, data: { password_hash } });
        await tx.passwordResetToken.updateMany({
          where: { user_id: record.user_id, used_at: null },
          data: { used_at: now },
        });
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
