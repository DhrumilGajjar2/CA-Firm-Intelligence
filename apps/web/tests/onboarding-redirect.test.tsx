import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserRole } from "@ca-firm/shared-types";
import { onboardingRedirect } from "@/features/auth/onboarding-redirect";
import { RequireAuth } from "@/features/auth/require-auth";
import { authService } from "@/services/auth.service";
import { router, setLocation } from "./navigation-mock";
import { makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
const meMock = vi.mocked(authService.me);

const incomplete = (role: UserRole) =>
  makeUser(role, {
    firm: {
      id: "firm-1",
      name: "Demo CA Associates",
      timezone: "Asia/Kolkata",
      onboarding_completed: false,
    },
  });

describe("onboardingRedirect (pure rules)", () => {
  it("sends an owner with unfinished onboarding to /onboarding from any other page", () => {
    for (const path of ["/dashboard", "/settings", "/clients", "/"]) {
      expect(onboardingRedirect(incomplete("owner"), path)).toBe("/onboarding");
    }
  });

  it("keeps that owner on /onboarding", () => {
    expect(onboardingRedirect(incomplete("owner"), "/onboarding")).toBeNull();
  });

  it("sends a completed owner away from /onboarding, and leaves other pages alone", () => {
    expect(onboardingRedirect(makeUser("owner"), "/onboarding")).toBe("/dashboard");
    expect(onboardingRedirect(makeUser("owner"), "/dashboard")).toBeNull();
  });

  it.each(["manager", "employee", "viewer"] as const)(
    "never sends a %s to /onboarding",
    (role) => {
      for (const user of [makeUser(role), incomplete(role)]) {
        expect(onboardingRedirect(user, "/dashboard")).toBeNull();
        expect(onboardingRedirect(user, "/settings")).toBeNull();
        expect(onboardingRedirect(user, "/onboarding")).toBe("/dashboard");
      }
    },
  );

  it("has no loop: following a redirect always lands on a stable page", () => {
    for (const role of ["owner", "manager", "employee", "viewer"] as const) {
      for (const user of [makeUser(role), incomplete(role)]) {
        for (const start of ["/", "/dashboard", "/onboarding", "/settings"]) {
          const first = onboardingRedirect(user, start);
          if (first) expect(onboardingRedirect(user, first)).toBeNull();
        }
      }
    }
  });
});

describe("RequireAuth onboarding redirect", () => {
  function renderGuard() {
    return renderWithProviders(
      <RequireAuth>
        <p>Page content</p>
      </RequireAuth>,
    );
  }

  it("redirects an owner with unfinished onboarding from /dashboard to /onboarding", async () => {
    setLocation("/dashboard");
    meMock.mockResolvedValue(incomplete("owner"));
    renderGuard();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Page content")).not.toBeInTheDocument();
  });

  it("renders /onboarding for that owner without redirecting (no loop)", async () => {
    setLocation("/onboarding");
    meMock.mockResolvedValue(incomplete("owner"));
    renderGuard();
    expect(await screen.findByText("Page content")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("redirects a completed owner from /onboarding to /dashboard", async () => {
    setLocation("/onboarding");
    meMock.mockResolvedValue(makeUser("owner"));
    renderGuard();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText("Page content")).not.toBeInTheDocument();
  });

  it("lets a completed owner use the dashboard", async () => {
    setLocation("/dashboard");
    meMock.mockResolvedValue(makeUser("owner"));
    renderGuard();
    expect(await screen.findByText("Page content")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each(["manager", "employee", "viewer"] as const)(
    "never sends a %s to onboarding, even when setup is unfinished",
    async (role) => {
      setLocation("/dashboard");
      meMock.mockResolvedValue(incomplete(role));
      renderGuard();
      expect(await screen.findByText("Page content")).toBeInTheDocument();
      expect(router.replace).not.toHaveBeenCalled();
    },
  );

  it.each(["manager", "employee", "viewer"] as const)(
    "sends a %s who opens /onboarding to /dashboard",
    async (role) => {
      setLocation("/onboarding");
      meMock.mockResolvedValue(incomplete(role));
      renderGuard();
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
      expect(screen.queryByText("Page content")).not.toBeInTheDocument();
    },
  );
});
