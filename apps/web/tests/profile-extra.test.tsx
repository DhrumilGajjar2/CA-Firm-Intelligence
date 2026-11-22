import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FirmUser, UserRole } from "@ca-firm/shared-types";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { ProfileView } from "@/features/profile/profile-view";
import { authService } from "@/services/auth.service";
import { usersService } from "@/services/users.service";
import { makeFirmUser } from "./team-fixtures";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

/** QA slice 3 gate: extra adversarial cases for /profile. */
vi.mock("@/services/auth.service");
vi.mock("@/services/users.service");
const meMock = vi.mocked(authService.me);
const updateUser = vi.mocked(usersService.update);

beforeEach(() => {
  meMock.mockResolvedValue(makeUser("employee"));
  updateUser.mockImplementation(async (_id, input) => makeFirmUser({ id: "user-1", name: input.name, role: "employee" }));
});

async function renderProfile(role: UserRole = "employee", overrides = {}) {
  meMock.mockResolvedValue(makeUser(role, overrides));
  const rendered = renderWithProviders(<ProfileView />);
  await screen.findByLabelText("Name");
  return rendered;
}
const save = () => screen.getByRole("button", { name: "Save changes" });
const nameBox = () => screen.getByLabelText("Name");
async function setName(user: Awaited<ReturnType<typeof renderProfile>>["user"], value: string) {
  await user.clear(nameBox());
  if (value) {
    await user.click(nameBox());
    await user.paste(value);
  }
}

describe("payload and identity", () => {
  it.each<UserRole>(["owner", "manager", "employee", "viewer"])("%s: PATCH goes to the session user's own id with {name} only", async (role) => {
    const { user } = await renderProfile(role, { id: `self-${role}` });
    await setName(user, "New Name");
    await user.click(save());
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser).toHaveBeenCalledWith(`self-${role}`, { name: "New Name" });
    expect(Object.keys(updateUser.mock.calls[0]![1])).toEqual(["name"]);
  });

  it("the name is trimmed before sending; an edit that only changes surrounding spaces is not a change (Save disabled, Enter sends nothing)", async () => {
    const { user } = await renderProfile("employee");
    await setName(user, "   Asha Rao   ");
    expect(save()).toBeDisabled();
    await user.type(nameBox(), "{Enter}");
    expect(updateUser).not.toHaveBeenCalled();
    await setName(user, "  Asha R  ");
    await user.click(save());
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser.mock.calls[0]![1]).toEqual({ name: "Asha R" });
  });

  it("email, role and firm cannot be edited: read-only inputs, typing changes nothing, no field for them is ever sent", async () => {
    const { user } = await renderProfile("viewer");
    for (const label of ["Email", "Firm"]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input).toHaveAttribute("readonly");
      const before = input.value;
      await user.type(input, "changed");
      expect(input.value).toBe(before);
    }
    expect(screen.getByRole("group", { name: "Role" })).toHaveTextContent("Viewer");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await setName(user, "Another Name");
    await user.click(save());
    await waitFor(() => expect(updateUser).toHaveBeenCalled());
    expect(updateUser.mock.calls[0]![1]).toEqual({ name: "Another Name" });
  });
});

