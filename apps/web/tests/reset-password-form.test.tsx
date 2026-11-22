import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import { authService } from "@/services/auth.service";
import { setLocation } from "./navigation-mock";
import { apiError, deferred, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
const resetMock = vi.mocked(authService.resetPassword);

describe("ResetPasswordForm", () => {
  it("shows a missing-token state with a link to request a new link", () => {
    setLocation("/reset-password");
    renderWithProviders(<ResetPasswordForm />);

    expect(screen.getByText("Reset link is missing")).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Request a new reset link" }),
    ).toHaveAttribute("href", "/forgot-password");
  });

  it("validates password rules and confirmation", async () => {
    setLocation("/reset-password", "token=abc");
    const { user } = renderWithProviders(<ResetPasswordForm />);

    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(
      await screen.findByText("Password must be at least 8 characters"),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("New password"), "Sample-pass-1");
    await user.type(screen.getByLabelText("Confirm new password"), "Different-pass-1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("submits token + password and shows success with a link to login", async () => {
    setLocation("/reset-password", "token=tok-123");
    resetMock.mockResolvedValue(null);
    const { user } = renderWithProviders(<ResetPasswordForm />);

    await user.type(screen.getByLabelText("New password"), "Sample-pass-1");
    await user.type(screen.getByLabelText("Confirm new password"), "Sample-pass-1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password updated")).toBeInTheDocument();
    expect(resetMock.mock.calls[0]?.[0]).toEqual({
      token: "tok-123",
      password: "Sample-pass-1",
    });
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("shows an invalid or expired link error with a way to request a new one", async () => {
    setLocation("/reset-password", "token=expired");
    resetMock.mockRejectedValue(
      apiError(400, "Reset link is invalid or has expired", { code: "BAD_REQUEST" }),
    );
    const { user } = renderWithProviders(<ResetPasswordForm />);

    await user.type(screen.getByLabelText("New password"), "Sample-pass-1");
    await user.type(screen.getByLabelText("Confirm new password"), "Sample-pass-1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Reset link is invalid or has expired",
    );
    expect(
      screen.getByRole("link", { name: "Request a new reset link" }),
    ).toHaveAttribute("href", "/forgot-password");
  });

  it("maps a server password error onto the password field", async () => {
    setLocation("/reset-password", "token=tok");
    resetMock.mockRejectedValue(
      apiError(400, "Validation failed", {
        code: "VALIDATION_ERROR",
        errors: [{ field: "password", message: "Password is too common" }],
      }),
    );
    const { user } = renderWithProviders(<ResetPasswordForm />);

    await user.type(screen.getByLabelText("New password"), "Password123");
    await user.type(screen.getByLabelText("Confirm new password"), "Password123");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password is too common")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables submit while pending", async () => {
    setLocation("/reset-password", "token=tok");
    resetMock.mockReturnValue(deferred<null>().promise);
    const { user } = renderWithProviders(<ResetPasswordForm />);

    await user.type(screen.getByLabelText("New password"), "Sample-pass-1");
    await user.type(screen.getByLabelText("Confirm new password"), "Sample-pass-1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("button", { name: "Updating…" })).toBeDisabled();
  });
});
