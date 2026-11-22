"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loginUrlWithNext } from "@/lib/safe-redirect";
import { AuthError, AuthLoading } from "./auth-states";
import { onboardingRedirect } from "./onboarding-redirect";
import { wasSignedOutByUser } from "./session-state";
import { isUnauthenticatedError, useCurrentUser } from "./use-current-user";

/**
 * Guards the dashboard routes (UX only: the API enforces real access).
 * loading -> spinner (no protected content), 401 -> /login?next=..., other error -> retry, else render.
 * An owner whose firm onboarding is unfinished is sent to /onboarding (and back out once done).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: user, error, isPending, isFetching, refetch } = useCurrentUser();
  const unauthenticated = isUnauthenticatedError(error);

  useEffect(() => {
    if (!unauthenticated) return;
    router.replace(
      wasSignedOutByUser()
        ? "/login"
        : loginUrlWithNext(`${pathname}${window.location.search}`),
    );
  }, [unauthenticated, pathname, router]);

  // Owner with unfinished firm setup <-> /onboarding (see onboarding-redirect.ts).
  const onboardingTarget = user ? onboardingRedirect(user, pathname) : null;
  useEffect(() => {
    if (onboardingTarget) router.replace(onboardingTarget);
  }, [onboardingTarget, router]);

  if (unauthenticated) return <AuthLoading label="Redirecting to sign in" />;
  if (user) {
    return onboardingTarget ? <AuthLoading label="Redirecting" /> : <>{children}</>;
  }
  if (isPending) return <AuthLoading />;
  return (
    <AuthError
      message={error?.message ?? "Something went wrong."}
      retrying={isFetching}
      onRetry={() => void refetch()}
    />
  );
}
