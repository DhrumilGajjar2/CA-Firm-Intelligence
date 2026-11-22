"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthError, AuthLoading } from "./auth-states";
import { isUnauthenticatedError, useCurrentUser } from "./use-current-user";

/** "/" sends the visitor to the app when signed in, otherwise to sign in. */
export function RootRedirect() {
  const router = useRouter();
  const { data: user, error, isFetching, refetch } = useCurrentUser();
  const unauthenticated = isUnauthenticatedError(error);

  useEffect(() => {
    if (user) router.replace("/dashboard");
    else if (unauthenticated) router.replace("/login");
  }, [user, unauthenticated, router]);

  if (error && !unauthenticated && !user) {
    return (
      <AuthError
        message={error.message}
        retrying={isFetching}
        onRetry={() => void refetch()}
      />
    );
  }
  return <AuthLoading />;
}
