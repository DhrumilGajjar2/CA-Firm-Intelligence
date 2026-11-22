import { endpoints } from "@ca-firm/api-contracts";
import type {
  CreatedInvitation,
  FirmUser,
  UserRole,
  UserStatusFilter,
} from "@ca-firm/shared-types";
import type {
  InviteUserInput,
  UpdateUserInput,
  UpdateUserRoleInput,
  UpdateUserStatusInput,
} from "@ca-firm/validation";
import { request, requestData } from "@/lib/api-client";
import { cleanParams } from "@/lib/query-params";

/** Query for GET /users (`listUsersQuerySchema`; the API defaults page=1, limit=20). */
export interface UsersListQuery {
  page?: number;
  limit?: number;
  search?: string;
  role?: UserRole;
  status?: UserStatusFilter;
}

/**
 * User API calls (contract: docs/API_SPECIFICATION.md, "P1 contracts > Users").
 * `id` is always the user id. The list is owner/manager only; invite and every
 * change except a user's own name are owner only (403 otherwise).
 */
export const usersService = {
  /** Full envelope: `data` is the page of users, `meta` holds page/limit/total. */
  list: (query: UsersListQuery = {}) =>
    request<FirmUser[]>({
      method: "GET",
      url: endpoints.users.list,
      params: cleanParams(query),
    }),
  get: (id: string) =>
    requestData<FirmUser>({ method: "GET", url: endpoints.users.byId(id) }),
  /** Owner: any user. Everyone else: their own id only. */
  update: (id: string, input: UpdateUserInput) =>
    requestData<FirmUser>({
      method: "PATCH",
      url: endpoints.users.byId(id),
      data: input,
    }),
  /** Owner only; 403 when the target is the owner or yourself. */
  updateRole: (id: string, input: UpdateUserRoleInput) =>
    requestData<FirmUser>({
      method: "PATCH",
      url: endpoints.users.role(id),
      data: input,
    }),
  /** Owner only; 403 when the target is the owner or yourself. */
  updateStatus: (id: string, input: UpdateUserStatusInput) =>
    requestData<FirmUser>({
      method: "PATCH",
      url: endpoints.users.status(id),
      data: input,
    }),
  /** Owner only. `invite_url` is returned this once; 409 when already a member or pending. */
  invite: (input: InviteUserInput) =>
    requestData<CreatedInvitation>({
      method: "POST",
      url: endpoints.users.invite,
      data: input,
    }),
};