describe("validation boundaries", () => {
  it.each([
    ["empty", ""],
    ["spaces only", "     "],
    ["NBSP only", "   "],
    ["121 characters", "n".repeat(121)],
    ["NUL inside", "Bad\u0000Name"],
    ["tab inside", "Bad\tName"],
    ["DEL inside", "Bad\u007fName"],
    ["C1 control inside", "Bad\u0085Name"],
  ])("name %s is rejected client-side with no request", async (_l, value) => {
    const { user } = await renderProfile();
    await setName(user, value);
    await user.click(save());
    await waitFor(() => expect(nameBox()).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("profile-name-error")?.textContent?.length ?? 0).toBeGreaterThan(3);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it.each([
    ["1 character", "A"],
    ["120 characters", "n".repeat(120)],
    ["unicode", "Zoë Müller 日本語"],
    ["markup-looking", "<b>Asha</b> & 'Co' \"x\""],
    ["SQL-looking", "Robert'); DROP TABLE users;--"],
  ])("name %s is accepted and sent verbatim", async (_l, value) => {
    const { user } = await renderProfile();
    await setName(user, value);
    await user.click(save());
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser.mock.calls[0]![1]).toEqual({ name: value });
  });
});

describe("outcomes", () => {
  it("success: confirmation shown, Save disabled again, the session cache and the form follow the SERVER's returned name", async () => {
    updateUser.mockResolvedValue(makeFirmUser({ id: "user-1", name: "Server Normalised" }));
    const { user, queryClient } = await renderProfile();
    await setName(user, "my  name");
    await user.click(save());
    expect(await screen.findByRole("status")).toHaveTextContent("Profile updated.");
    expect(queryClient.getQueryData<{ name: string }>(currentUserQueryKey)!.name).toBe("Server Normalised");
    expect(nameBox()).toHaveValue("Server Normalised");
    expect(save()).toBeDisabled();
  });

  it("the confirmation disappears as soon as the user edits again; a second save works", async () => {
    const { user } = await renderProfile();
    await setName(user, "First Change");
    await user.click(save());
    await screen.findByRole("status");
    await user.type(nameBox(), "x");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
    await user.click(save());
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(2));
    expect(updateUser.mock.calls[1]![1]).toEqual({ name: "First Changex" });
  });

  it("double click and Enter twice send one request while it is running, and the button shows progress", async () => {
    const pending = deferred<FirmUser>();
    updateUser.mockReturnValue(pending.promise);
    const { user } = await renderProfile();
    await setName(user, "Slow Save");
    await user.type(nameBox(), "{Enter}{Enter}");
    const button = await screen.findByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
    await user.dblClick(button);
    expect(updateUser).toHaveBeenCalledTimes(1);
    pending.resolve(makeFirmUser({ id: "user-1", name: "Slow Save" }));
    await screen.findByRole("status");
  });

  it.each([
    [400, "VALIDATION_ERROR", "Name is required", true],
    [403, "FORBIDDEN", "You do not have permission to perform this action", false],
    [404, "NOT_FOUND", "User not found", false],
    [409, "CONFLICT", "Conflict", false],
    [500, "INTERNAL_ERROR", "Internal server error", false],
    [null, "NETWORK_ERROR", "Network Error", false],
  ])("a %s answer is shown (%s), the typed name is kept and a retry sends the same name again", async (status, code, message, fieldError) => {
    updateUser.mockRejectedValueOnce(
      apiError(status, message, { code, errors: fieldError ? [{ field: "name", message }] : undefined }),
    );
    const { user } = await renderProfile();
    await setName(user, "Keep Me");
    await user.click(save());
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    expect(nameBox()).toHaveValue("Keep Me");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
    await user.click(save());
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(2));
    expect(updateUser.mock.calls[1]![1]).toEqual({ name: "Keep Me" });
  });

  it("a long name with markup stays text on the page (no injected elements)", async () => {
    const hostile = '<img src=x onerror="window.__p=1">';
    meMock.mockResolvedValue(makeUser("employee", { name: hostile, firm: { id: "f", name: hostile, timezone: "UTC", onboarding_completed: true } }));
    renderWithProviders(<ProfileView />);
    await screen.findByLabelText("Name");
    expect(screen.getByLabelText("Name")).toHaveValue(hostile);
    expect(screen.getByLabelText("Firm")).toHaveValue(hostile);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("accessibility basics", () => {
  it("named form, labelled inputs, role group named, error linked to the field and announced", async () => {
    const { user } = await renderProfile();
    expect(screen.getByRole("form", { name: "Profile" })).toBeInTheDocument();
    for (const label of ["Name", "Email", "Firm"]) expect(screen.getByLabelText(label)).toHaveAccessibleName(label);
    expect(screen.getByRole("group", { name: "Role" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    await setName(user, "");
    await user.click(save());
    await waitFor(() => expect(nameBox()).toHaveAccessibleDescription(/required/i));
    updateUser.mockRejectedValueOnce(apiError(500, "Internal server error", { code: "INTERNAL_ERROR" }));
    await setName(user, "Valid Name");
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Internal server error");
  });
});
