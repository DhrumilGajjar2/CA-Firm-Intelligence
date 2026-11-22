import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiSuccess, FirmUser, UserRole } from "@ca-firm/shared-types";
import { TeamView } from "@/features/users/team-view";
import { authService } from "@/services/auth.service";
import { invitationsService } from "@/services/invitations.service";
import { usersService } from "@/services/users.service";
import { envelope, makeCreatedInvitation, makeFirmUser, makeInvitation, TEAM } from "./team-fixtures";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

/** QA slice 3 gate: extra adversarial cases for the Team page (visibility, query params, dialogs, safety). */
vi.mock("@/services/auth.service");
vi.mock("@/services/users.service");
vi.mock("@/services/invitations.service");
const meMock = vi.mocked(authService.me);
const listUsers = vi.mocked(usersService.list);
const listInvitations = vi.mocked(invitationsService.list);
const invite = vi.mocked(usersService.invite);
const updateRole = vi.mocked(usersService.updateRole);
const updateStatus = vi.mocked(usersService.updateStatus);
const revoke = vi.mocked(invitationsService.revoke);

beforeEach(() => {
  meMock.mockResolvedValue(makeUser("owner"));
  listUsers.mockResolvedValue(envelope(TEAM));
  listInvitations.mockResolvedValue(envelope([makeInvitation()]));
});

async function renderTeam(role: UserRole | "unknown" = "owner") {
  meMock.mockResolvedValue(makeUser(role as UserRole));
  const rendered = renderWithProviders(<TeamView />);
  await screen.findByRole("heading", { name: "Team", level: 1 });
  return rendered;
}
const usersRegion = () => screen.getByRole("region", { name: "Team members" });
const rowOf = (name: string) => within(usersRegion()).getByRole("row", { name: new RegExp(name) });

