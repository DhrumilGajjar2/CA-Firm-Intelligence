import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, InvitationPreview } from "@ca-firm/shared-types";
import { AcceptInvitationForm } from "@/features/auth/accept-invitation-form";
import { RedirectIfAuthenticated } from "@/features/auth/redirect-if-authenticated";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { authService } from "@/services/auth.service";
import { router, setLocation } from "./navigation-mock";
import {
  apiError,
  deferred,
  makeQueryClient,
  makeUser,
  renderWithProviders,
} from "./utils";

vi.mock("@/services/auth.service");
const meMock = vi.mocked(authService.me);
const getInvitation = vi.mocked(authService.getInvitation);
const acceptInvitation = vi.mocked(authService.acceptInvitation);

const preview: InvitationPreview = {
  email: "staff@example.com",
  role: "manager",
  firm_name: "Demo CA Associates",
  expires_at: "2026-11-28T10:00:00.000Z",
};

beforeEach(() => {
  setLocation("/accept-invitation", "token=abc123");
  meMock.mockRejectedValue(apiError(401, "Authentication required"));
  getInvitation.mockResolvedValue(preview);
});

async function fillAndSubmit(
  user: ReturnType<typeof renderWithProviders>["user"],
  values: { name?: string; password?: string; confirm?: string } = {},
) {
  await user.type(screen.getByLabelText("Your name"), values.name ?? "Karan Patel");
  await user.type(screen.getByLabelText("Password"), values.password ?? "Sample-pass-1");
  await user.type(
    screen.getByLabelText("Confirm password"),
    values.confirm ?? values.password ?? "Sample-pass-1",
  );
  await user.click(screen.getByRole("button", { name: "Accept invitation" }));
}

