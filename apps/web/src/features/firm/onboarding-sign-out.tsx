"use client";

import { Button } from "@/components/ui/button";
import { useLogout } from "@/features/auth/use-logout";

/** The onboarding screen has no user menu, so offer a way out (e.g. wrong account). */
export function OnboardingSignOut() {
  const logout = useLogout();
  return (
    <div className="flex items-center gap-2">
      {logout.isError ? (
        <span role="alert" className="text-destructive text-xs">
          Could not log out. Try again.
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        {logout.isPending ? "Logging out…" : "Log out"}
      </Button>
    </div>
  );
}
