import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@ca-firm/shared-types";
import { RedirectIfAuthenticated } from "@/features/auth/redirect-if-authenticated";
import { RequireAuth } from "@/features/auth/require-auth";
import { RootRedirect } from "@/features/auth/root-redirect";
import { authService } from "@/services/auth.service";
import { clearSignedOutByUser, markSignedOutByUser } from "@/features/auth/session-state";
import { router, setLocation } from "./navigation-mock";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
const meMock = vi.mocked(authService.me);

function Protected() {
  return <p>Secret dashboard</p>;
}

describe("RequireAuth (dashboard guard)", () => {
  it("shows a loading state and no protected content while resolving", () => {
    meMock.mockReturnValue(deferred<CurrentUser>().promise);
    renderWithProviders(
      <RequireAuth>
        <Protected />
      </RequireAuth>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading your workspace");
    expect(screen.queryByText("Secret dashboard")).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("renders children for an authenticated user", async () => {
    meMock.mockResolvedValue(makeUser("manager"));
    renderWithProviders(
      <RequireAuth>
        <Protected />
      </RequireAuth>,
    );
    expect(await screen.findByText("Secret dashboard")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("redirects a 401 to /login preserving the intended path in next", async () => {
    setLocation("/clients", "page=2");
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    renderWithProviders(
      <RequireAuth>
        <Protected />
      </RequireAuth>,
    );

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/clients?page=2")}`,
      ),
    );
    expect(screen.queryByText("Secret dashboard")).not.toBeInTheDocument();
  });

  it("does not add next to the login redirect right after a deliberate logout", async () => {
    setLocation("/clients");
    markSignedOutByUser();
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    renderWithProviders(
      <RequireAuth>
        <Protected />
      </RequireAuth>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    clearSignedOutByUser();
  });

  it("shows an error with retry (and does not redirect) on a server or network error", async () => {
    meMock.mockRejectedValueOnce(apiError(null, "Cannot reach the server."));
    const { user } = renderWithProviders(
      <RequireAuth>
        <Protected />
      </RequireAuth>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot reach the server.",
    );
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("Secret dashboard")).not.toBeInTheDocument();

    meMock.mockResolvedValueOnce(makeUser("owner"));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Secret dashboard")).toBeInTheDocument();
    expect(meMock).toHaveBeenCalledTimes(2);
  });

  it("treats a 500 like other server errors (retry, no redirect)", async () => {
    meMock.mockRejectedValue(apiError(500, "Internal error", { code: "INTERNAL_ERROR" }));
    renderWithProviders(
      <RequireAuth>
        <Protected />
      </RequireAuth>,
    );
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("RedirectIfAuthenticated (auth pages)", () => {
  it("sends a signed-in user to the dashboard and hides the form", async () => {
    setLocation("/login");
    meMock.mockResolvedValue(makeUser());
    renderWithProviders(
      <RedirectIfAuthenticated>
        <p>Login form</p>
      </RedirectIfAuthenticated>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText("Login form")).not.toBeInTheDocument();
  });

  it("honours a safe next and ignores an unsafe one", async () => {
    setLocation("/login", "next=%2F%2Fevil.example");
    meMock.mockResolvedValue(makeUser());
    renderWithProviders(
      <RedirectIfAuthenticated>
        <p>Login form</p>
      </RedirectIfAuthenticated>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("shows the form when signed out (401)", async () => {
    setLocation("/login");
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    renderWithProviders(
      <RedirectIfAuthenticated>
        <p>Login form</p>
      </RedirectIfAuthenticated>,
    );
    expect(await screen.findByText("Login form")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows the form when the API is unreachable", async () => {
    setLocation("/register");
    meMock.mockRejectedValue(apiError(null, "Cannot reach the server."));
    renderWithProviders(
      <RedirectIfAuthenticated>
        <p>Register form</p>
      </RedirectIfAuthenticated>,
    );
    expect(await screen.findByText("Register form")).toBeInTheDocument();
  });

  it("does not hide the reset-password page from a signed-in user", async () => {
    setLocation("/reset-password", "token=abc");
    meMock.mockResolvedValue(makeUser());
    renderWithProviders(
      <RedirectIfAuthenticated>
        <p>Reset form</p>
      </RedirectIfAuthenticated>,
    );
    expect(await screen.findByText("Reset form")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("RootRedirect", () => {
  it("goes to the dashboard when signed in", async () => {
    meMock.mockResolvedValue(makeUser());
    renderWithProviders(<RootRedirect />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("goes to login when signed out", async () => {
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    renderWithProviders(<RootRedirect />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  });

  it("shows an error with retry when the API fails", async () => {
    meMock.mockRejectedValue(apiError(null, "Cannot reach the server."));
    renderWithProviders(<RootRedirect />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