describe("AcceptInvitationForm: link states", () => {
  it("explains a missing token and links to sign in without calling the API", () => {
    setLocation("/accept-invitation");
    renderWithProviders(<AcceptInvitationForm />);
    expect(screen.getByText("Invitation link is missing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(getInvitation).not.toHaveBeenCalled();
  });

  it("shows a loading state while the invitation loads", () => {
    getInvitation.mockReturnValue(deferred<InvitationPreview>().promise);
    renderWithProviders(<AcceptInvitationForm />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
  });

  it("looks the invitation up by the token from the URL", async () => {
    renderWithProviders(<AcceptInvitationForm />);
    await screen.findByLabelText("Your name");
    expect(getInvitation).toHaveBeenCalledWith("abc123");
  });

  it("shows one generic message for an invalid, expired or used link (404)", async () => {
    getInvitation.mockRejectedValue(apiError(404, "Not found", { code: "NOT_FOUND" }));
    renderWithProviders(<AcceptInvitationForm />);

    expect(
      await screen.findByText("This invitation link is not valid"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/expired, was revoked, or has already been used/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
  });

  it("offers a retry when the preview fails for another reason", async () => {
    getInvitation.mockRejectedValueOnce(apiError(500, "Server exploded"));
    const { user } = renderWithProviders(<AcceptInvitationForm />);

    expect(await screen.findByText("Server exploded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
  });

  it("shows the firm, the read-only invited email, the role and the password rules", async () => {
    renderWithProviders(<AcceptInvitationForm />);

    expect(await screen.findByText("Join Demo CA Associates")).toBeInTheDocument();
    expect(screen.getByText(/invited as Manager/)).toBeInTheDocument();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("staff@example.com");
    expect(email).toHaveAttribute("readonly");
    expect(
      screen.getByRole("list", { name: "Password requirements" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/currently signed in/)).not.toBeInTheDocument();
  });
});

describe("AcceptInvitationForm: submitting", () => {
  it("validates name and password with acceptInvitationSchema", async () => {
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByLabelText("Your name");

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByText("Your name is required")).toBeInTheDocument();
    expect(
      screen.getByText("Password must be at least 8 characters"),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Your name"), "Karan");
    await user.type(screen.getByLabelText("Password"), "onlyletters");
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByText("Password must contain a number")).toBeInTheDocument();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("requires the confirmation to match", async () => {
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByLabelText("Your name");
    await fillAndSubmit(user, { password: "Sample-pass-1", confirm: "Different-pass-2" });

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("sends token, name and password only (never the confirmation or email)", async () => {
    acceptInvitation.mockResolvedValue(makeUser("manager"));
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByLabelText("Your name");
    await fillAndSubmit(user);

    await waitFor(() =>
      expect(acceptInvitation).toHaveBeenCalledWith({
        token: "abc123",
        name: "Karan Patel",
        password: "Sample-pass-1",
      }),
    );
  });

  it("sets the session from the response and goes to the dashboard", async () => {
    const created = makeUser("manager", { id: "new-user", name: "Karan Patel" });
    acceptInvitation.mockResolvedValue(created);
    const queryClient = makeQueryClient();
    const { user } = renderWithProviders(<AcceptInvitationForm />, queryClient);
    await screen.findByLabelText("Your name");
    await fillAndSubmit(user);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(queryClient.getQueryData<CurrentUser>(currentUserQueryKey)).toEqual(created);
  });

  it("drops data cached for a previous session when accepting", async () => {
    acceptInvitation.mockResolvedValue(makeUser("employee"));
    const queryClient = makeQueryClient();
    queryClient.setQueryData(["users", "list"], [{ id: "old" }]);
    const { user } = renderWithProviders(<AcceptInvitationForm />, queryClient);
    await screen.findByLabelText("Your name");
    await fillAndSubmit(user);

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(queryClient.getQueryData(["users", "list"])).toBeUndefined();
  });

  it("disables the button while accepting", async () => {
    const pending = deferred<CurrentUser>();
    acceptInvitation.mockReturnValue(pending.promise);
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByLabelText("Your name");
    await fillAndSubmit(user);

    expect(
      await screen.findByRole("button", { name: "Creating account…" }),
    ).toBeDisabled();
    pending.resolve(makeUser("manager"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("shows a clear message and a sign-in link on 409 (email already registered)", async () => {
    acceptInvitation.mockRejectedValue(
      apiError(409, "Email already registered", {
        code: "CONFLICT",
        errors: [{ field: "email", message: "Email already registered" }],
      }),
    );
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByLabelText("Your name");
    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account with this email address already exists",
    );
    expect(screen.getByRole("link", { name: "Go to sign in" })).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows the link-no-longer-valid message when accepting returns 404", async () => {
    acceptInvitation.mockRejectedValue(apiError(404, "Not found", { code: "NOT_FOUND" }));
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByLabelText("Your name");
    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer valid");
    expect(screen.getByRole("link", { name: "Go to sign in" })).toBeInTheDocument();
  });

  it("maps server field errors onto the form fields", async () => {
    acceptInvitation.mockRejectedValue(
      apiError(400, "Validation failed", {
        code: "VALIDATION_ERROR",
        errors: [{ field: "password", message: "Password is too common" }],
      }),
    );
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByLabelText("Your name");
    await fillAndSubmit(user);

    expect(await screen.findByText("Password is too common")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a network failure as a message", async () => {
    acceptInvitation.mockRejectedValue(
      apiError(null, "Cannot reach the server.", { code: "NETWORK_ERROR" }),
    );
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByLabelText("Your name");
    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot reach the server.",
    );
  });
});

describe("AcceptInvitationForm: someone is already signed in", () => {
  beforeEach(() => {
    meMock.mockResolvedValue(makeUser("owner", { email: "asha@example.com" }));
  });

  it("shows the form with a notice that accepting replaces the current session", async () => {
    renderWithProviders(<AcceptInvitationForm />);
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
    expect(await screen.findByText(/signed in as asha@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/will sign you out of that account/)).toBeInTheDocument();
  });

  it("is not redirected away by the auth layout guard (unlike /login)", async () => {
    renderWithProviders(
      <RedirectIfAuthenticated>
        <AcceptInvitationForm />
      </RedirectIfAuthenticated>,
    );
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
    await screen.findByText(/signed in as asha@example.com/);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("accepting replaces the cached session with the new user", async () => {
    const created = makeUser("employee", { id: "new-user", email: "staff@example.com" });
    acceptInvitation.mockResolvedValue(created);
    const queryClient = makeQueryClient();
    const { user } = renderWithProviders(<AcceptInvitationForm />, queryClient);
    await screen.findByText(/signed in as asha@example.com/);
    await fillAndSubmit(user);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(queryClient.getQueryData<CurrentUser>(currentUserQueryKey)).toEqual(created);
  });
});
