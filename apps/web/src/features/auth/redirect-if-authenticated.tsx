"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthCardSkeleton } from "./auth-states";
import { clearSignedOutByUser } from "./session-state";
import { useCurrentUser } from "./use-current-user";
import { useNextPath } from "./use-next-path";

/**
 * Reset and invitation links work whether or not someone is signed in, so they are not redirected.
 * (The invitation page tells a signed-in user that accepting replaces their session.)
 */
const NO_REDIRECT_PATHS = ["/reset-password", "/accept-invitation"];

/** Auth pages (login, register, ...) send an already signed-in user to the app. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const nextPath = useNextPath();
  const { data: user, isPending } = useCurrentUser();
  const exempt = NO_REDIRECT_PATHS.includes(pathname);

  // An auth page is showing, so the deliberate logout navigation has completed.
  useEffect(() => clearSignedOutByUser(), []);

  useEffect(() => {
    if (user && !exempt) router.replace(nextPath);
  }, [user, exempt, nextPath, router]);

  if (exempt) return <>{children}</>;
  if (user || isPending) return <AuthCardSkeleton />;
  // Signed out (401) or API unreachable: show the form; submit surfaces any error.
  return <>{children}</>;
}
