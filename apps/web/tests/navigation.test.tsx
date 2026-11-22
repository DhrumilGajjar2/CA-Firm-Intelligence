import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@ca-firm/shared-types";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { navItemsForRole } from "@/lib/navigation";
import { authService } from "@/services/auth.service";
import { setLocation } from "./navigation-mock";
import { deferred, makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
const meMock = vi.mocked(authService.me);

const EXPECTED: Record<UserRole, string[]> = {
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
const ROLE_CASES = Object.entries(EXPECTED) as [UserRole, string[]][];

describe("navItemsForRole", () => {
  it.each(ROLE_CASES)("filters items for %s", (role, labels) => {
    expect(navItemsForRole(role).map((i) => i.label)).toEqual(labels);
  });

  it("shows nothing when the role is unknown", () => {
    expect(navItemsForRole(undefined)).toEqual([]);
  });
});

describe("SidebarNav", () => {
  beforeEach(() => setLocation("/clients"));

  it.each(ROLE_CASES)("renders the %s menu from the real role", async (role, labels) => {
    meMock.mockResolvedValue(makeUser(role));
    renderWithProviders(<SidebarNav />);

    const nav = await screen.findByRole("navigation", { name: "Main" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(labels);
  });

  it("employees never see Finance, Clients, Settings or Employees", async () => {
    meMock.mockResolvedValue(makeUser("employee"));
    renderWithProviders(<SidebarNav />);
    await screen.findByRole("navigation", { name: "Main" });
    for (const hidden of ["Finance", "Clients", "Settings", "Employees"]) {
      expect(screen.queryByRole("link", { name: hidden })).not.toBeInTheDocument();
    }
  });

  it("renders a skeleton, not the items, while the user loads", () => {
    meMock.mockReturnValue(deferred<CurrentUser>().promise);
    renderWithProviders(<SidebarNav />);
    expect(
      screen.getByRole("status", { name: "Loading navigation" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("marks the current page", async () => {
    meMock.mockResolvedValue(makeUser("owner"));
    renderWithProviders(<SidebarNav />);
    expect(await screen.findByRole("link", { name: "Clients" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
