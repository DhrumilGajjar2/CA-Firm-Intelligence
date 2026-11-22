import type { CurrentUser } from "@ca-firm/shared-types";

export const ONBOARDING_PATH = "/onboarding";

/** Only the owner sets the firm up, and only until onboarding is completed. */
export const needsOnboarding = (user: CurrentUser) =>
  user.role === "owner" && !user.firm.onboarding_completed;

/**
 * Where a signed-in user must be sent from `pathname`, or null to stay.
 * - owner with onboarding incomplete: everything except /onboarding goes to /onboarding
 * - everyone else (completed owner, manager, employee, viewer): /onboarding goes to /dashboard
 * Each rule only fires away from its own target, so these can never redirect in a loop.
 */
export function onboardingRedirect(user: CurrentUser, pathname: string): string | null {
  const onOnboarding =
    pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`);
  if (needsOnboarding(user)) return onOnboarding ? null : ONBOARDING_PATH;
  return onOnboarding ? "/dashboard" : null;
}
