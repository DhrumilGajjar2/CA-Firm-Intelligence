import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, FirmUser, UserRole } from "@ca-firm/shared-types";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { ProfileView } from "@/features/profile/profile-view";
import { authService } from "@/services/auth.service";
import { usersService } from "@/services/users.service";
import { makeFirmUser } from "./team-fixtures";
import {
  apiError,
  deferred,
  makeQueryClient,
  makeUser,
  renderWithProviders,
} from "./utils";

vi.mock("@/services/auth.service");
vi.mock("@/services/users.service");
const meMock = vi.mocked(authService.me);
const updateUser = vi.mocked(usersService.update);

beforeEach(() => {
  meMock.mockResolvedValue(makeUser("manager"));
  updateUser.mockImplementation(async (_id, input) =>
    makeFirmUser({ id: "user-1", name: input.name, role: "manager" }),
  );
});

async function renderProfile(role: UserRole = "manager") {
  meMock.mockResolvedValue(makeUser(role));
  const rendered = renderWithProviders(<ProfileView />);
  await screen.findByLabelText("Name");
  return rendered;
}

const save = () => screen.getByRole("button", { name: "Save changes" });

describe("ProfileView", () => {
  it("shows a skeleton while the current user loads", () => {
    meMock.mockReturnValue(deferred<CurrentUser>().promise);
    renderWithProviders(<ProfileView />);
    expect(screen.getByRole("status", { name: "Loading profile" })).toBeInTheDocument();
  });

  it("shows the name, a read-only email, the role badge and the firm name", async () => {
    await renderProfile("manager");
    expect(screen.getByLabelText("Name")).toHaveValue("Asha Rao");
    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("asha@example.com");
    expect(email).toHaveAttribute("readonly");
    expect(screen.getByRole("group", { name: "Role" })).toHaveTextContent("Manager");
    expect(screen.getByLabelText("Firm")).toHaveValue("Demo CA Associates");
    expect(screen.getByLabelText("Firm")).toHaveAttribute("readonly");
  });

  it.each<UserRole>(["owner", "manager", "employee", "viewer"])(
    "is available to the %s role",
    async (role) => {
      await renderProfile(role);
      expect(screen.getByLabelText("Name")).toBeEnabled();
    },
  );

  it("only enables Save once the name has changed", async () => {
    const { user } = await renderProfile();
    expect(save()).toBeDisabled();

    await user.type(screen.getByLabelText("Name"), "x");
    expect(save()).toBeEnabled();
    await user.keyboard("{Backspace}");
    expect(save()).toBeDisabled();
  });

  it("sends only the changed name to PATCH /users/:id with the user's own id", async () => {
    const { user } = await renderProfile();
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "  Asha R. Rao  ");
    await user.click(save());

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith("user-1", { name: "Asha R. Rao" }),
    );
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it("shows a success message and updates the current-user data", async () => {
    const queryClient = makeQueryClient();
    const { user } = renderWithProviders(<ProfileView />, queryClient);
    await screen.findByLabelText("Name");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Asha Patel");
    await user.click(save());

    expect(await screen.findByText("Profile updated.")).toBeInTheDocument();
    expect(queryClient.getQueryData<CurrentUser>(currentUserQueryKey)?.name).toBe(
      "Asha Patel",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Asha Patel");
    expect(save()).toBeDisabled();
  });

  it("validates with updateUserSchema (name required) and does not call the API", async () => {
    const { user } = await renderProfile();
    await user.clear(screen.getByLabelText("Name"));
    await user.click(save());

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects a name with control characters", async () => {
    const { user } = await renderProfile();
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Asha");
    await user.paste("\u0007");
    await user.click(save());

    expect(
      await screen.findByText("Contains characters that are not allowed"),
    ).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("shows a server field error on the name", async () => {
    updateUser.mockRejectedValue(
      apiError(400, "Validation failed", {
        code: "VALIDATION_ERROR",
        errors: [{ field: "name", message: "Name is not allowed" }],
      }),
    );
    const { user } = await renderProfile();
    await user.type(screen.getByLabelText("Name"), "x");
    await user.click(save());

    expect(await screen.findByText("Name is not allowed")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Profile updated.")).not.toBeInTheDocument();
  });

  it("shows other failures as an alert and lets the user retry", async () => {
    updateUser.mockRejectedValueOnce(apiError(500, "Server exploded"));
    const { user } = await renderProfile();
    await user.type(screen.getByLabelText("Name"), "x");
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");

    await user.click(save());
    expect(await screen.findByText("Profile updated.")).toBeInTheDocument();
    expect(updateUser).toHaveBeenCalledTimes(2);
  });

  it("disables Save while the request is running", async () => {
    const pending = deferred<FirmUser>();
    updateUser.mockReturnValue(pending.promise);
    const { user } = await renderProfile();
    await user.type(screen.getByLabelText("Name"), "x");
    await user.click(save());

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    pending.resolve(makeFirmUser({ id: "user-1", name: "Asha Raox" }));
    expect(await screen.findByText("Profile updated.")).toBeInTheDocument();
  });
});
