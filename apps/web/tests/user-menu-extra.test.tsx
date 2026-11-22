import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserMenu } from "@/components/layout/user-menu";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { authService } from "@/services/auth.service";
import { router } from "./navigation-mock";
import {
  apiError,
  deferred,
  makeQueryClient,
  makeUser,
  renderWithProviders,
} from "./utils";

vi.mock("@/services/auth.service");
const meMock = vi.mocked(authService.me);
const logoutMock = vi.mocked(authService.logout);

async function openAndLogOut(user: ReturnType<typeof renderWithProviders>["user"]) {
  await user.click(screen.getByRole("button", { name: "Open user menu" }));
  await user.click(await screen.findByRole("menuitem", { name: /Log out/ }));
}

describe("UserMenu logout: failure handling and pending state", () => {
  it("after a failed logout the user stays signed in and can retry successfully", async () => {
    meMock.mockResolvedValue(makeUser("manager"));
    logoutMock.mockRejectedValueOnce(apiError(500, "Internal server error"));
    const queryClient = makeQueryClient();
    const { user } = renderWithProviders(<UserMenu />, queryClient);

    await screen.findByText("Manager");
    await openAndLogOut(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not log out");
    expect(router.replace).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(currentUserQueryKey)).toBeDefined();

    logoutMock.mockResolvedValueOnce(null);
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    await openAndLogOut(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(logoutMock).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(currentUserQueryKey)).toBeUndefined();
  });

  it("a 403 or 500 on logout does NOT clear the cache or navigate (only 401 means already signed out)", async () => {
    for (const err of [
      apiError(403, "Forbidden", { code: "FORBIDDEN" }),
      apiError(500, "Internal server error"),
      apiError(null, "Cannot reach the server."),
    ]) {
      logoutMock.mockReset();
      meMock.mockResolvedValue(makeUser("owner"));
      logoutMock.mockRejectedValue(err);
      const queryClient = makeQueryClient();
      queryClient.setQueryData(["clients", "list"], [{ id: "c1" }]);
      const { user, unmount } = renderWithProviders(<UserMenu />, queryClient);
      await screen.findByText("Owner");
      await openAndLogOut(user);
      await screen.findByRole("alert");
      expect(router.replace).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(["clients", "list"])).toBeDefined();
      unmount();
    }
  });

  it("while the logout request is pending the menu entry is disabled (no double logout)", async () => {
    meMock.mockResolvedValue(makeUser("owner"));
    const pending = deferred<null>();
    logoutMock.mockReturnValue(pending.promise);
    const { user } = renderWithProviders(<UserMenu />);
    await screen.findByText("Owner");
    await openAndLogOut(user);

    await user.click(screen.getByRole("button", { name: "Open user menu" }));
    const item = await screen.findByRole("menuitem", { name: /Logging out/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    await user.click(item);
    expect(logoutMock).toHaveBeenCalledTimes(1);

    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    pending.resolve(null);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  });

  it("renders nothing for the menu (no stale identity) once the user is gone from the cache", async () => {
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    renderWithProviders(<UserMenu />);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open user menu" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
  });
});
