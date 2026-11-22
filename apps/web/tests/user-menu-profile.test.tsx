import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserRole } from "@ca-firm/shared-types";
import { UserMenu } from "@/components/layout/user-menu";
import { canManageFirm, canManageUsers, canViewTeam } from "@/lib/roles";
import { authService } from "@/services/auth.service";
import { makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
const meMock = vi.mocked(authService.me);

async function openMenu(role: UserRole) {
  meMock.mockResolvedValue(makeUser(role));
  const rendered = renderWithProviders(<UserMenu />);
  await screen.findByText(role[0]!.toUpperCase() + role.slice(1));
  await rendered.user.click(screen.getByRole("button", { name: "Open user menu" }));
  await screen.findByRole("menuitem", { name: /Log out/ });
  return rendered;
}

describe("UserMenu: Profile and Settings links", () => {
  it.each<UserRole>(["owner", "manager", "employee", "viewer"])(
    "links Profile to /profile for the %s role",
    async (role) => {
      await openMenu(role);
      expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveAttribute(
        "href",
        "/profile",
      );
    },
  );

  it("shows Settings (to /settings) for the owner only", async () => {
    await openMenu("owner");
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it.each<UserRole>(["manager", "employee", "viewer"])(
    "does not show Settings for the %s role",
    async (role) => {
      await openMenu(role);
      expect(
        screen.queryByRole("menuitem", { name: "Settings" }),
      ).not.toBeInTheDocument();
    },
  );
});

describe("role helpers (UI gating only; the API enforces access)", () => {
  it("canManageUsers and canManageFirm are owner only", () => {
    for (const role of ["owner", "manager", "employee", "viewer"] as const) {
      expect(canManageUsers(role)).toBe(role === "owner");
      expect(canManageFirm(role)).toBe(role === "owner");
    }
    expect(canManageUsers(undefined)).toBe(false);
  });

  it("canViewTeam is owner and manager", () => {
    expect(canViewTeam("owner")).toBe(true);
    expect(canViewTeam("manager")).toBe(true);
    expect(canViewTeam("employee")).toBe(false);
    expect(canViewTeam("viewer")).toBe(false);
    expect(canViewTeam(undefined)).toBe(false);
  });
});
