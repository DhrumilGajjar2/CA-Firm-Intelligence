import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers";
import { AcceptInvitationForm } from "@/features/auth/accept-invitation-form";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";
import { RegisterForm } from "@/features/auth/register-form";
import { RequireAuth } from "@/features/auth/require-auth";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import { clearSignedOutByUser } from "@/features/auth/session-state";
import { useCurrentUser } from "@/features/auth/use-current-user";
import { ProfileView } from "@/features/profile/profile-view";
import { TeamView } from "@/features/users/team-view";
import { authService } from "@/services/auth.service";
import { invitationsService } from "@/services/invitations.service";
import { usersService } from "@/services/users.service";
import { router, setLocation } from "./navigation-mock";
import { envelope, makeCreatedInvitation, makeInvitation, TEAM } from "./team-fixtures";
import { apiError, makeUser } from "./utils";

/**
 * QA re-verification of P1-008 beyond the original evidence: a 401 answering a mutation anywhere in the
 * signed-in app triggers the session re-check and the redirect; 401s on auth forms (wrong password and
 * friends) do not.
 */
vi.mock("@/services/auth.service");
vi.mock("@/services/users.service");
vi.mock("@/services/invitations.service");
const meMock = vi.mocked(authService.me);
const listUsers = vi.mocked(usersService.list);
const listInvitations = vi.mocked(invitationsService.list);

const unauthenticated = () =>
  apiError(401, "Authentication required", { code: "UNAUTHENTICATED" });

function SessionProbe() {
  useCurrentUser();
  return null;
}

beforeEach(() => {
  clearSignedOutByUser();
  meMock.mockResolvedValue(makeUser("owner"));
  listUsers.mockResolvedValue(envelope(TEAM));
  listInvitations.mockResolvedValue(envelope([makeInvitation()]));
});

async function openTeam() {
  setLocation("/employees");
  const user = userEvent.setup();
  render(
    <Providers>
      <RequireAuth>
        <TeamView />
      </RequireAuth>
    </Providers>,
  );
  await screen.findByText("Meera Shah");
  await screen.findByText("newhire@example.com");
  return user;
}

const expireSession = () => meMock.mockRejectedValue(unauthenticated());
const redirectedToLogin = () =>
  waitFor(
    () => expect(router.replace).toHaveBeenCalledWith("/login?next=%2Femployees"),
    { timeout: 2500 },
  );

