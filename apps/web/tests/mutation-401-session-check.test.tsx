import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMutation } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers";
import { LoginForm } from "@/features/auth/login-form";
import { RequireAuth } from "@/features/auth/require-auth";
import { useCurrentUser } from "@/features/auth/use-current-user";
import { useLogout } from "@/features/auth/use-logout";
import { clearSignedOutByUser } from "@/features/auth/session-state";
import { authService } from "@/services/auth.service";
import { router, setLocation } from "./navigation-mock";
import { apiError, makeUser } from "./utils";

/** P1-008: a 401 on a mutation re-checks the session; auth-form mutations are exempt. */
vi.mock("@/services/auth.service");
const meMock = vi.mocked(authService.me);
const loginMock = vi.mocked(authService.login);
const logoutMock = vi.mocked(authService.logout);

const unauthenticated = () => apiError(401, "Authentication required", { code: "UNAUTHENTICATED" });

/** Keeps the current-user query mounted, like the app shell does. */
function SessionProbe() {
  useCurrentUser();
  return null;
}

/** A save button wired the way feature mutations are (no meta, no special handling). */
function SaveButton({ save }: { save: () => Promise<unknown> }) {
  const mutation = useMutation({ mutationFn: save });
  return (
    <>
      <button type="button" onClick={() => mutation.mutate()}>
        Save
      </button>
      {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
    </>
  );
}

function LogoutButton() {
  const logout = useLogout();
  return (
    <button type="button" onClick={() => logout.mutate()}>
      Log out
    </button>
  );
}

beforeEach(() => {
  clearSignedOutByUser();
  meMock.mockResolvedValue(makeUser("owner"));
});

describe("401 on a mutation elsewhere (settings, onboarding, team)", () => {
  it("re-runs the session check and redirects to /login?next=", async () => {
    setLocation("/settings");
    const user = userEvent.setup();
    render(
      <Providers>
        <RequireAuth>
          <SaveButton save={() => Promise.reject(unauthenticated())} />
        </RequireAuth>
      </Providers>,
    );
    const save = await screen.findByRole("button", { name: "Save" });
    expect(meMock).toHaveBeenCalledTimes(1);
    meMock.mockRejectedValue(unauthenticated()); // the session is gone from now on
    await user.click(save);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?next=%2Fsettings"));
    expect(meMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [403, "FORBIDDEN"],
    [422, "VALIDATION_ERROR"],
    [500, "INTERNAL_ERROR"],
  ])("does not re-check the session for a %i", async (status, code) => {
    const user = userEvent.setup();
    render(
      <Providers>
        <SessionProbe />
        <SaveButton save={() => Promise.reject(apiError(status, "Nope", { code }))} />
      </Providers>,
    );
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope");
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("auth-form mutations are exempt", () => {
  it("a wrong-password 401 on login stays on the login page with its error and does not re-check", async () => {
    setLocation("/login");
    loginMock.mockRejectedValue(
      apiError(401, "Invalid email or password", { code: "UNAUTHENTICATED" }),
    );
    const user = userEvent.setup();
    render(
      <Providers>
        <SessionProbe />
        <LoginForm />
      </Providers>,
    );
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.type(screen.getByLabelText("Password"), "Wrong-pass-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(loginMock).toHaveBeenCalledTimes(1);
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    // Still usable: the form is back to its idle state.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("logout with an already-ended session (401) goes to a plain /login, without next", async () => {
    setLocation("/settings");
    logoutMock.mockRejectedValue(unauthenticated());
    const user = userEvent.setup();
    render(
      <Providers>
        <RequireAuth>
          <LogoutButton />
        </RequireAuth>
      </Providers>,
    );
    meMock.mockRejectedValue(unauthenticated());
    await user.click(await screen.findByRole("button", { name: "Log out" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(router.replace).not.toHaveBeenCalledWith(expect.stringContaining("next="));
  });
});
