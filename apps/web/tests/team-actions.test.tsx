import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FirmUser } from "@ca-firm/shared-types";
import { TeamView } from "@/features/users/team-view";
import { authService } from "@/services/auth.service";
import { invitationsService } from "@/services/invitations.service";
import { usersService } from "@/services/users.service";
import { envelope, makeCreatedInvitation, makeInvitation, TEAM } from "./team-fixtures";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
vi.mock("@/services/users.service");
vi.mock("@/services/invitations.service");
const meMock = vi.mocked(authService.me);
const listUsers = vi.mocked(usersService.list);
const invite = vi.mocked(usersService.invite);
const updateRole = vi.mocked(usersService.updateRole);
const updateStatus = vi.mocked(usersService.updateStatus);
const listInvitations = vi.mocked(invitationsService.list);
const revoke = vi.mocked(invitationsService.revoke);

beforeEach(() => {
  meMock.mockResolvedValue(makeUser("owner"));
  listUsers.mockResolvedValue(envelope(TEAM));
  listInvitations.mockResolvedValue(envelope([makeInvitation()]));
});

async function renderOwnerTeam() {
  const rendered = renderWithProviders(<TeamView />);
  await screen.findByText("Meera Shah");
  await screen.findByText("newhire@example.com");
  return rendered;
}