describe("P1-008: a 401 on a team mutation re-checks the session and redirects to /login?next=", () => {
  it("inviting a user", async () => {
    vi.mocked(usersService.invite).mockRejectedValue(unauthenticated());
    const user = await openTeam();
    await user.click(screen.getByRole("button", { name: /Invite user/ }));
    await user.type(await screen.findByLabelText("Email"), "late@example.com");
    expireSession();
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await redirectedToLogin();
    expect(meMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("changing a role", async () => {
    vi.mocked(usersService.updateRole).mockRejectedValue(unauthenticated());
    const user = await openTeam();
    await user.click(screen.getByRole("button", { name: "Change role for Meera Shah" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("New role"), "viewer");
    expireSession();
    await user.click(within(dialog).getByRole("button", { name: "Change role" }));
    await redirectedToLogin();
  });

  it("deactivating a user", async () => {
    vi.mocked(usersService.updateStatus).mockRejectedValue(unauthenticated());
    const user = await openTeam();
    await user.click(screen.getByRole("button", { name: "Deactivate Meera Shah" }));
    const dialog = await screen.findByRole("dialog");
    expireSession();
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await redirectedToLogin();
  });

  it("revoking an invitation", async () => {
    vi.mocked(invitationsService.revoke).mockRejectedValue(unauthenticated());
    const user = await openTeam();
    await user.click(screen.getByRole("button", { name: "Revoke invitation for newhire@example.com" }));
    const dialog = await screen.findByRole("dialog");
    expireSession();
    await user.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));
    await redirectedToLogin();
  });

  it("saving the profile name", async () => {
    setLocation("/profile");
    vi.mocked(usersService.update).mockRejectedValue(unauthenticated());
    const user = userEvent.setup();
    render(
      <Providers>
        <RequireAuth>
          <ProfileView />
        </RequireAuth>
      </Providers>,
    );
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Asha R. Rao");
    expireSession();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?next=%2Fprofile"), { timeout: 2500 });
  });

  it("a 401 whose re-check says the session is still fine does not redirect (stale 401), and the error is shown", async () => {
    vi.mocked(usersService.updateRole).mockRejectedValue(unauthenticated());
    const user = await openTeam();
    await user.click(screen.getByRole("button", { name: "Change role for Meera Shah" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("New role"), "viewer");
    // /auth/me keeps answering 200
    await user.click(within(dialog).getByRole("button", { name: "Change role" }));
    await waitFor(() => expect(meMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(router.replace).not.toHaveBeenCalledWith(expect.stringMatching(/^\/login/));
    expect(await within(dialog).findByText("Authentication required")).toBeInTheDocument();
  });

  it.each([
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [500, "INTERNAL_ERROR"],
    [null, "NETWORK_ERROR"],
  ])("a %s on a team mutation does not re-check the session or redirect", async (status, code) => {
    vi.mocked(usersService.updateStatus).mockRejectedValue(apiError(status, "Nope", { code }));
    const user = await openTeam();
    const before = meMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Deactivate Meera Shah" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(vi.mocked(usersService.updateStatus)).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(meMock.mock.calls.length).toBe(before);
    expect(router.replace).not.toHaveBeenCalledWith(expect.stringMatching(/^\/login/));
  });
});

describe("P1-008: auth-form 401s are not session endings (no re-check, no redirect)", () => {
  const SessionBase = ({ children }: { children: React.ReactNode }) => (
    <Providers>
      <SessionProbe />
      {children}
    </Providers>
  );

  beforeEach(() => {
    meMock.mockRejectedValue(unauthenticated()); // signed out already: the probe's own 401 is expected once
  });

  it("register", async () => {
    vi.mocked(authService.register).mockRejectedValue(unauthenticated());
    const user = userEvent.setup();
    render(<SessionBase><RegisterForm /></SessionBase>);
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText("Your name"), "Asha Rao");
    await user.type(screen.getByLabelText("Firm name"), "Demo CA");
    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.type(screen.getByLabelText("Password"), "Sample-pass-1");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Authentication required");
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("forgot password", async () => {
    vi.mocked(authService.forgotPassword).mockRejectedValue(unauthenticated());
    const user = userEvent.setup();
    render(<SessionBase><ForgotPasswordForm /></SessionBase>);
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("reset password", async () => {
    setLocation("/reset-password", "token=tok-1");
    vi.mocked(authService.resetPassword).mockRejectedValue(unauthenticated());
    const user = userEvent.setup();
    render(<SessionBase><ResetPasswordForm /></SessionBase>);
    await waitFor(() => expect(meMock).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText("New password"), "Sample-pass-1");
    await user.type(screen.getByLabelText("Confirm new password"), "Sample-pass-1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("accept invitation", async () => {
    setLocation("/accept-invitation", "token=abc123");
    vi.mocked(authService.getInvitation).mockResolvedValue({
      email: "staff@example.com",
      role: "manager",
      firm_name: "Demo CA Associates",
      expires_at: "2026-11-28T10:00:00.000Z",
    });
    vi.mocked(authService.acceptInvitation).mockRejectedValue(unauthenticated());
    const user = userEvent.setup();
    render(<SessionBase><AcceptInvitationForm /></SessionBase>);
    await user.type(await screen.findByLabelText("Your name"), "Karan Patel");
    await user.type(screen.getByLabelText("Password"), "Sample-pass-1");
    await user.type(screen.getByLabelText("Confirm password"), "Sample-pass-1");
    // the form itself mounts a second current-user observer (an errored query refetches on mount): count from here
    await new Promise((r) => setTimeout(r, 50));
    const before = meMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(vi.mocked(authService.acceptInvitation)).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");
    await new Promise((r) => setTimeout(r, 50));
    expect(meMock.mock.calls.length).toBe(before);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("P1-008: sanity, the invite link survives an unrelated mutation failure", () => {
  it("a successful invite still shows the one-time link (the global handler does not interfere)", async () => {
    vi.mocked(usersService.invite).mockResolvedValue(makeCreatedInvitation());
    const user = await openTeam();
    await user.click(screen.getByRole("button", { name: /Invite user/ }));
    await user.type(await screen.findByLabelText("Email"), "staff@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByLabelText("Invitation link")).toHaveValue(
      "http://localhost:3000/accept-invitation?token=abc123",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
});