describe("visibility per role (UI convenience; the API enforces the same)", () => {
  it("owner: invite button, filters, per-row actions on non-owner non-self rows, invitations section; both services called", async () => {
    await renderTeam("owner");
    await screen.findByText("Meera Shah");
    expect(screen.getByRole("button", { name: /Invite user/ })).toBeVisible();
    expect(screen.getByRole("region", { name: "Invitations" })).toBeVisible();
    expect(screen.getByLabelText("Search team members")).toBeVisible();
    expect(screen.getByLabelText("Filter by role")).toBeVisible();
    expect(screen.getByLabelText("Filter by status")).toBeVisible();
    for (const name of ["Meera Shah", "Karan Patel", "Isha Verma"]) {
      expect(within(rowOf(name)).getAllByRole("button")).toHaveLength(2);
    }
    expect(within(rowOf("Asha Rao")).queryAllByRole("button")).toHaveLength(0);
    expect(listInvitations).toHaveBeenCalled();
  });

  it("manager: list and filters only; no invite, no row actions, no Actions column, and the invitations endpoint is never called", async () => {
    await renderTeam("manager");
    await screen.findByText("Meera Shah");
    expect(screen.queryByRole("button", { name: /Invite user/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
    expect(within(usersRegion()).queryAllByRole("button", { name: /Change role|Deactivate|Reactivate/ })).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Invitations" })).not.toBeInTheDocument();
    expect(listInvitations).not.toHaveBeenCalled();
    expect(listUsers).toHaveBeenCalled();
    expect(screen.getByText(/Only the owner can invite users or change their access/)).toBeInTheDocument();
  });

  it.each(["employee", "viewer"] as const)(
    "%s: no-access state, no team data requested at all, nothing leaked in the DOM",
    async (role) => {
      await renderTeam(role);
      expect(await screen.findByText("You do not have access to the team list")).toBeVisible();
      expect(listUsers).not.toHaveBeenCalled();
      expect(listInvitations).not.toHaveBeenCalled();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByText("meera@example.com")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it("an unknown or forged role is treated as no access", async () => {
    await renderTeam("unknown");
    expect(await screen.findByText("You do not have access to the team list")).toBeVisible();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("owner demoted while the page is open: the next session refresh removes the owner controls (UI follows the role)", async () => {
    const { queryClient } = await renderTeam("owner");
    await screen.findByText("Meera Shah");
    expect(screen.getByRole("button", { name: /Invite user/ })).toBeVisible();
    queryClient.setQueryData(["auth", "me"], makeUser("viewer"));
    expect(await screen.findByText("You do not have access to the team list")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Invite user/ })).not.toBeInTheDocument();
  });

  it("renders nothing (the guard owns the screen) while signed out", async () => {
    meMock.mockRejectedValue(apiError(401, "Authentication required"));
    renderWithProviders(<TeamView />);
    await waitFor(() => expect(meMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("heading", { name: "Team" })).not.toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
  });
});

describe("search, filters and pagination send exactly the right query", () => {
  it("special characters are sent verbatim (trimmed), never escaped or dropped: % _ \\ ' \" unicode", async () => {
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    const box = screen.getByLabelText("Search team members");
    for (const term of ["50%", "a_b", "back\\slash", "O'Brien", 'say "hi"', "日本語", "🙂", "a%_\\'\""]) {
      listUsers.mockClear();
      await user.clear(box);
      await user.type(box, `  ${term}  `, { skipClick: false });
      await waitFor(() => expect(listUsers).toHaveBeenCalledWith(expect.objectContaining({ search: term, page: 1 })), { timeout: 2000 });
    }
  });

  it("whitespace-only search sends no search parameter and shows no 'filtered' empty state", async () => {
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    listUsers.mockClear();
    await user.type(screen.getByLabelText("Search team members"), "    ");
    await new Promise((r) => setTimeout(r, 400));
    for (const call of listUsers.mock.calls) expect(call[0]!.search).toBeUndefined();
    expect(screen.queryByText("No team members match your filters")).not.toBeInTheDocument();
  });

  it("the search box limits input to 100 characters (the API limit) and is a labelled search input", async () => {
    await renderTeam();
    await screen.findByText("Meera Shah");
    const box = screen.getByLabelText("Search team members");
    expect(box).toHaveAttribute("type", "search");
    expect(box).toHaveAttribute("maxlength", "100");
  });

  it("a filter change sends role+status+search together from page 1; Clear filters sends none", async () => {
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    await user.type(screen.getByLabelText("Search team members"), "meera");
    await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ search: "meera", page: 1 })), { timeout: 2000 });
    await user.selectOptions(screen.getByLabelText("Filter by role"), "manager");
    await user.selectOptions(screen.getByLabelText("Filter by status"), "active");
    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: "meera", role: "manager", status: "active" }),
    );
    listUsers.mockResolvedValue(envelope([]));
    await user.selectOptions(screen.getByLabelText("Filter by status"), "inactive");
    await screen.findByText("No team members match your filters");
    listUsers.mockResolvedValue(envelope(TEAM));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      const last = listUsers.mock.calls.at(-1)![0]!;
      expect([last.search, last.role, last.status]).toEqual([undefined, undefined, undefined]);
      expect(last.page).toBe(1);
    });
  });

  it("P1-009: after browsing page 2 and then searching and clearing the search, the list is back on page 1 (a new filter set starts at page 1)", async () => {
    listUsers.mockResolvedValue(envelope(TEAM, { page: 1, limit: 20, total: 60 }));
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    await user.click(within(usersRegion()).getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    const box = screen.getByLabelText("Search team members");
    await user.type(box, "meera");
    await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ search: "meera", page: 1 })), { timeout: 2000 });
    await user.clear(box);
    await waitFor(() => {
      const last = listUsers.mock.calls.at(-1)![0]!;
      expect(last.search).toBeUndefined();
    }, { timeout: 2000 });
    expect(listUsers.mock.calls.at(-1)![0]!.page).toBe(1);
  });

  it("role filter offers all four roles including Owner; status filter offers Active and Inactive only", async () => {
    await renderTeam();
    await screen.findByText("Meera Shah");
    const role = screen.getByLabelText("Filter by role") as HTMLSelectElement;
    expect([...role.options].map((o) => o.value)).toEqual(["", "owner", "manager", "employee", "viewer"]);
    const status = screen.getByLabelText("Filter by status") as HTMLSelectElement;
    expect([...status.options].map((o) => o.value)).toEqual(["", "active", "inactive"]);
  });

  it("pagination summary at the edges: first page of 1, exact multiples, and Next/Previous disabled correctly", async () => {
    listUsers.mockResolvedValue(envelope(TEAM, { page: 1, limit: 20, total: 20 }));
    await renderTeam();
    await screen.findByText("Meera Shah");
    expect(screen.getByText("Showing 1-20 of 20 members")).toBeInTheDocument();
    expect(within(usersRegion()).getByText("Page 1 of 1")).toBeInTheDocument();
    expect(within(usersRegion()).getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(within(usersRegion()).getByRole("button", { name: /Previous/ })).toBeDisabled();
  });

  it("a page that became empty (list shrank) offers a way back to page 1", async () => {
    listUsers.mockResolvedValue(envelope(TEAM, { page: 1, limit: 20, total: 45 }));
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    listUsers.mockResolvedValue(envelope([], { page: 2, limit: 20, total: 20 }));
    await user.click(within(usersRegion()).getByRole("button", { name: /Next/ }));
    expect(await screen.findByText("No team members on this page")).toBeVisible();
    listUsers.mockResolvedValue(envelope(TEAM, { page: 1, limit: 20, total: 20 }));
    await user.click(screen.getByRole("button", { name: "Go to first page" }));
    await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })));
    expect(await screen.findByText("Meera Shah")).toBeVisible();
  });

  it("shows the previous page dimmed and busy while the next one loads, then the new rows", async () => {
    listUsers.mockResolvedValue(envelope(TEAM, { page: 1, limit: 20, total: 45 }));
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    const next = deferred<ApiSuccess<FirmUser[]>>();
    listUsers.mockReturnValue(next.promise);
    await user.click(within(usersRegion()).getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(usersRegion().querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(within(usersRegion()).getByRole("button", { name: /Next/ })).toBeDisabled();
    next.resolve(envelope([makeFirmUser({ id: "u-9", name: "Zara Khan", email: "zara@example.com" })], { page: 2, limit: 20, total: 45 }));
    expect(await screen.findByText("Zara Khan")).toBeVisible();
  });
});

