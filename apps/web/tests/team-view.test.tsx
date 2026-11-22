import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiSuccess, FirmUser, UserRole } from "@ca-firm/shared-types";
import { TeamView } from "@/features/users/team-view";
import { authService } from "@/services/auth.service";
import { invitationsService } from "@/services/invitations.service";
import { usersService } from "@/services/users.service";
import { envelope, makeFirmUser, makeInvitation, TEAM } from "./team-fixtures";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
vi.mock("@/services/users.service");
vi.mock("@/services/invitations.service");
const meMock = vi.mocked(authService.me);
const listUsers = vi.mocked(usersService.list);
const listInvitations = vi.mocked(invitationsService.list);

beforeEach(() => {
  meMock.mockResolvedValue(makeUser("owner"));
  listUsers.mockResolvedValue(envelope(TEAM));
  listInvitations.mockResolvedValue(envelope([makeInvitation()]));
});

async function renderTeam(role: UserRole = "owner") {
  meMock.mockResolvedValue(makeUser(role));
  const rendered = renderWithProviders(<TeamView />);
  await screen.findByRole("heading", { name: "Team", level: 1 });
  return rendered;
}

const usersRegion = () => screen.getByRole("region", { name: "Team members" });
const rowOf = (name: string) =>
  within(usersRegion()).getByRole("row", { name: new RegExp(name) });

describe("TeamView: list states", () => {
  it("shows a loading skeleton while the team loads", async () => {
    listUsers.mockReturnValue(deferred<ApiSuccess<FirmUser[]>>().promise);
    await renderTeam();
    expect(
      await screen.findByRole("status", { name: "Loading team members" }),
    ).toBeInTheDocument();
  });

  it("renders name, email, role badge, status badge, last login and joined date", async () => {
    await renderTeam();
    await screen.findByText("Meera Shah");

    const meera = rowOf("Meera Shah");
    expect(within(meera).getByText("meera@example.com")).toBeInTheDocument();
    expect(within(meera).getByText("Manager")).toBeInTheDocument();
    expect(within(meera).getByText("Active")).toBeInTheDocument();
    expect(within(meera).getByText(/20 Nov 2026/)).toBeInTheDocument();
    expect(within(meera).getByText(/1 Oct 2026/)).toBeInTheDocument();

    expect(within(rowOf("Karan Patel")).getByText("Never")).toBeInTheDocument();
    expect(within(rowOf("Isha Verma")).getByText("Inactive")).toBeInTheDocument();
    expect(within(rowOf("Asha Rao")).getByText("Owner")).toBeInTheDocument();
    expect(within(rowOf("Asha Rao")).getByText("You")).toBeInTheDocument();
  });

  it("shows an empty state when there are no members", async () => {
    listUsers.mockResolvedValue(envelope([]));
    await renderTeam();
    expect(await screen.findByText("No team members yet")).toBeInTheDocument();
  });

  it("shows a filtered empty state with a Clear filters button", async () => {
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    listUsers.mockResolvedValue(envelope([]));
    await user.type(screen.getByLabelText("Search team members"), "zzz");

    expect(await screen.findByText("No team members match your filters")).toBeVisible();
    listUsers.mockResolvedValue(envelope(TEAM));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Search team members")).toHaveValue("");
    expect(await screen.findByText("Meera Shah")).toBeInTheDocument();
  });

  it("shows the error with a retry that reloads the list", async () => {
    listUsers.mockRejectedValueOnce(apiError(500, "Server exploded"));
    const { user } = await renderTeam();

    expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Meera Shah")).toBeInTheDocument();
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it("explains a 403 on the list instead of showing a broken page", async () => {
    listUsers.mockRejectedValue(apiError(403, "Forbidden", { code: "FORBIDDEN" }));
    await renderTeam("manager");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You do not have permission to view this.",
    );
  });
});

describe("TeamView: search, filters and pagination query the service", () => {
  it("requests page 1 with the page size and no filters first", async () => {
    await renderTeam();
    await screen.findByText("Meera Shah");
    expect(listUsers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    const first = listUsers.mock.calls[0]![0]!;
    expect(first.search).toBeUndefined();
    expect(first.role).toBeUndefined();
    expect(first.status).toBeUndefined();
  });

  it("debounces the search and sends the trimmed term", async () => {
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    listUsers.mockClear();

    await user.type(screen.getByLabelText("Search team members"), "  mee ");
    // Still inside the debounce window: no request per keystroke.
    expect(listUsers).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ search: "mee", page: 1 }),
      ),
    );
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it("sends the role and status filters", async () => {
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");

    await user.selectOptions(screen.getByLabelText("Filter by role"), "manager");
    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: "manager", page: 1 }),
      ),
    );

    await user.selectOptions(screen.getByLabelText("Filter by status"), "inactive");
    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: "manager", status: "inactive", page: 1 }),
      ),
    );

    await user.selectOptions(screen.getByLabelText("Filter by role"), "");
    await waitFor(() => {
      const last = listUsers.mock.calls.at(-1)![0]!;
      expect(last.role).toBeUndefined();
      expect(last.status).toBe("inactive");
    });
  });

  it("paginates with page, limit and total from the response meta", async () => {
    listUsers.mockResolvedValue(envelope(TEAM, { page: 1, limit: 20, total: 45 }));
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");

    expect(screen.getByText("Showing 1-20 of 45 members")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(
      within(usersRegion()).getByRole("button", { name: /Previous/ }),
    ).toBeDisabled();

    listUsers.mockResolvedValue(envelope(TEAM, { page: 2, limit: 20, total: 45 }));
    await user.click(within(usersRegion()).getByRole("button", { name: /Next/ }));
    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
    expect(await screen.findByText("Showing 21-40 of 45 members")).toBeInTheDocument();
    expect(within(usersRegion()).getByRole("button", { name: /Previous/ })).toBeEnabled();

    listUsers.mockResolvedValue(envelope(TEAM, { page: 3, limit: 20, total: 45 }));
    await user.click(within(usersRegion()).getByRole("button", { name: /Next/ }));
    expect(await screen.findByText("Showing 41-45 of 45 members")).toBeInTheDocument();
    expect(within(usersRegion()).getByRole("button", { name: /Next/ })).toBeDisabled();
  });

  it("goes back to page 1 when a filter changes", async () => {
    listUsers.mockResolvedValue(envelope(TEAM, { page: 1, limit: 20, total: 45 }));
    const { user } = await renderTeam();
    await screen.findByText("Meera Shah");
    listUsers.mockResolvedValue(envelope(TEAM, { page: 2, limit: 20, total: 45 }));
    await user.click(within(usersRegion()).getByRole("button", { name: /Next/ }));
    await screen.findByText("Showing 21-40 of 45 members");

    await user.selectOptions(screen.getByLabelText("Filter by role"), "employee");
    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: "employee", page: 1 }),
      ),
    );
  });
});

