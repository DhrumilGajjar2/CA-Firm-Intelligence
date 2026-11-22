import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@ca-firm/shared-types";
import { RegisterForm } from "@/features/auth/register-form";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { authService } from "@/services/auth.service";
import { router } from "./navigation-mock";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
const registerMock = vi.mocked(authService.register);

async function fillValid(user: ReturnType<typeof renderWithProviders>["user"]) {
  await user.type(screen.getByLabelText("Your name"), "  Asha Rao ");
  await user.type(screen.getByLabelText("Firm name"), "Demo CA Associates");
  await user.type(screen.getByLabelText("Email"), "Asha@Example.com");
  await user.type(screen.getByLabelText("Password"), "Sample-pass-1");
}

describe("RegisterForm", () => {
  it("shows the password rules and updates them as you type", async () => {
    const { user } = renderWithProviders(<RegisterForm />);
    const rules = screen.getByRole("list", { name: "Password requirements" });
    expect(rules).toHaveTextContent("At least 8 characters");
    expect(rules).toHaveTextContent("Contains a letter");
    expect(rules).toHaveTextContent("Contains a number");
    expect(rules.querySelectorAll("[data-met='true']")).toHaveLength(0);

    await user.type(screen.getByLabelText("Password"), "abcdefg1");
    expect(rules.querySelectorAll("[data-met='true']")).toHaveLength(3);
  });

  it("shows validation messages for every field", async () => {
    const { user } = renderWithProviders(<RegisterForm />);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Your name is required")).toBeInTheDocument();
    expect(screen.getByText("Firm name is required")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(
      screen.getByText("Password must be at least 8 characters"),
    ).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("rejects a password without a number", async () => {
    const { user } = renderWithProviders(<RegisterForm />);
    await user.type(screen.getByLabelText("Password"), "onlyletters");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Password must contain a number")).toBeInTheDocument();
  });

  it("submits normalized input, caches the user and navigates", async () => {
    const owner = makeUser("owner");
    registerMock.mockResolvedValue(owner);
    const { user, queryClient } = renderWithProviders(<RegisterForm />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(registerMock.mock.calls[0]?.[0]).toEqual({
      name: "Asha Rao",
      firm_name: "Demo CA Associates",
      email: "asha@example.com",
      password: "Sample-pass-1",
    });
    expect(queryClient.getQueryData(currentUserQueryKey)).toEqual(owner);
  });

  it("maps a 409 onto the email field (no generic alert)", async () => {
    registerMock.mockRejectedValue(
      apiError(409, "Email already registered", {
        code: "CONFLICT",
        errors: [{ field: "email", message: "This email is already registered" }],
      }),
    );
    const { user } = renderWithProviders(<RegisterForm />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const message = await screen.findByText("This email is already registered");
    expect(message).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "aria-describedby",
      message.id,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows server errors without a field in an alert", async () => {
    registerMock.mockRejectedValue(
      apiError(500, "Something went wrong. Please try again."),
    );
    const { user } = renderWithProviders(<RegisterForm />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("disables submit while pending", async () => {
    const pending = deferred<CurrentUser>();
    registerMock.mockReturnValue(pending.promise);
    const { user } = renderWithProviders(<RegisterForm />);
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByRole("button", { name: "Creating account…" }),
    ).toBeDisabled();
    pending.resolve(makeUser());
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });
});
