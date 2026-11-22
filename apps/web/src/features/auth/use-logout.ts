"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authService } from "@/services/auth.service";
import { markSignedOutByUser } from "./session-state";
import { isUnauthenticatedError, authFormMutationMeta } from "./use-current-user";

/**
 * Logs out, then clears the whole query cache (no data of the previous session may leak
 * into the next one) and goes to /login. A 401 means the session was already gone, so it
 * is treated as success. Other failures keep the user signed in and are exposed via `error`.
 */
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    meta: authFormMutationMeta,
    mutationFn: authService.logout,
    onSuccess: () => finish(),
    onError: (error) => {
      if (isUnauthenticatedError(error)) finish();
    },
  });

  function finish() {
    markSignedOutByUser();
    queryClient.clear();
    router.replace("/login");
  }
}
