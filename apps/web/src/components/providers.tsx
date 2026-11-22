"use client";

import { useState, type ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  currentUserQueryKey,
  isUnauthenticatedError,
  skipsSessionCheck,
} from "@/features/auth/use-current-user";
import { ApiRequestError } from "@/lib/api-client";

function makeQueryClient() {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      // A 401 from any data query means the session ended: re-check who is signed in so the
      // dashboard guard can redirect to /login (the /auth/me query itself is excluded).
      onError: (error, query) => {
        if (
          isUnauthenticatedError(error) &&
          query.queryKey[0] !== currentUserQueryKey[0]
        ) {
          void queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
        }
      },
    }),
    mutationCache: new MutationCache({
      // Same rule for saves: a 401 on a mutation (e.g. saving /settings after the session expired)
      // re-checks who is signed in. Auth-form mutations opt out via `meta.skipSessionCheck`
      // (a 401 from POST /auth/login is just "wrong password").
      onError: (error, _variables, _context, mutation) => {
        if (isUnauthenticatedError(error) && !skipsSessionCheck(mutation.meta)) {
          void queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Don't hammer the API on auth/validation/permission failures.
        retry: (failureCount, error) => {
          if (error instanceof ApiRequestError && error.status && error.status < 500)
            return false;
          return failureCount < 2;
        },
      },
    },
  });
  return queryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  // One client per browser session; useState keeps it stable across re-renders.
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
