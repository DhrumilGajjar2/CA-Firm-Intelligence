import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserMenu } from "@/components/layout/user-menu";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { authService } from "@/services/auth.service";
import { router } from "./navigation-mock";
import { apiError, makeQueryClient, makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
const meMock = vi.mocked(authService.me);
const logoutMock = vi.mocked(authService.logout);

describe("UserMenu", () => {
  it("shows the user's name, role badge and firm name", async () => {
    meMock.mockResolvedValue(makeUser("manager"));
    const { user } = renderWithProviders(<UserMenu />);

    expect(await screen.findAllByText("Asha Rao")).not.toHaveLength(0);
    expect(screen.getByText("Manager")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open user menu" }));
    expect(await screen.findByText("Demo CA Associates")).toBeInTheDocument();
    expect(screen.getByText(/asha@example.com/)).toBeInTheDocument();
  });

  it("logs out, clears the whole query cache and redirects to /login", async () => {
    meMock.mockResolvedValue(makeUser("owner"));
    logoutMock.mockResolvedValue(null);
    const queryClient = makeQueryClient();
    const clearSpy = vi.spyOn(queryClient, "clear");
    queryClient.setQueryData(["clients", "list"], [{ id: "c1" }]);
    const { user } = renderWithProviders(<UserMenu />, queryClient);

    await screen.findByText("Owner");
    await user.click(screen.getByRole("button", { name: "Open user menu" }));
    // From now on the session is gone: the API answers 401 to any re-check.
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    await user.click(await screen.findByRole("menuitem", { name: /Log out/ }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["clients", "list"])).toBeUndefined();
    expect(queryClient.getQueryData(currentUserQueryKey)).toBeUndefined();
  });

  it("treats a 401 on logout as already logged out", async () => {
    meMock.mockResolvedValue(makeUser());
    logoutMock.mockRejectedValue(apiError(401, "Authentication required"));
    const queryClient = makeQueryClient();
    const clearSpy = vi.spyOn(queryClient, "clear");
    const { user } = renderWithProviders(<UserMenu />, queryClient);

    await screen.findByText("Owner");
    await user.click(screen.getByRole("button", { name: "Open user menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /Log out/ }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("stays signed in and shows an error when logout fails", async () => {
    meMock.mockResolvedValue(makeUser());
    logoutMock.mockRejectedValue(apiError(null, "Cannot reach the server."));
    const { user, queryClient } = renderWithProviders(<UserMenu />);

    await screen.findByText("Owner");
    await user.click(screen.getByRole("button", { name: "Open user menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /Log out/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not log out");
    expect(router.replace).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(currentUserQueryKey)).toBeDefined();
  });
});
