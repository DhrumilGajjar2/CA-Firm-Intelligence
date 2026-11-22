import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@ca-firm/shared-types";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";
import { LoginForm } from "@/features/auth/login-form";
import { RegisterForm } from "@/features/auth/register-form";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import { navItemsForRole } from "@/lib/navigation";
import { authService } from "@/services/auth.service";
import { router, setLocation } from "./navigation-mock";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
const loginMock = vi.mocked(authService.login);
const registerMock = vi.mocked(authService.register);
const forgotMock = vi.mocked(authService.forgotPassword);
const resetMock = vi.mocked(authService.resetPassword);

type User = ReturnType<typeof renderWithProviders>["user"];

async function signIn(user: User, email = "a@example.com", password = "Sample-pass-1") {
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginForm: adversarial", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "data:text/html,x",
    "///evil.example",
    "/\t/evil.example",
  ])("never navigates off-site for next=%j", async (next) => {
    setLocation("/login", `next=${encodeURIComponent(next)}`);
    loginMock.mockResolvedValue(makeUser());
    const { user } = renderWithProviders(<LoginForm />);
    await signIn(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  // P1-001: the guard lets dot-segment tricks through as a protocol-relative URL.
  it.each(["/..//evil.example", "/.//evil.example", "/%2e%2e//evil.example"])(
    "P1-001: next=%j must not become an off-site navigation",
    async (next) => {
      setLocation("/login", `next=${encodeURIComponent(next)}`);
      loginMock.mockResolvedValue(makeUser());
      const { user } = renderWithProviders(<LoginForm />);
      await signIn(user);
      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      const target = String(router.replace.mock.calls[0]?.[0]);
      expect(target.startsWith("//")).toBe(false);
      expect(target).not.toContain("evil");
    },
  );

  it("maps server field errors (400) onto the email and password fields", async () => {
    loginMock.mockRejectedValue(
      apiError(400, "Validation failed", {
        code: "VALIDATION_ERROR",
        errors: [
          { field: "email", message: "Enter a valid email address" },
          { field: "password", message: "Password is required" },
        ],
      }),
    );
    const { user } = renderWithProviders(<LoginForm />);
    await signIn(user, "a@example.com", "x");
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("submits only once when the button is clicked twice quickly", async () => {
    loginMock.mockReturnValue(deferred<CurrentUser>().promise);
    const { user } = renderWithProviders(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "Sample-pass-1");
    const button = screen.getByRole("button", { name: "Sign in" });
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Signing in…" }));
    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it("clears the previous error on resubmit and allows another attempt after a failure", async () => {
    loginMock.mockRejectedValueOnce(
      apiError(401, "Invalid email or password", { code: "UNAUTHENTICATED" }),
    );
    const { user } = renderWithProviders(<LoginForm />);
    await signIn(user, "a@example.com", "wrong-pass-1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();

    loginMock.mockResolvedValueOnce(makeUser());
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects an over-long password (129) on the client without calling the API", async () => {
    const { user } = renderWithProviders(<LoginForm />);
    await signIn(user, "a@example.com", "p".repeat(129));
    await waitFor(() =>
      expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true"),
    );
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("does not render the password or any token anywhere in the DOM text after a failure", async () => {
    loginMock.mockRejectedValue(
      apiError(401, "Invalid email or password", { code: "UNAUTHENTICATED" }),
    );
    const { user, container } = renderWithProviders(<LoginForm />);
    await signIn(user, "a@example.com", "Very-secret-pass-1");
    await screen.findByRole("alert");
    expect(container.textContent).not.toContain("Very-secret-pass-1");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });
});

describe("RegisterForm: boundaries and server errors", () => {
  async function fill(user: User, over: Partial<Record<string, string>> = {}) {
    await user.type(screen.getByLabelText("Your name"), over["name"] ?? "Asha Rao");
    await user.type(screen.getByLabelText("Firm name"), over["firm"] ?? "Demo CA");
    await user.type(screen.getByLabelText("Email"), over["email"] ?? "asha@example.com");
    await user.type(
      screen.getByLabelText("Password"),
      over["password"] ?? "Sample-pass-1",
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));
  }

  it.each([
    ["7 characters", "Abcde1x".slice(0, 7), false],
    ["8 characters", "Abcdef12", true],
    ["128 characters", `Aa1${"x".repeat(125)}`, true],
    ["129 characters", `Aa1${"x".repeat(126)}`, false],
    ["letters only", "abcdefghijk", false],
    ["digits only", "123456789012", false],
  ])("password %s -> %s", async (_label, password, accepted) => {
    registerMock.mockResolvedValue(makeUser());
    const { user } = renderWithProviders(<RegisterForm />);
    await fill(user, { password });
    if (accepted) {
      await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1));
    } else {
      await waitFor(() =>
        expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true"),
      );
      expect(registerMock).not.toHaveBeenCalled();
    }
  });

  it("rejects a whitespace-only name and an over-long name / firm name", async () => {
    const { user } = renderWithProviders(<RegisterForm />);
    await fill(user, { name: "     ", firm: "f".repeat(201) });
    expect(await screen.findByText("Your name is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Firm name")).toHaveAttribute("aria-invalid", "true");
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("maps several server field errors at once and keeps the form usable", async () => {
    registerMock.mockRejectedValueOnce(
      apiError(400, "Validation failed", {
        code: "VALIDATION_ERROR",
        errors: [
          { field: "firm_name", message: "Firm name is not allowed" },
          { field: "password", message: "Password is too common" },
        ],
      }),
    );
    const { user } = renderWithProviders(<RegisterForm />);
    await fill(user);
    expect(await screen.findByText("Firm name is not allowed")).toBeInTheDocument();
    expect(screen.getByText("Password is too common")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("after a 409 the user can fix the email and register successfully", async () => {
    registerMock.mockRejectedValueOnce(
      apiError(409, "An account with this email already exists", {
        code: "CONFLICT",
        errors: [{ field: "email", message: "This email is already registered" }],
      }),
    );
    const { user } = renderWithProviders(<RegisterForm />);
    await fill(user);
    expect(
      await screen.findByText("This email is already registered"),
    ).toBeInTheDocument();

    registerMock.mockResolvedValueOnce(makeUser());
    const email = screen.getByLabelText("Email");
    await user.clear(email);
    await user.type(email, "other@example.com");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(
      screen.queryByText("This email is already registered"),
    ).not.toBeInTheDocument();
  });

  it("does not submit twice on a double click and never sends role / firm_id", async () => {
    registerMock.mockReturnValue(deferred<CurrentUser>().promise);
    const { user } = renderWithProviders(<RegisterForm />);
    await fill(user);
    const pending = await screen.findByRole("button", { name: "Creating account…" });
    await user.click(pending);
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(registerMock.mock.calls[0]![0]).sort()).toEqual([
      "email",
      "firm_name",
      "name",
      "password",
    ]);
  });
});

describe("ForgotPasswordForm: more cases", () => {
  it("shows the empty-email validation message and does not call the API", async () => {
    const { user } = renderWithProviders(<ForgotPasswordForm />);
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(forgotMock).not.toHaveBeenCalled();
  });

  it("maps a server-side email field error onto the field", async () => {
    forgotMock.mockRejectedValue(
      apiError(400, "Validation failed", {
        code: "VALIDATION_ERROR",
        errors: [{ field: "email", message: "Enter a valid email address" }],
      }),
    );
    const { user } = renderWithProviders(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("the success message is the same generic text regardless of the address (no enumeration in the UI)", async () => {
    forgotMock.mockResolvedValue(null);
    const first = renderWithProviders(<ForgotPasswordForm />);
    await first.user.type(screen.getByLabelText("Email"), "known@example.com");
    await first.user.click(screen.getByRole("button", { name: "Send reset link" }));
    const known = (await screen.findByRole("status")).textContent;
    first.unmount();

    const second = renderWithProviders(<ForgotPasswordForm />);
    await second.user.type(screen.getByLabelText("Email"), "ghost@example.com");
    await second.user.click(screen.getByRole("button", { name: "Send reset link" }));
    const unknown = (await screen.findByRole("status")).textContent;
    expect(unknown).toBe(known);
    expect(known).not.toContain("example.com");
  });
});

describe("ResetPasswordForm: more cases", () => {
  async function submit(user: User, password: string, confirm = password) {
    await user.type(screen.getByLabelText("New password"), password);
    await user.type(screen.getByLabelText("Confirm new password"), confirm);
    await user.click(screen.getByRole("button", { name: "Reset password" }));
  }

  it("treats an empty ?token= like a missing token", () => {
    setLocation("/reset-password", "token=");
    renderWithProviders(<ResetPasswordForm />);
    expect(screen.getByText("Reset link is missing")).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(resetMock).not.toHaveBeenCalled();
  });

  it.each([
    ["letters only", "abcdefghijk", "Password must contain a number"],
    ["digits only", "123456789012", "Password must contain a letter"],
    ["7 characters", "Abcde12", "Password must be at least 8 characters"],
  ])("rejects a %s password on the client", async (_label, password, message) => {
    setLocation("/reset-password", "token=tok");
    const { user } = renderWithProviders(<ResetPasswordForm />);
    await submit(user, password);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("rejects a 129-character password on the client", async () => {
    setLocation("/reset-password", "token=tok");
    const { user } = renderWithProviders(<ResetPasswordForm />);
    await submit(user, `Aa1${"x".repeat(126)}`);
    expect(await screen.findByText(/at most 128/)).toBeInTheDocument();
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("sends a base64url token unchanged and never prints it in the page", async () => {
    const token = "Ab-_09xyzABC-_09xyzABC-_09xyzABC-_09xyzABC12";
    setLocation("/reset-password", `token=${token}`);
    resetMock.mockResolvedValue(null);
    const { user, container } = renderWithProviders(<ResetPasswordForm />);
    expect(container.innerHTML).not.toContain(token);
    await submit(user, "Sample-pass-1");
    await screen.findByText("Password updated");
    expect(resetMock.mock.calls[0]?.[0]).toEqual({ token, password: "Sample-pass-1" });
    expect(container.innerHTML).not.toContain(token);
  });

  it("shows a generic alert for a 500 and keeps the form so the user can retry", async () => {
    setLocation("/reset-password", "token=tok");
    resetMock.mockRejectedValueOnce(apiError(500, "Internal server error"));
    const { user } = renderWithProviders(<ResetPasswordForm />);
    await submit(user, "Sample-pass-1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Internal server error");
    expect(screen.getByRole("button", { name: "Reset password" })).toBeEnabled();
    expect(screen.queryByText("Password updated")).not.toBeInTheDocument();
  });

  it("after success the form (and its password inputs) are gone", async () => {
    setLocation("/reset-password", "token=tok");
    resetMock.mockResolvedValue(null);
    const { user } = renderWithProviders(<ResetPasswordForm />);
    await submit(user, "Sample-pass-1");
    await screen.findByText("Password updated");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm new password")).not.toBeInTheDocument();
  });
});

describe("navigation: role hardening", () => {
  it("an unknown or forged role string shows no navigation at all", () => {
    for (const role of ["superadmin", "OWNER", "", "admin"]) {
      expect(navItemsForRole(role as UserRole)).toEqual([]);
    }
  });

  it("employees never see Clients, Services, Employees, Finance, Reports, Imports or Settings", () => {
    const labels = navItemsForRole("employee").map((i) => i.label);
    for (const hidden of [
      "Clients",
      "Services",
      "Employees",
      "Finance",
      "Reports",
      "Imports",
      "Settings",
    ]) {
      expect(labels).not.toContain(hidden);
    }
  });

  it("only the owner sees Settings; viewers see no write/finance/admin areas", () => {
    for (const role of ["manager", "employee", "viewer"] as UserRole[]) {
      expect(navItemsForRole(role).map((i) => i.label)).not.toContain("Settings");
    }
    const viewer = navItemsForRole("viewer").map((i) => i.label);
    for (const hidden of ["Finance", "Imports", "Services", "Employees"]) {
      expect(viewer).not.toContain(hidden);
    }
  });

  it("every item points at a distinct, absolute, non-auth path", () => {
    const owner = navItemsForRole("owner");
    const hrefs = owner.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/[a-z-]+$/);
      expect(href).not.toMatch(/login|register|reset-password|forgot-password/);
    }
  });
});
