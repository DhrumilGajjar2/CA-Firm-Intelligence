import { useQuery } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardLayout from "@/app/(dashboard)/layout";
import { Providers } from "@/components/providers";
import { RequireAuth } from "@/features/auth/require-auth";
import { currentUserQueryKey, useCurrentUser } from "@/features/auth/use-current-user";
import { authService } from "@/services/auth.service";
import { router, setLocation } from "./navigation-mock";
import { apiError, makeUser, renderWithProviders } from "./utils";
import { render } from "@testing-library/react";
import type { UserRole } from "@ca-firm/shared-types";

vi.mock("@/services/auth.service");
// The header API-status badge is not under test and would otherwise hit the network layer.
vi.mock("@/features/system/use-api-health", () => ({
  useApiHealth: () => ({ isPending: false, isError: false, error: null }),
}));
const meMock = vi.mocked(authService.me);

const NAV_BY_ROLE: Record<UserRole, string[]> = {
  owner: [
    "Dashboard",
    "Clients",
    "Engagements",
    "Services",
    "Employees",
    "Finance",
    "Reports",
    "Imports",
    "Settings",
  ],
  manager: [
    "Dashboard",
    "Clients",
    "Engagements",
    "Services",
    "Employees",
    "Finance",
    "Reports",
    "Imports",
  ],
  employee: ["Dashboard", "Engagements"],
  viewer: ["Dashboard", "Clients", "Engagements", "Reports"],
};

describe("expired / unauthorised sessions in the UI (critical scenario #10, frontend half)", () => {
  it("hides protected content and redirects when a later refetch of /auth/me answers 401", async () => {
    setLocation("/clients", "page=3");
    meMock.mockResolvedValueOnce(makeUser("owner"));
    const { queryClient } = renderWithProviders(
      <RequireAuth>
        <p>Secret dashboard</p>
      </RequireAuth>,
    );
    expect(await screen.findByText("Secret dashboard")).toBeInTheDocument();

    // Session expires (or the user is deactivated) while the page is open.
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/clients?page=3")}`,
      ),
    );
    expect(screen.queryByText("Secret dashboard")).not.toBeInTheDocument();
  });

  it("a 401 from any DATA query re-checks the session and sends the user to /login", async () => {
    setLocation("/engagements");

    function Page() {
      const { data: user } = useCurrentUser();
      const clients = useQuery({
        queryKey: ["clients", "list"],
        queryFn: () => Promise.reject(apiError(401, "Authentication required")),
      });
      return (
        <p>
          Protected page for {user?.name} {clients.isError ? "(data failed)" : ""}
        </p>
      );
    }

    // After the first /auth/me, the session is gone for every later check.
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    meMock.mockResolvedValueOnce(makeUser("manager"));
    render(
      <Providers>
        <RequireAuth>
          <Page />
        </RequireAuth>
      </Providers>,
    );

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/engagements")}`,
      ),
    );
    expect(meMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Protected page/)).not.toBeInTheDocument();
  });

  it("does not treat 403 / 404 / network errors as 'signed out': retry is offered, no redirect, no content", async () => {
    for (const err of [
      apiError(403, "Forbidden", { code: "FORBIDDEN" }),
      apiError(404, "Not found", { code: "NOT_FOUND" }),
      apiError(null, "Cannot reach the server."),
    ]) {
      meMock.mockReset();
      meMock.mockRejectedValue(err);
      const { unmount } = renderWithProviders(
        <RequireAuth>
          <p>Secret dashboard</p>
        </RequireAuth>,
      );
      expect(
        await screen.findByRole("button", { name: "Try again" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Secret dashboard")).not.toBeInTheDocument();
      expect(router.replace).not.toHaveBeenCalled();
      unmount();
    }
  });
});

describe("(dashboard) layout: RequireAuth + AppShell integration", () => {
  it("signed out: renders neither the shell, the navigation nor the page, and redirects with next", async () => {
    setLocation("/finance", "tab=outstanding");
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    renderWithProviders(
      <DashboardLayout>
        <p>Finance numbers</p>
      </DashboardLayout>,
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/finance?tab=outstanding")}`,
      ),
    );
    expect(screen.queryByText("Finance numbers")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Finance" })).not.toBeInTheDocument();
  });

  it("shows no protected content or navigation while the session is still loading", () => {
    meMock.mockReturnValue(new Promise(() => {}));
    renderWithProviders(
      <DashboardLayout>
        <p>Finance numbers</p>
      </DashboardLayout>,
    );
    expect(screen.queryByText("Finance numbers")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it.each(["owner", "manager", "employee", "viewer"] as UserRole[])(
    "signed in as %s: renders the page, the firm name, the role badge and exactly that role's nav",
    async (role) => {
      setLocation("/dashboard");
      meMock.mockResolvedValue(makeUser(role));
      renderWithProviders(
        <DashboardLayout>
          <p>Page body</p>
        </DashboardLayout>,
      );
      expect(await screen.findByText("Page body")).toBeInTheDocument();
      expect(screen.getAllByText("Demo CA Associates").length).toBeGreaterThan(0);
      const nav = (await screen.findAllByRole("navigation", { name: "Main" }))[0]!;
      const labels = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent);
      expect(labels).toEqual(NAV_BY_ROLE[role]);
      expect(router.replace).not.toHaveBeenCalled();
    },
  );
});
