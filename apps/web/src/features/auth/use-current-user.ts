"use client";

import { useQuery } from "@tanstack/react-query";
import { endpoints } from "@ca-firm/api-contracts";
import type { CurrentUser } from "@ca-firm/shared-types";
import { requestData } from "@/lib/api-client";

export const currentUserQueryKey = ["auth", "me"] as const;

/** GET /auth/me — current user and firm (PRD §9.2). Owned by backend; not implemented until P1. */
export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: () => requestData<CurrentUser>({ method: "GET", url: endpoints.auth.me }),
    retry: false,
    staleTime: 5 * 60_000,
  });
}
