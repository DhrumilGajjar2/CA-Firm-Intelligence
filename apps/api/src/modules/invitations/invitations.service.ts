import type {
  CreatedInvitation,
  Invitation,
  InvitationStatus,
  UserRole,
} from "@ca-firm/shared-types";
import type { InviteUserInput, ListInvitationsQuery } from "@ca-firm/validation";
import type { FastifyBaseLogger } from "fastify";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { Mailer } from "../../plugins/mailer.js";
import { AppError } from "../../utils/app-error.js";
import { isUuid } from "../../utils/uuid.js";
import { generateToken } from "../auth/tokens.js";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const INVITATION_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  expires_at: true,
  created_at: true,
  invited_by: { select: { id: true, name: true } },
} as const;

interface InvitationRow {
  id: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  expires_at: Date;
  created_at: Date;
  invited_by: { id: string; name: string };
}

/** A `pending` row past its expiry is reported as `expired`. Never includes the token or its hash. */
export function toInvitation(row: InvitationRow, now = new Date()): Invitation {
  const status: InvitationStatus =
    row.status === "pending" && row.expires_at < now ? "expired" : row.status;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status,
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
    invited_by: { id: row.invited_by.id, name: row.invited_by.name },
  };
}

export interface InvitationsServiceDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  frontendUrl: string;
  log: FastifyBaseLogger;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Invitations of the caller's firm (owner only, enforced by the routes). Every query is scoped by the
 * firm id from the session; another firm's invitation id is a 404.
 */
export function createInvitationsService({
  prisma,
  mailer,
  frontendUrl,
  log,
}: InvitationsServiceDeps) {
  const notFound = () => AppError.notFound("Invitation not found");
  const emailConflict = (message: string) =>
    new AppError(409, "CONFLICT", message, [{ field: "email", message }]);

  return {
    /**
     * Creates an invitation and returns the raw token ONLY inside `invite_url`. Race-safe: the firm row is
     * locked for the whole check-then-insert, so two simultaneous invites for one email give exactly one
     * 201 and one 409. An old pending invitation past its expiry is marked `expired` and does not block.
     */
    async invite(
      firmId: string,
      invitedById: string,
      input: InviteUserInput,
    ): Promise<CreatedInvitation> {
      const { token, token_hash } = generateToken();
      const now = new Date();

      const created = await prisma
        .$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM firms WHERE id = ${firmId}::uuid FOR UPDATE`;

          const member = await tx.firmMember.findFirst({
            where: { firm_id: firmId, user: { email: input.email } },
            select: { id: true },
          });
          if (member) throw emailConflict("This email already belongs to a member of your firm");

          await tx.invitation.updateMany({
            where: {
              firm_id: firmId,
              email: input.email,
              status: "pending",
              expires_at: { lt: now },
            },
            data: { status: "expired" },
          });
          const pending = await tx.invitation.findFirst({
            where: { firm_id: firmId, email: input.email, status: "pending" },
            select: { id: true },
          });
          if (pending) throw emailConflict("A pending invitation already exists for this email");

          return tx.invitation.create({
            data: {
              firm_id: firmId,
              email: input.email,
              role: input.role,
              token_hash,
              invited_by_id: invitedById,
              expires_at: new Date(now.getTime() + INVITATION_TTL_MS),
            },
            select: { ...INVITATION_SELECT, firm: { select: { name: true } } },
          });
        })
        .catch((err: unknown) => {
          if (isUniqueViolation(err)) {
            throw emailConflict("A pending invitation already exists for this email");
          }
          throw err;
        });

      const invite_url = `${frontendUrl}/accept-invitation?token=${token}`;
      // Handed to the mailer in the background; the log line never includes the link or the address.
      void mailer
        .sendInvitation({
          to: created.email,
          invite_url,
          firm_name: created.firm.name,
          role: created.role,
        })
        .catch(() => {
          log.error("Failed to hand the invitation email to the mailer");
        });

      return { ...toInvitation(created, now), invite_url };
    },

    async list(
      firmId: string,
      query: ListInvitationsQuery,
    ): Promise<{ invitations: Invitation[]; total: number }> {
      const now = new Date();
      const where: Prisma.InvitationWhereInput = { firm_id: firmId };
      if (query.status === "pending") {
        where.status = "pending";
        where.expires_at = { gte: now };
      } else if (query.status === "expired") {
        where.OR = [
          { status: "expired" },
          { status: "pending", expires_at: { lt: now } },
        ];
      } else if (query.status) {
        where.status = query.status;
      }
      const [rows, total] = await prisma.$transaction([
        prisma.invitation.findMany({
          where,
          select: INVITATION_SELECT,
          orderBy: [{ created_at: "desc" }, { id: "asc" }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.invitation.count({ where }),
      ]);
      return { invitations: rows.map((r) => toInvitation(r, now)), total };
    },

    /** Revoke: only a pending (not expired) invitation of this firm; anything else is a 409, another firm's is a 404. */
    async revoke(firmId: string, id: string): Promise<Invitation> {
      if (!isUuid(id)) throw notFound();
      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM invitations WHERE id = ${id}::uuid AND firm_id = ${firmId}::uuid FOR UPDATE`;
        if (rows.length === 0) throw notFound();

        const current = await tx.invitation.findFirst({
          where: { id, firm_id: firmId },
          select: INVITATION_SELECT,
        });
        if (!current) throw notFound();
        const now = new Date();
        if (toInvitation(current, now).status !== "pending") {
          throw AppError.conflict(
            `Only a pending invitation can be revoked (this one is ${toInvitation(current, now).status})`,
          );
        }
        const updated = await tx.invitation.update({
          where: { id },
          data: { status: "revoked" },
          select: INVITATION_SELECT,
        });
        return toInvitation(updated, now);
      });
    },
  };
}

export type InvitationsService = ReturnType<typeof createInvitationsService>;
