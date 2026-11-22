"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api-client";
import { authService } from "@/services/auth.service";

export const currentUserQueryKey = ["auth", "me"] as const;

/** True when the API answered 401: the session is missing, expired or the user was deactivated. */
export function isUnauthenticatedError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

/**
 * `meta` for mutations whose 401 is an expected answer, not a session ending (login: wrong password;
 * register, accept-invitation, forgot/reset password: no session yet; logout: handled by its own
 * flow). The global mutation error handler in providers.tsx skips the session re-check for these.
 */
export const authFormMutationMeta = { skipSessionCheck: true } as const;

/** True when a mutation (or query) opted out of the global "401 means re-check the session" handling. */
export function skipsSessionCheck(meta: Record<string, unknown> | undefined): boolean {
  return meta?.skipSessionCheck === true;
}

/** GET /auth/me: the single source of truth for who is signed in (and their firm and role). */
export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: authService.me,
    retry: false,
    staleTime: 5 * 60_000,
  });
}
