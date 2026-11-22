import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";
import { authService } from "@/services/auth.service";
import { apiError, deferred, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
const forgotMock = vi.mocked(authService.forgotPassword);

describe("ForgotPasswordForm", () => {
  it("validates the email", async () => {
    const { user } = renderWithProviders(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(forgotMock).not.toHaveBeenCalled();
  });

  it("sends the normalized email and shows the generic success state", async () => {
    forgotMock.mockResolvedValue(null);
    const { user } = renderWithProviders(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), " Asha@Example.com ");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "If an account exists for that email, a password reset link has been sent.",
    );
    expect(forgotMock.mock.calls[0]?.[0]).toEqual({ email: "asha@example.com" });
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("disables submit while pending", async () => {
    const pending = deferred<null>();
    forgotMock.mockReturnValue(pending.promise);
    const { user } = renderWithProviders(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
  });

  it("shows API failures in an alert", async () => {
    forgotMock.mockRejectedValue(apiError(null, "Cannot reach the server."));
    const { user } = renderWithProviders(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot reach the server.",
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});
