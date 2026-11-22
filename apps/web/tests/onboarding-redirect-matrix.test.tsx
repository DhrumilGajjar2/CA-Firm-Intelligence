import { useEffect } from "react";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@ca-firm/shared-types";
import { onboardingRedirect } from "@/features/auth/onboarding-redirect";
import { RequireAuth } from "@/features/auth/require-auth";
import { OnboardingWizard } from "@/features/firm/onboarding-wizard";
import { authService } from "@/services/auth.service";
import { firmService } from "@/services/firm.service";
import { makeProfile, makeSettings } from "./firm-fixtures";
import { router, setLocation } from "./navigation-mock";
import { makeUser, renderWithProviders } from "./utils";

/**
 * Redirect loops: every role x onboarding state x route. The rule under test (docs/API_SPECIFICATION.md):
 * only an OWNER with onboarding incomplete is sent to /onboarding; nobody else ever is.
 */
vi.mock("@/services/auth.service");
vi.mock("@/services/firm.service");
const meMock = vi.mocked(authService.me);

const ROLES: UserRole[] = ["owner", "manager", "employee", "viewer"];
const STATES = [
  { label: "onboarding incomplete", done: false },
  { label: "onboarding complete", done: true },
] as const;
const ROUTES = [
  "/",
  "/dashboard",
  "/settings",
  "/clients",
  "/engagements",
  "/employees",
  "/finance",
  "/reports",
  "/imports",
  "/profile",
  "/onboarding",
  "/onboarding/",
  "/onboarding/step-2",
  "/onboarding-evil", // not the onboarding route, only a similar prefix
  "/onboardingx",
  "/Onboarding", // paths are case-sensitive
];
const isOnboardingRoute = (p: string) => p === "/onboarding" || p.startsWith("/onboarding/");

const userFor = (role: UserRole, done: boolean): CurrentUser =>
  makeUser(role, {
    firm: { id: "firm-1", name: "Demo CA Associates", timezone: "Asia/Kolkata", onboarding_completed: done },
  });