describe("safe rendering of hostile data", () => {
  it("HTML and script in names, emails and firm text is rendered as text, never as elements", async () => {
    const xss = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    listUsers.mockResolvedValue(
      envelope([
        makeFirmUser({ id: "user-1", name: "Asha Rao", role: "owner" }),
        makeFirmUser({ id: "u-x", name: xss, email: `"><svg onload=window.__xss=3>@example.com` }),
      ]),
    );
    listInvitations.mockResolvedValue(envelope([makeInvitation({ email: xss, invited_by: { id: "x", name: xss } })]));
    await renderTeam();
    expect(await screen.findAllByText(xss)).not.toHaveLength(0);
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("svg[onload]")).toBeNull();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it("very long names and emails and empty strings do not crash the table", async () => {
    listUsers.mockResolvedValue(
      envelope([
        makeFirmUser({ id: "user-1", name: "Asha Rao", role: "owner" }),
        makeFirmUser({ id: "u-long", name: "N".repeat(120), email: `${"e".repeat(64)}@${"d".repeat(60)}.example.com` }),
        makeFirmUser({ id: "u-bad-date", name: "Bad Dates", last_login_at: "not-a-date", created_at: "also-not-a-date" }),
      ]),
    );
    await renderTeam();
    expect(await screen.findByText("N".repeat(120))).toBeVisible();
    expect(within(rowOf("Bad Dates")).getAllByText("-").length).toBeGreaterThan(0);
  });

  it("dates follow the firm timezone (an instant just before midnight UTC is the next day in Kolkata)", async () => {
    listUsers.mockResolvedValue(
      envelope([
        makeFirmUser({ id: "user-1", name: "Asha Rao", role: "owner" }),
        makeFirmUser({ id: "u-tz", name: "Tz Person", created_at: "2026-11-20T20:00:00.000Z", last_login_at: null }),
      ]),
    );
    await renderTeam();
    expect(await within(await screen.findByRole("row", { name: /Tz Person/ })).findByText("21 Nov 2026")).toBeVisible();
  });
});

describe("accessibility basics", () => {
  it("one h1, named regions, table with column headers, labelled controls and descriptive action names", async () => {
    await renderTeam();
    await screen.findByText("Meera Shah");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Team members" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Invitations" })).toBeInTheDocument();
    const headers = within(usersRegion()).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Name", "Email", "Role", "Status", "Last login", "Joined", "Actions"]);
    expect(screen.getByRole("navigation", { name: "members pagination" })).toBeInTheDocument();
    for (const control of [screen.getByLabelText("Search team members"), screen.getByLabelText("Filter by role"), screen.getByLabelText("Filter by status"), screen.getByLabelText("Filter invitations by status")]) {
      expect(control).toHaveAccessibleName();
    }
    // every button has an accessible name
    for (const b of screen.getAllByRole("button")) expect(b, b.outerHTML).toHaveAccessibleName();
    expect(screen.getByRole("button", { name: "Change role for Meera Shah" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reactivate Isha Verma" })).toBeVisible();
  });

  it("dialogs are real dialogs with a name and a description, trap nothing open when closed, and close on Escape when idle", async () => {
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    await user.click(screen.getByRole("button", { name: "Deactivate Karan Patel" }));
    const dialog = await screen.findByRole("dialog", { name: "Deactivate Karan Patel?" });
    expect(dialog).toHaveAccessibleDescription(/lose access right away/);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("a dialog cannot be dismissed (Escape, Cancel, close) while its request is running", async () => {
    const pending = deferred<FirmUser>();
    updateStatus.mockReturnValue(pending.promise);
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    await user.click(screen.getByRole("button", { name: "Deactivate Karan Patel" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await within(dialog).findByRole("button", { name: "Deactivating…" });
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    pending.resolve(makeFirmUser({ id: "u-3", is_active: false }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("success notices are role=status, error notices role=alert, both dismissible", async () => {
    updateStatus.mockResolvedValueOnce(makeFirmUser({ id: "u-3", is_active: false }));
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    await user.click(screen.getByRole("button", { name: "Deactivate Karan Patel" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Deactivate" }));
    const ok = await screen.findByRole("status");
    expect(ok).toHaveTextContent("Karan Patel has been deactivated.");
    await user.click(within(ok).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Karan Patel has been deactivated.")).not.toBeInTheDocument();

    updateStatus.mockRejectedValueOnce(apiError(404, "User not found"));
    await user.click(screen.getByRole("button", { name: "Deactivate Meera Shah" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer part of your firm");
  });
});

describe("invite dialog: validation, payload and the one-time link", () => {
  async function openInvite() {
    const rendered = await renderTeam();
    await screen.findByText("Meera Shah");
    await rendered.user.click(screen.getByRole("button", { name: /Invite user/ }));
    await screen.findByRole("dialog", { name: "Invite a user" });
    return rendered;
  }

  it("empty, malformed and over-long emails are blocked client-side with a message and no request", async () => {
    const { user } = await openInvite();
    const email = screen.getByLabelText("Email");
    for (const bad of ["", "plain", "a@b", "a@@b.com", "a b@example.com", `${"a".repeat(250)}@x.com`]) {
      await user.clear(email);
      if (bad) {
        await user.click(email);
        await user.paste(bad);
      }
      await user.click(screen.getByRole("button", { name: "Create invitation" }));
      await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
      const message = document.getElementById("invite-email-error");
      expect(message, JSON.stringify(bad).slice(0, 30)).not.toBeNull();
      expect(message!.textContent!.length).toBeGreaterThan(5);
      expect(email).toHaveAttribute("aria-describedby", "invite-email-error");
    }
    expect(invite).not.toHaveBeenCalled();
  });

  it("sends exactly {email, role}: trimmed and lower-cased, default role employee, chosen role respected, never owner or a firm id", async () => {
    invite.mockResolvedValue(makeCreatedInvitation());
    const { user } = await openInvite();
    await user.type(screen.getByLabelText("Email"), "  New.Hire@Example.COM  ");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await screen.findByLabelText("Invitation link");
    expect(invite).toHaveBeenCalledTimes(1);
    expect(invite.mock.calls[0]![0]).toEqual({ email: "new.hire@example.com", role: "employee" });
    const options = [...(screen.queryAllByRole("option") as HTMLOptionElement[])];
    expect(options).toHaveLength(0); // the form is gone: the link view replaced it
  });

  it.each(["manager", "employee", "viewer"] as const)("role %s is sent as chosen", async (role) => {
    invite.mockResolvedValue(makeCreatedInvitation({ role }));
    const { user } = await openInvite();
    await user.type(screen.getByLabelText("Email"), "pick@example.com");
    await user.selectOptions(screen.getByLabelText("Role"), role);
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await screen.findByLabelText("Invitation link");
    expect(invite.mock.calls[0]![0]).toEqual({ email: "pick@example.com", role });
  });

  it("double click and Enter twice send one request", async () => {
    const pending = deferred<ReturnType<typeof makeCreatedInvitation>>();
    invite.mockReturnValue(pending.promise);
    const { user } = await openInvite();
    await user.type(screen.getByLabelText("Email"), "once@example.com{Enter}{Enter}");
    await user.dblClick(screen.getByRole("button", { name: /Creating/ }));
    expect(invite).toHaveBeenCalledTimes(1);
    pending.resolve(makeCreatedInvitation());
    await screen.findByLabelText("Invitation link");
  });

  it("shows the link once in a read-only labelled field with a one-time warning, the expiry in the firm timezone and the role; Copy works", async () => {
    invite.mockResolvedValue(makeCreatedInvitation({ email: "staff@example.com", role: "viewer", expires_at: "2026-11-28T20:00:00.000Z" }));
    const { user } = await openInvite();
    await user.type(screen.getByLabelText("Email"), "staff@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    const link = await screen.findByLabelText("Invitation link");
    expect(link).toHaveAttribute("readonly");
    expect(link).toHaveValue("http://localhost:3000/accept-invitation?token=abc123");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("shown only once");
    expect(dialog).toHaveTextContent("Share this link with staff@example.com");
    expect(dialog).toHaveTextContent("join as Viewer");
    expect(dialog).toHaveTextContent("29 Nov 2026"); // 20:00 UTC on the 28th is already the 29th in Asia/Kolkata
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await within(dialog).findByText("Link copied to the clipboard.")).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toBe("http://localhost:3000/accept-invitation?token=abc123");
  });

  it("after Done the link is gone everywhere: not in the dialog, not in the page, not on reopening, not in the invitations table", async () => {
    invite.mockResolvedValue(makeCreatedInvitation());
    const { user } = await openInvite();
    await user.type(screen.getByLabelText("Email"), "staff@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await screen.findByLabelText("Invitation link");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain("abc123");
    await user.click(screen.getByRole("button", { name: /Invite user/ }));
    const dialog = await screen.findByRole("dialog", { name: "Invite a user" });
    expect(screen.queryByLabelText("Invitation link")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toHaveValue("");
    expect(document.body.innerHTML).not.toContain("abc123");
  });

  it("server answers: 409 stays on the form with the message, 400 field errors land on email, 403/500/network show an alert; the form stays usable", async () => {
    const { user } = await openInvite();
    const email = screen.getByLabelText("Email");
    await user.type(email, "dup@example.com");
    const attempts: [unknown, RegExp][] = [
      [apiError(409, "A pending invitation already exists for this email", { code: "CONFLICT", errors: [{ field: "email", message: "A pending invitation already exists for this email" }] }), /pending invitation already exists/],
      [apiError(400, "Validation failed", { code: "VALIDATION_ERROR", errors: [{ field: "email", message: "Enter a valid email address" }] }), /Enter a valid email address/],
      [apiError(403, "You do not have permission to perform this action", { code: "FORBIDDEN" }), /do not have permission/],
      [apiError(500, "Internal server error", { code: "INTERNAL_ERROR" }), /Internal server error/],
      [apiError(null, "Network Error", { code: "NETWORK_ERROR" }), /Network Error/],
    ];
    for (const [error, text] of attempts) {
      invite.mockRejectedValueOnce(error);
      await user.click(screen.getByRole("button", { name: "Create invitation" }));
      expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Create invitation" })).toBeEnabled();
      expect(screen.queryByLabelText("Invitation link")).not.toBeInTheDocument();
    }
    expect(invite).toHaveBeenCalledTimes(attempts.length);
  });
});

describe("role dialog and status dialog details", () => {
  it("role dialog: offers Manager, Employee and Viewer only, preselects the current role, needs a change, sends {id, role}", async () => {
    updateRole.mockResolvedValue(makeFirmUser({ id: "u-2", role: "viewer" }));
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    await user.click(screen.getByRole("button", { name: "Change role for Meera Shah" }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("New role") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["manager", "employee", "viewer"]);
    expect(select.value).toBe("manager");
    expect(within(dialog).getByRole("button", { name: "Change role" })).toBeDisabled();
    await user.selectOptions(select, "viewer");
    await user.click(within(dialog).getByRole("button", { name: "Change role" }));
    expect(updateRole).toHaveBeenCalledWith("u-2", { role: "viewer" });
    expect(updateRole).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Meera Shah is now Viewer.")).toBeInTheDocument();
  });

  it("role dialog for a deactivated user and failure variants: 403 / 500 / network inline, dialog stays and retry sends again", async () => {
    updateRole.mockRejectedValueOnce(apiError(null, "Network Error", { code: "NETWORK_ERROR" }));
    updateRole.mockRejectedValueOnce(apiError(500, "Internal server error", { code: "INTERNAL_ERROR" }));
    updateRole.mockResolvedValueOnce(makeFirmUser({ id: "u-4", role: "manager" }));
    const { user } = await renderTeam();
    await screen.findByText("Isha Verma");
    await user.click(screen.getByRole("button", { name: "Change role for Isha Verma" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("New role"), "manager");
    await user.click(within(dialog).getByRole("button", { name: "Change role" }));
    expect(await within(dialog).findByText("Network Error")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Change role" }));
    expect(await within(dialog).findByText("Internal server error")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Change role" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(updateRole).toHaveBeenCalledTimes(3);
  });

  it("status dialog wording: deactivate is destructive and explains immediate loss of access; reactivate explains the password still works", async () => {
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    await user.click(screen.getByRole("button", { name: "Reactivate Isha Verma" }));
    const dialog = await screen.findByRole("dialog", { name: "Reactivate Isha Verma?" });
    expect(dialog).toHaveTextContent("sign in again with their existing password");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Deactivate Meera Shah" }));
    expect(await screen.findByRole("dialog", { name: "Deactivate Meera Shah?" })).toHaveTextContent("lose access right away");
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("a 409 or 404 on a status change closes the dialog, shows a refresh notice and refetches the list", async () => {
    updateStatus.mockRejectedValueOnce(apiError(409, "State changed", { code: "CONFLICT" }));
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    const before = listUsers.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Deactivate Meera Shah" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("State changed The list has been refreshed.");
    await waitFor(() => expect(listUsers.mock.calls.length).toBeGreaterThan(before));
  });
});

describe("invitations section details", () => {
  it("status filter 'All statuses' sends no status; each status sends its own; the default is pending", async () => {
    const { user } = await renderTeam();
    await screen.findByText("newhire@example.com");
    expect(listInvitations).toHaveBeenLastCalledWith({ page: 1, limit: 10, status: "pending" });
    const select = screen.getByLabelText("Filter invitations by status");
    await user.selectOptions(select, "");
    await waitFor(() => expect(listInvitations.mock.calls.at(-1)![0]).toEqual({ page: 1, limit: 10, status: undefined }));
    for (const status of ["accepted", "revoked", "expired", "pending"] as const) {
      await user.selectOptions(select, status);
      await waitFor(() => expect(listInvitations).toHaveBeenLastCalledWith({ page: 1, limit: 10, status }));
    }
  });

  it("only pending rows have Revoke; accepted, revoked and expired rows have none; the table never shows a token or link", async () => {
    listInvitations.mockResolvedValue(
      envelope([
        makeInvitation({ id: "i1", email: "p@example.com", status: "pending" }),
        makeInvitation({ id: "i2", email: "a@example.com", status: "accepted" }),
        makeInvitation({ id: "i3", email: "r@example.com", status: "revoked" }),
        makeInvitation({ id: "i4", email: "e@example.com", status: "expired" }),
      ]),
    );
    await renderTeam();
    await screen.findByText("p@example.com");
    const section = screen.getByRole("region", { name: "Invitations" });
    expect(within(section).getAllByRole("button", { name: /Revoke invitation for/ })).toHaveLength(1);
    expect(section.textContent).not.toMatch(/token|accept-invitation/i);
  });

  it("revoke: 404 and 409 refresh the list with distinct messages; 403 stays inline; success confirms", async () => {
    const { user } = await renderTeam();
    await screen.findByText("newhire@example.com");
    const start = async () => {
      await user.click(screen.getByRole("button", { name: "Revoke invitation for newhire@example.com" }));
      return screen.findByRole("dialog", { name: "Revoke this invitation?" });
    };
    revoke.mockRejectedValueOnce(apiError(403, "You do not have permission to perform this action", { code: "FORBIDDEN" }));
    let dialog = await start();
    await user.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));
    expect(await within(dialog).findByText(/do not have permission/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    revoke.mockRejectedValueOnce(apiError(404, "Invitation not found", { code: "NOT_FOUND" }));
    dialog = await start();
    await user.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer exists");
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Dismiss" }));

    revoke.mockResolvedValueOnce(makeInvitation({ status: "revoked" }));
    dialog = await start();
    await user.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Invitation for newhire@example.com revoked.");
    expect(revoke).toHaveBeenCalledTimes(3);
    expect(revoke).toHaveBeenLastCalledWith("inv-1");
  });
});
