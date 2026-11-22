import type { FirmUser, UserRole } from "@ca-firm/shared-types";
import type { ListUsersQuery } from "@ca-firm/validation";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { isUuid } from "../../utils/uuid.js";

/** PostgreSQL LIKE treats \, % and _ specially, and Prisma passes them through: escape so they match literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Who is asking. The role is the DATABASE role (see `app.authenticate`). */
export interface Actor {
  id: string;
  firm_id: string;
  role: UserRole;
}

const MEMBER_SELECT = {
  role: true,
  is_active: true,
  user: {
    select: { id: true, name: true, email: true, last_login_at: true, created_at: true },
  },
} as const;

interface MemberRow {
  role: UserRole;
  is_active: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    last_login_at: Date | null;
    created_at: Date;
  };
}

/** `FirmUser` = user + membership. `id` is the USER id; the password hash is never selected. */
export function toFirmUser(m: MemberRow): FirmUser {
  return {
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    is_active: m.is_active,
    last_login_at: m.user.last_login_at ? m.user.last_login_at.toISOString() : null,
    created_at: m.user.created_at.toISOString(),
  };
}

/**
 * Users of the caller's firm. EVERY query is scoped by `actor.firm_id` (from the verified session), so
 * another firm's user id is indistinguishable from an unknown id: 404 for every role.
 */
export function createUsersService({ prisma }: { prisma: PrismaClient }) {
  const notFound = () => AppError.notFound("User not found");

  /** The membership of `userId` in `firmId`, or 404 (other firm, unknown id and malformed id look alike). */
  async function findMember(firmId: string, userId: string): Promise<MemberRow> {
    if (!isUuid(userId)) throw notFound();
    const member = await prisma.firmMember.findUnique({
      where: { firm_id_user_id: { firm_id: firmId, user_id: userId } },
      select: MEMBER_SELECT,
    });
    if (!member) throw notFound();
    return member;
  }

  return {
    async list(
      firmId: string,
      query: ListUsersQuery,
    ): Promise<{ users: FirmUser[]; total: number }> {
      const where: Prisma.FirmMemberWhereInput = { firm_id: firmId };
      if (query.role) where.role = query.role;
      if (query.status) where.is_active = query.status === "active";
      if (query.search) {
        const term = escapeLike(query.search);
        where.user = {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
          ],
        };
      }
      const [rows, total] = await prisma.$transaction([
        prisma.firmMember.findMany({
          where,
          select: MEMBER_SELECT,
          orderBy: [
            { user: { name: "asc" } },
            { user: { created_at: "asc" } },
            { user_id: "asc" },
          ],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.firmMember.count({ where }),
      ]);
      return { users: rows.map(toFirmUser), total };
    },

    /** Owner/manager: any user of the firm. Employee/viewer: only themselves (403 otherwise, after the 404 check). */
    async get(actor: Actor, userId: string): Promise<FirmUser> {
      const member = await findMember(actor.firm_id, userId);
      const privileged = actor.role === "owner" || actor.role === "manager";
      if (!privileged && member.user.id !== actor.id) throw AppError.forbidden();
      return toFirmUser(member);
    },

    /** Name only. Owner: anyone in the firm. Everyone else: only themselves. */
    async updateName(actor: Actor, userId: string, name: string): Promise<FirmUser> {
      const member = await findMember(actor.firm_id, userId);
      if (actor.role !== "owner" && member.user.id !== actor.id) throw AppError.forbidden();
      await prisma.user.update({ where: { id: member.user.id }, data: { name } });
      return toFirmUser(await findMember(actor.firm_id, userId));
    },

    /**
     * Owner only (enforced by the route). The target must be another, non-owner member: the owner can
     * never be demoted and nobody changes their own role. `owner` is not assignable (schema).
     */
    async changeRole(
      actor: Actor,
      userId: string,
      role: Exclude<UserRole, "owner">,
    ): Promise<FirmUser> {
      const member = await findMember(actor.firm_id, userId);
      if (member.user.id === actor.id || member.role === "owner") {
        throw AppError.forbidden("The owner's role cannot be changed");
      }
      await prisma.firmMember.update({
        where: { firm_id_user_id: { firm_id: actor.firm_id, user_id: member.user.id } },
        data: { role },
      });
      return toFirmUser(await findMember(actor.firm_id, userId));
    },

    /** Owner only. The owner and the caller themselves can never be (de)activated. */
    async changeStatus(
      actor: Actor,
      userId: string,
      isActive: boolean,
    ): Promise<FirmUser> {
      const member = await findMember(actor.firm_id, userId);
      if (member.user.id === actor.id || member.role === "owner") {
        throw AppError.forbidden("The owner's status cannot be changed");
      }
      await prisma.firmMember.update({
        where: { firm_id_user_id: { firm_id: actor.firm_id, user_id: member.user.id } },
        data: { is_active: isActive },
      });
      return toFirmUser(await findMember(actor.firm_id, userId));
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