describe("onboardingRedirect: full matrix (pure rule)", () => {
  for (const role of ROLES) {
    for (const state of STATES) {
      it(`${role}, ${state.label}: expected target for each of ${ROUTES.length} routes`, () => {
        const user = userFor(role, state.done);
        for (const route of ROUTES) {
          const expected =
            role === "owner" && !state.done
              ? isOnboardingRoute(route)
                ? null
                : "/onboarding"
              : isOnboardingRoute(route)
                ? "/dashboard"
                : null;
          expect(onboardingRedirect(user, route), `${role} ${state.label} at ${route}`).toBe(expected);
        }
      });
    }
  }

  it("never sends anyone but an incomplete owner to /onboarding", () => {
    for (const role of ROLES) {
      for (const state of STATES) {
        for (const route of ROUTES) {
          const target = onboardingRedirect(userFor(role, state.done), route);
          if (target === "/onboarding") {
            expect(role).toBe("owner");
            expect(state.done).toBe(false);
          }
        }
      }
    }
  });

  it("follows redirects to a stable page in at most one hop (no loops)", () => {
    for (const role of ROLES) {
      for (const state of STATES) {
        const user = userFor(role, state.done);
        for (const start of ROUTES) {
          let at = start;
          let hops = 0;
          for (;;) {
            const next = onboardingRedirect(user, at);
            if (!next) break;
            at = next;
            hops += 1;
            expect(hops, `${role} ${state.label} from ${start}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("combined with the auth-page and root redirects, every start settles within 3 hops on the right page", () => {
    // "/" and auth pages go to /dashboard for a signed-in user; then the onboarding rule applies.
    const afterAuthPages = (p: string) =>
      p === "/" || ["/login", "/register", "/forgot-password"].includes(p) ? "/dashboard" : null;
    for (const role of ROLES) {
      for (const state of STATES) {
        const user = userFor(role, state.done);
        for (const start of [...ROUTES, "/login", "/register", "/forgot-password"]) {
          let at = start;
          let hops = 0;
          for (;;) {
            const next = afterAuthPages(at) ?? onboardingRedirect(user, at);
            if (!next) break;
            at = next;
            hops += 1;
            expect(hops, `${role} ${state.label} from ${start}`).toBeLessThanOrEqual(3);
          }
          const wantsOnboarding = role === "owner" && !state.done;
          // Only an incomplete owner ends on an onboarding route; everybody else ends elsewhere.
          expect(isOnboardingRoute(at), `${role} ${state.label} from ${start} ended at ${at}`).toBe(wantsOnboarding);
        }
      }
    }
  });
});

describe("RequireAuth: protected content never mounts while a redirect is pending", () => {
  const mounted = vi.fn();
  function Probe() {
    useEffect(() => {
      mounted();
    }, []);
    return <p>Protected page</p>;
  }

  const SAMPLE = ["/dashboard", "/settings", "/clients", "/onboarding", "/onboarding/step-2", "/onboarding-evil"];

  for (const role of ROLES) {
    for (const state of STATES) {
      it(`${role}, ${state.label}`, async () => {
        for (const route of SAMPLE) {
          router.replace.mockClear();
          mounted.mockClear();
          setLocation(route);
          meMock.mockResolvedValue(userFor(role, state.done));
          const { unmount } = renderWithProviders(
            <RequireAuth>
              <Probe />
            </RequireAuth>,
          );
          const target = onboardingRedirect(userFor(role, state.done), route);
          if (target) {
            await waitFor(() => expect(router.replace).toHaveBeenCalledWith(target));
            expect(router.replace, `${role} ${state.label} ${route}`).toHaveBeenCalledTimes(1);
            expect(mounted, `${role} ${state.label} ${route}: page must not mount`).not.toHaveBeenCalled();
            expect(screen.queryByText("Protected page")).not.toBeInTheDocument();
          } else {
            expect(await screen.findByText("Protected page")).toBeInTheDocument();
            expect(router.replace, `${role} ${state.label} ${route}`).not.toHaveBeenCalled();
          }
          unmount();
        }
      });
    }
  }

  it.each(["manager", "employee", "viewer"] as const)(
    "a %s who opens /onboarding never mounts the wizard and never fetches the firm",
    async (role) => {
      const getFirm = vi.mocked(firmService.getFirm);
      setLocation("/onboarding");
      meMock.mockResolvedValue(userFor(role, false));
      renderWithProviders(
        <RequireAuth>
          <OnboardingWizard />
        </RequireAuth>,
      );
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
      expect(getFirm).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Firm name")).not.toBeInTheDocument();
    },
  );

  it("a completed owner who opens /onboarding never mounts the wizard", async () => {
    const getFirm = vi.mocked(firmService.getFirm);
    setLocation("/onboarding");
    meMock.mockResolvedValue(userFor("owner", true));
    renderWithProviders(
      <RequireAuth>
        <OnboardingWizard />
      </RequireAuth>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(getFirm).not.toHaveBeenCalled();
  });
});

describe("guard and wizard together", () => {
  it("finishing onboarding ends on /dashboard only: no hop back to /onboarding, no loop", async () => {
    setLocation("/onboarding");
    meMock.mockResolvedValue(userFor("owner", false));
    vi.mocked(firmService.getFirm).mockResolvedValue(makeProfile());
    vi.mocked(firmService.getSettings).mockResolvedValue(makeSettings());
    vi.mocked(firmService.updateSettings).mockImplementation(async (patch) => ({ ...makeSettings(), ...patch }));

    const { user } = renderWithProviders(
      <RequireAuth>
        <OnboardingWizard />
      </RequireAuth>,
    );
    await screen.findByLabelText("Firm name");
    expect(router.replace).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    // The guard sees the completed flag (the page still reports /onboarding in this mock) and agrees.
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    for (const [target] of router.replace.mock.calls) expect(target).toBe("/dashboard");
    expect(router.replace.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("an owner whose session is refreshed after completion (cache now says complete) is never sent back", async () => {
    setLocation("/dashboard");
    meMock.mockResolvedValue(userFor("owner", true));
    renderWithProviders(
      <RequireAuth>
        <p>Dashboard</p>
      </RequireAuth>,
    );
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
