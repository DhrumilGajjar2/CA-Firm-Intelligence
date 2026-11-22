import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@ca-firm/shared-types";
import { LoginForm } from "@/features/auth/login-form";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { authService } from "@/services/auth.service";
import { router, setLocation } from "./navigation-mock";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
const loginMock = vi.mocked(authService.login);

describe("LoginForm", () => {
  it("shows validation messages and does not call the API", async () => {
    const { user } = renderWithProviders(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("submits normalized input, caches the user and goes to the dashboard", async () => {
    const owner = makeUser("owner");
    loginMock.mockResolvedValue(owner);
    const { user, queryClient } = renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "  Asha@Example.COM ");
    await user.type(screen.getByLabelText("Password"), "Sample-pass-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(loginMock.mock.calls[0]?.[0]).toEqual({
      email: "asha@example.com",
      password: "Sample-pass-1",
    });
    expect(queryClient.getQueryData(currentUserQueryKey)).toEqual(owner);
  });

  it("honours a same-origin next path after login", async () => {
    setLocation("/login", "next=%2Fclients%3Fpage%3D2");
    loginMock.mockResolvedValue(makeUser("manager"));
    const { user } = renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "m@example.com");
    await user.type(screen.getByLabelText("Password"), "Sample-pass-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/clients?page=2"));
  });

  it("ignores an external next URL (open redirect)", async () => {
    setLocation("/login", "next=https%3A%2F%2Fevil.example%2Fphish");
    loginMock.mockResolvedValue(makeUser());
    const { user } = renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "Sample-pass-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(router.replace).not.toHaveBeenCalledWith(expect.stringContaining("evil"));
  });

  it("shows a non-field API error in an alert", async () => {
    loginMock.mockRejectedValue(
      apiError(401, "Invalid email or password", { code: "UNAUTHENTICATED" }),
    );
    const { user } = renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-pass-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows a network error in an alert", async () => {
    loginMock.mockRejectedValue(
      apiError(null, "Cannot reach the server. Check your connection and try again."),
    );
    const { user } = renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "Sample-pass-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the server");
  });

  it("disables submit while the request is pending", async () => {
    const pending = deferred<CurrentUser>();
    loginMock.mockReturnValue(pending.promise);
    const { user } = renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "Sample-pass-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const button = await screen.findByRole("button", { name: "Signing in…" });
    expect(button).toBeDisabled();
    pending.resolve(makeUser());
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it("toggles password visibility", async () => {
    const { user } = renderWithProviders(<LoginForm />);
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("links to registration and password reset", () => {
    renderWithProviders(<LoginForm />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register",
    );
  });
});