describe("TeamView: role-based visibility", () => {
  it("owner sees Invite user, row actions and the invitations section", async () => {
    await renderTeam("owner");
    await screen.findByText("Meera Shah");

    expect(screen.getByRole("button", { name: /Invite user/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change role for Meera Shah" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Deactivate Meera Shah" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reactivate Isha Verma" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Invitations" })).toBeInTheDocument();
    expect(listInvitations).toHaveBeenCalled();
  });

  it("owner's own row has no actions", async () => {
    await renderTeam("owner");
    await screen.findByText("Meera Shah");
    expect(within(rowOf("Asha Rao")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("no owner row gets actions, even another one", async () => {
    listUsers.mockResolvedValue(
      envelope([
        ...TEAM,
        makeFirmUser({ id: "u-9", name: "Second Owner", role: "owner" }),
      ]),
    );
    await renderTeam("owner");
    await screen.findByText("Second Owner");
    expect(within(rowOf("Second Owner")).queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change role for Karan Patel" }),
    ).toBeInTheDocument();
  });

  it("manager sees the list read-only: no invite, no actions, no invitations", async () => {
    await renderTeam("manager");
    await screen.findByText("Meera Shah");

    expect(screen.queryByRole("button", { name: /Invite user/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Change role/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deactivate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reactivate/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Actions" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Invitations" })).not.toBeInTheDocument();
    expect(listInvitations).not.toHaveBeenCalled();
  });

  it.each<UserRole>(["employee", "viewer"])(
    "%s sees a no-access state and never requests the team",
    async (role) => {
      await renderTeam(role);
      expect(
        await screen.findByText("You do not have access to the team list"),
      ).toBeInTheDocument();
      expect(screen.queryByText("Meera Shah")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Invite user/ }),
      ).not.toBeInTheDocument();
      expect(listUsers).not.toHaveBeenCalled();
      expect(listInvitations).not.toHaveBeenCalled();
    },
  );
});