describe("Invite user dialog", () => {
  async function openDialog() {
    const rendered = await renderOwnerTeam();
    await rendered.user.click(screen.getByRole("button", { name: /Invite user/ }));
    await screen.findByRole("dialog", { name: "Invite a user" });
    return rendered;
  }

  it("validates the email with inviteUserSchema before calling the API", async () => {
    const { user } = await openDialog();
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(invite).not.toHaveBeenCalled();
  });

  it("offers manager, employee and viewer (never owner)", async () => {
    await openDialog();
    const options = within(screen.getByLabelText("Role")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Manager", "Employee", "Viewer"]);
  });

  it("creates the invitation and shows the one-time link with a Copy button", async () => {
    invite.mockResolvedValue(makeCreatedInvitation());
    const { user } = await openDialog();

    await user.type(screen.getByLabelText("Email"), "  Staff@Example.com ");
    await user.selectOptions(screen.getByLabelText("Role"), "viewer");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByText("Invitation created")).toBeInTheDocument();
    // The schema trims and lowercases the email.
    expect(invite).toHaveBeenCalledWith({ email: "staff@example.com", role: "viewer" });

    const link = screen.getByLabelText("Invitation link");
    expect(link).toHaveValue("http://localhost:3000/accept-invitation?token=abc123");
    expect(link).toHaveAttribute("readonly");
    expect(screen.getByText(/shown only once/)).toBeInTheDocument();
    expect(screen.getByText(/Email is not sent in this version/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Link copied to the clipboard.")).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toBe(
      "http://localhost:3000/accept-invitation?token=abc123",
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("refreshes the invitations list after success and starts fresh when reopened", async () => {
    invite.mockResolvedValue(makeCreatedInvitation());
    const { user } = await openDialog();
    const before = listInvitations.mock.calls.length;

    await user.type(screen.getByLabelText("Email"), "staff@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await screen.findByText("Invitation created");
    await waitFor(() =>
      expect(listInvitations.mock.calls.length).toBeGreaterThan(before),
    );

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Invite user/ }));
    expect(await screen.findByLabelText("Email")).toHaveValue("");
    expect(screen.queryByLabelText("Invitation link")).not.toBeInTheDocument();
  });

  it("tells the user to copy manually when the clipboard is blocked", async () => {
    invite.mockResolvedValue(makeCreatedInvitation());
    const { user } = await openDialog();
    await user.type(screen.getByLabelText("Email"), "staff@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await screen.findByText("Invitation created");

    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/Could not copy automatically/)).toBeInTheDocument();
  });

  it("shows a 409 (already a member or pending invitation) and keeps the form", async () => {
    invite.mockRejectedValue(
      apiError(409, "A pending invitation already exists for this email", {
        code: "CONFLICT",
      }),
    );
    const { user } = await openDialog();
    await user.type(screen.getByLabelText("Email"), "staff@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A pending invitation already exists for this email",
    );
    expect(screen.getByLabelText("Email")).toHaveValue("staff@example.com");
    expect(screen.queryByText("Invitation created")).not.toBeInTheDocument();
  });

  it("maps a 409 field error onto the email field", async () => {
    invite.mockRejectedValue(
      apiError(409, "Conflict", {
        code: "CONFLICT",
        errors: [{ field: "email", message: "This email is already a member" }],
      }),
    );
    const { user } = await openDialog();
    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByText("This email is already a member")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a 403 without leaving the form", async () => {
    invite.mockRejectedValue(
      apiError(403, "You do not have permission to perform this action", {
        code: "FORBIDDEN",
      }),
    );
    const { user } = await openDialog();
    await user.type(screen.getByLabelText("Email"), "staff@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("do not have permission");
  });

  it("disables submit while the request runs", async () => {
    const pending = deferred<ReturnType<typeof makeCreatedInvitation>>();
    invite.mockReturnValue(pending.promise);
    const { user } = await openDialog();
    await user.type(screen.getByLabelText("Email"), "staff@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
    pending.resolve(makeCreatedInvitation());
    expect(await screen.findByText("Invitation created")).toBeInTheDocument();
  });
});

describe("Role change", () => {
  async function openRoleDialog(name = "Karan Patel") {
    const rendered = await renderOwnerTeam();
    await rendered.user.click(
      screen.getByRole("button", { name: `Change role for ${name}` }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: `Change role for ${name}`,
    });
    return { ...rendered, dialog };
  }

  it("preselects the current role and needs a different one to confirm", async () => {
    await openRoleDialog();
    expect(screen.getByLabelText("New role")).toHaveValue("employee");
    expect(screen.getByRole("button", { name: "Change role" })).toBeDisabled();
  });

  it("changes the role, refetches the list and confirms with a message", async () => {
    updateRole.mockResolvedValue({ ...TEAM[2]!, role: "viewer" } as FirmUser);
    const { user } = await openRoleDialog();
    const callsBefore = listUsers.mock.calls.length;

    await user.selectOptions(screen.getByLabelText("New role"), "viewer");
    await user.click(screen.getByRole("button", { name: "Change role" }));

    await waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith("u-3", { role: "viewer" }),
    );
    expect(await screen.findByText("Karan Patel is now Viewer.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(listUsers.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("shows a 403 inline and keeps the dialog open without refetching", async () => {
    updateRole.mockRejectedValue(
      apiError(403, "You do not have permission to perform this action", {
        code: "FORBIDDEN",
      }),
    );
    const { user } = await openRoleDialog();
    const callsBefore = listUsers.mock.calls.length;

    await user.selectOptions(screen.getByLabelText("New role"), "manager");
    await user.click(screen.getByRole("button", { name: "Change role" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "do not have permission",
    );
    expect(listUsers.mock.calls.length).toBe(callsBefore);
  });

  it("closes with a message and refreshes the list on a 404", async () => {
    updateRole.mockRejectedValue(apiError(404, "Not found", { code: "NOT_FOUND" }));
    const { user } = await openRoleDialog();
    const callsBefore = listUsers.mock.calls.length;

    await user.selectOptions(screen.getByLabelText("New role"), "manager");
    await user.click(screen.getByRole("button", { name: "Change role" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no longer part of your firm",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(listUsers.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("closes with the server message and refreshes the list on a 409", async () => {
    updateRole.mockRejectedValue(apiError(409, "The user changed", { code: "CONFLICT" }));
    const { user } = await openRoleDialog();
    const callsBefore = listUsers.mock.calls.length;

    await user.selectOptions(screen.getByLabelText("New role"), "manager");
    await user.click(screen.getByRole("button", { name: "Change role" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The user changed");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(listUsers.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("cancel closes without calling the API", async () => {
    const { user } = await openRoleDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(updateRole).not.toHaveBeenCalled();
  });
});

describe("Deactivate and reactivate", () => {
  it("asks for confirmation, then deactivates and refetches", async () => {
    updateStatus.mockResolvedValue({ ...TEAM[2]!, is_active: false });
    const { user } = await renderOwnerTeam();
    const callsBefore = listUsers.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Deactivate Karan Patel" }));
    expect(
      await screen.findByRole("dialog", { name: "Deactivate Karan Patel?" }),
    ).toBeInTheDocument();
    expect(updateStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() =>
      expect(updateStatus).toHaveBeenCalledWith("u-3", { is_active: false }),
    );
    expect(
      await screen.findByText("Karan Patel has been deactivated."),
    ).toBeInTheDocument();
    expect(listUsers.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("cancelling the confirm dialog changes nothing", async () => {
    const { user } = await renderOwnerTeam();
    await user.click(screen.getByRole("button", { name: "Deactivate Karan Patel" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("reactivates an inactive user", async () => {
    updateStatus.mockResolvedValue({ ...TEAM[3]!, is_active: true });
    const { user } = await renderOwnerTeam();

    await user.click(screen.getByRole("button", { name: "Reactivate Isha Verma" }));
    await screen.findByRole("dialog", { name: "Reactivate Isha Verma?" });
    await user.click(screen.getByRole("button", { name: "Reactivate" }));

    await waitFor(() =>
      expect(updateStatus).toHaveBeenCalledWith("u-4", { is_active: true }),
    );
    expect(
      await screen.findByText("Isha Verma has been reactivated."),
    ).toBeInTheDocument();
  });

  it("shows a server error inline and keeps the dialog for another try", async () => {
    updateStatus.mockRejectedValueOnce(apiError(500, "Server exploded"));
    updateStatus.mockResolvedValueOnce({ ...TEAM[2]!, is_active: false });
    const { user } = await renderOwnerTeam();

    await user.click(screen.getByRole("button", { name: "Deactivate Karan Patel" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Server exploded");

    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    expect(
      await screen.findByText("Karan Patel has been deactivated."),
    ).toBeInTheDocument();
  });

  it("handles a 403 (target is the owner or yourself) inline", async () => {
    updateStatus.mockRejectedValue(
      apiError(403, "You cannot change this user", { code: "FORBIDDEN" }),
    );
    const { user } = await renderOwnerTeam();
    await user.click(screen.getByRole("button", { name: "Deactivate Karan Patel" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You cannot change this user",
    );
  });

  it("closes with a message and refreshes on a 404", async () => {
    updateStatus.mockRejectedValue(apiError(404, "Not found", { code: "NOT_FOUND" }));
    const { user } = await renderOwnerTeam();
    const callsBefore = listUsers.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Deactivate Karan Patel" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no longer part of your firm",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(listUsers.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("disables the confirm button while the request is running", async () => {
    const pending = deferred<FirmUser>();
    updateStatus.mockReturnValue(pending.promise);
    const { user } = await renderOwnerTeam();
    await user.click(screen.getByRole("button", { name: "Deactivate Karan Patel" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));

    expect(await screen.findByRole("button", { name: "Deactivating…" })).toBeDisabled();
    pending.resolve({ ...TEAM[2]!, is_active: false });
    expect(
      await screen.findByText("Karan Patel has been deactivated."),
    ).toBeInTheDocument();
  });
});

describe("Invitations section", () => {
  const section = () => screen.getByRole("region", { name: "Invitations" });

  it("lists pending invitations with email, role, status, expiry and inviter", async () => {
    await renderOwnerTeam();
    const row = within(section()).getByRole("row", { name: /newhire@example.com/ });
    expect(within(row).getByText("Employee")).toBeInTheDocument();
    expect(within(row).getByText("Pending")).toBeInTheDocument();
    expect(within(row).getByText(/28 Nov 2026/)).toBeInTheDocument();
    expect(within(row).getByText("Asha Rao")).toBeInTheDocument();
    expect(
      within(row).getByRole("button", {
        name: "Revoke invitation for newhire@example.com",
      }),
    ).toBeInTheDocument();
  });

  it("requests the pending invitations, page 1, by default", async () => {
    await renderOwnerTeam();
    expect(listInvitations).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", page: 1, limit: 10 }),
    );
  });

  it("filters by status and only offers Revoke on pending rows", async () => {
    const { user } = await renderOwnerTeam();
    listInvitations.mockResolvedValue(
      envelope([
        makeInvitation({ id: "inv-2", email: "joined@example.com", status: "accepted" }),
        makeInvitation({ id: "inv-3", email: "gone@example.com", status: "revoked" }),
        makeInvitation({ id: "inv-4", email: "late@example.com", status: "expired" }),
      ]),
    );
    await user.selectOptions(screen.getByLabelText("Filter invitations by status"), "");

    await waitFor(() => {
      const last = listInvitations.mock.calls.at(-1)![0]!;
      expect(last.status).toBeUndefined();
    });
    expect(await within(section()).findByText("joined@example.com")).toBeInTheDocument();
    const table = within(within(section()).getByRole("table"));
    expect(table.getByText("Accepted")).toBeInTheDocument();
    expect(table.getByText("Revoked")).toBeInTheDocument();
    expect(table.getByText("Expired")).toBeInTheDocument();
    expect(table.queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("Filter invitations by status"),
      "expired",
    );
    await waitFor(() =>
      expect(listInvitations).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "expired", page: 1 }),
      ),
    );
  });

  it("paginates using the response meta", async () => {
    listInvitations.mockResolvedValue(
      envelope([makeInvitation()], { page: 1, limit: 10, total: 25 }),
    );
    const { user } = await renderOwnerTeam();
    expect(
      within(section()).getByText("Showing 1-10 of 25 invitations"),
    ).toBeInTheDocument();

    await user.click(within(section()).getByRole("button", { name: /Next/ }));
    await waitFor(() =>
      expect(listInvitations).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, status: "pending" }),
      ),
    );
  });

  it("shows an empty state, and an error with retry", async () => {
    listInvitations.mockResolvedValueOnce(envelope([]));
    const { user } = renderWithProviders(<TeamView />);
    expect(await screen.findByText("No pending invitations")).toBeInTheDocument();

    listInvitations.mockRejectedValueOnce(apiError(500, "Invitations exploded"));
    listInvitations.mockResolvedValueOnce(envelope([makeInvitation()]));
    await user.selectOptions(
      screen.getByLabelText("Filter invitations by status"),
      "revoked",
    );
    expect(await within(section()).findByRole("alert")).toHaveTextContent(
      "Invitations exploded",
    );
    await user.click(within(section()).getByRole("button", { name: "Try again" }));
    expect(await within(section()).findByText("newhire@example.com")).toBeInTheDocument();
  });

  it("revokes after confirmation and refetches", async () => {
    revoke.mockResolvedValue(makeInvitation({ status: "revoked" }));
    const { user } = await renderOwnerTeam();
    const callsBefore = listInvitations.mock.calls.length;

    await user.click(
      screen.getByRole("button", { name: "Revoke invitation for newhire@example.com" }),
    );
    await screen.findByRole("dialog", { name: "Revoke this invitation?" });
    expect(revoke).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Revoke invitation" }));

    await waitFor(() => expect(revoke).toHaveBeenCalledWith("inv-1"));
    expect(
      await screen.findByText("Invitation for newhire@example.com revoked."),
    ).toBeInTheDocument();
    expect(listInvitations.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("cancel keeps the invitation untouched", async () => {
    const { user } = await renderOwnerTeam();
    await user.click(
      screen.getByRole("button", { name: "Revoke invitation for newhire@example.com" }),
    );
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(revoke).not.toHaveBeenCalled();
  });

  it("refetches with a clear message when the invitation is no longer pending (409)", async () => {
    revoke.mockRejectedValue(
      apiError(409, "Invitation is not pending", { code: "CONFLICT" }),
    );
    const { user } = await renderOwnerTeam();
    const callsBefore = listInvitations.mock.calls.length;

    await user.click(
      screen.getByRole("button", { name: "Revoke invitation for newhire@example.com" }),
    );
    await user.click(await screen.findByRole("button", { name: "Revoke invitation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer pending");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(listInvitations.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it("shows other failures (403/500) inline in the dialog", async () => {
    revoke.mockRejectedValue(apiError(500, "Server exploded"));
    const { user } = await renderOwnerTeam();
    await user.click(
      screen.getByRole("button", { name: "Revoke invitation for newhire@example.com" }),
    );
    await user.click(await screen.findByRole("button", { name: "Revoke invitation" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Server exploded");
  });
});
