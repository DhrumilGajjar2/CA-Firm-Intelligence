"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { CurrentUser, FirmUser } from "@ca-firm/shared-types";
import type {
  InviteUserInput,
  UpdateUserInput,
  UpdateUserRoleInput,
} from "@ca-firm/validation";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { isStatus } from "@/lib/error-message";
import {
  invitationsService,
  type InvitationsListQuery,
} from "@/services/invitations.service";
import { usersService, type UsersListQuery } from "@/services/users.service";

export const usersQueryKey = ["users"] as const;
export const invitationsQueryKey = ["invitations"] as const;

/** One page of the team list. The previous page stays on screen while the next one loads. */
export function useUsersList(query: UsersListQuery) {
  return useQuery({
    queryKey: [...usersQueryKey, "list", query],
    queryFn: () => usersService.list(query),
    placeholderData: keepPreviousData,
  });
}

/** One page of invitations (owner only). */
export function useInvitationsList(query: InvitationsListQuery) {
  return useQuery({
    queryKey: [...invitationsQueryKey, "list", query],
    queryFn: () => invitationsService.list(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Owner actions on other users. A success refetches the list; a 404 (user is gone) or 409
 * (state changed under us) also refetches so the table shows the truth the next moment.
 */
export function useUserActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: usersQueryKey });
  const refreshOnStale = (error: unknown) => {
    if (isStatus(error, 404, 409)) void refresh();
  };

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UpdateUserRoleInput["role"] }) =>
      usersService.updateRole(id, { role }),
    onSuccess: refresh,
    onError: refreshOnStale,
  });

  const setActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      usersService.updateStatus(id, { is_active }),
    onSuccess: refresh,
    onError: refreshOnStale,
  });

  return { changeRole, setActive };
}

/** POST /users/invite. The new invitation also shows up in the invitations list. */
export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteUserInput) => usersService.invite(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitationsQueryKey }),
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
  return useMutation({
    mutationFn: (id: string) => invitationsService.revoke(id),
    onSuccess: refresh,
    onError: (error) => {
      if (isStatus(error, 404, 409)) void refresh();
    },
  });
}

/** PATCH /users/:id for the signed-in user's own name; the current-user cache follows the answer. */
export function useUpdateOwnProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      usersService.update(id, input),
    onSuccess: (updated: FirmUser) => {
      queryClient.setQueryData<CurrentUser>(currentUserQueryKey, (user) =>
        user && user.id === updated.id ? { ...user, name: updated.name } : user,
      );
      // Their name also appears in the team list.
      void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
  });
}
