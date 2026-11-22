import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FirmProfile, UserRole } from "@ca-firm/shared-types";
import { SettingsView } from "@/features/firm/settings-view";
import { authService } from "@/services/auth.service";
import { firmService } from "@/services/firm.service";
import { makeProfile, makeSettings } from "./firm-fixtures";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
vi.mock("@/services/firm.service");
const meMock = vi.mocked(authService.me);
const getFirm = vi.mocked(firmService.getFirm);
const getSettings = vi.mocked(firmService.getSettings);
const updateFirm = vi.mocked(firmService.updateFirm);
const updateSettings = vi.mocked(firmService.updateSettings);

const savedProfile = makeProfile({
  address: "12 MG Road, Pune",
  email: "office@demo-ca.example",
  phone: "+91 98765 43210",
});

beforeEach(() => {
  meMock.mockResolvedValue(makeUser("owner"));
  getFirm.mockResolvedValue(savedProfile);
  getSettings.mockResolvedValue(makeSettings({ onboarding_completed: true }));
  updateFirm.mockImplementation(async (patch) => {
    const next: Record<string, unknown> = { ...savedProfile, ...patch };
    for (const key of ["address", "email", "phone"]) {
      if (next[key] === "") next[key] = null;
    }
    return next as unknown as FirmProfile;
  });
  updateSettings.mockImplementation(async (patch) => ({
    ...makeSettings({ onboarding_completed: true }),
    ...patch,
  }));
});

async function renderReady(role: UserRole = "owner") {
  meMock.mockResolvedValue(makeUser(role));
  const rendered = renderWithProviders(<SettingsView />);
  await screen.findByLabelText("Firm name");
  // Role arrives from /auth/me in parallel; wait for it to settle the form state.
  if (role === "owner") {
    await waitFor(() => expect(screen.getByLabelText("Firm name")).toBeEnabled());
  } else {
    await waitFor(() => expect(screen.getByLabelText("Firm name")).toBeDisabled());
  }
  return rendered;
}

const saveButton = () => screen.getByRole("button", { name: "Save changes" });

describe("SettingsView: loading and errors", () => {
  it("shows a skeleton while loading", () => {
    getFirm.mockReturnValue(deferred<FirmProfile>().promise);
    renderWithProviders(<SettingsView />);
    expect(
      screen.getByRole("status", { name: "Loading firm settings" }),
    ).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    getSettings.mockRejectedValueOnce(apiError(500, "Server exploded"));
    const { user } = renderWithProviders(<SettingsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Firm name")).toBeInTheDocument();
    expect(getSettings).toHaveBeenCalledTimes(2);
  });

  it("handles a 403 on load with a clear message", async () => {
    getFirm.mockRejectedValue(apiError(403, "Forbidden", { code: "FORBIDDEN" }));
    renderWithProviders(<SettingsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You do not have permission to view the firm details.",
    );
  });
});

describe("SettingsView: owner", () => {
  it("prefills every field from the API", async () => {
    await renderReady();
    expect(screen.getByLabelText("Firm name")).toHaveValue("Demo CA Associates");
    expect(screen.getByLabelText("Address")).toHaveValue("12 MG Road, Pune");
    expect(screen.getByLabelText("Contact email")).toHaveValue("office@demo-ca.example");
    expect(screen.getByLabelText("Phone")).toHaveValue("+91 98765 43210");
    expect(screen.getByLabelText("Timezone")).toHaveValue("Asia/Kolkata");
    expect(screen.getByLabelText("Financial year starts in")).toHaveValue("4");
    expect(
      screen.queryByText(/Only the owner can change firm settings/),
    ).not.toBeInTheDocument();
  });

  it("keeps Save disabled until something changes", async () => {
    const { user } = await renderReady();
    expect(saveButton()).toBeDisabled();
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    expect(saveButton()).toBeEnabled();
  });

  it("sends only the changed profile fields and confirms the save", async () => {
    const { user } = await renderReady();
    await user.clear(screen.getByLabelText("Phone"));
    await user.type(screen.getByLabelText("Phone"), "080 4000 1234");
    await user.click(saveButton());

    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
    expect(updateFirm).toHaveBeenCalledTimes(1);
    expect(updateFirm).toHaveBeenCalledWith({ phone: "080 4000 1234" });
    expect(updateSettings).not.toHaveBeenCalled();
    expect(saveButton()).toBeDisabled();
  });

  it("sends only the financial-year setting when only that changed", async () => {
    const { user } = await renderReady();
    await user.selectOptions(screen.getByLabelText("Financial year starts in"), "7");
    await user.click(saveButton());

    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
    expect(updateFirm).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith({ financial_year_start_month: 7 });
  });

  it("saves both parts when both changed, and clears an optional field with an empty string", async () => {
    const { user } = await renderReady();
    await user.clear(screen.getByLabelText("Address"));
    await user.selectOptions(screen.getByLabelText("Timezone"), "UTC");
    await user.selectOptions(screen.getByLabelText("Financial year starts in"), "1");
    await user.click(saveButton());

    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
    expect(updateFirm).toHaveBeenCalledWith({ address: "", timezone: "UTC" });
    expect(updateSettings).toHaveBeenCalledWith({ financial_year_start_month: 1 });
    expect(screen.getByLabelText("Address")).toHaveValue("");
  });

  it("validates with the shared rules and does not call the API", async () => {
    const { user } = await renderReady();
    await user.clear(screen.getByLabelText("Firm name"));
    await user.clear(screen.getByLabelText("Contact email"));
    await user.type(screen.getByLabelText("Contact email"), "nope");
    await user.clear(screen.getByLabelText("Phone"));
    await user.type(screen.getByLabelText("Phone"), "abc");
    await user.click(saveButton());

    expect(await screen.findByText("Firm name is required")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid phone number")).toBeInTheDocument();
    expect(updateFirm).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("maps a server field error onto its field", async () => {
    updateFirm.mockRejectedValueOnce(
      apiError(400, "Validation failed", {
        code: "VALIDATION_ERROR",
        errors: [{ field: "name", message: "Firm name is already in use" }],
      }),
    );
    const { user } = await renderReady();
    await user.type(screen.getByLabelText("Firm name"), "X");
    await user.click(saveButton());

    const message = await screen.findByText("Firm name is already in use");
    expect(screen.getByLabelText("Firm name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Firm name")).toHaveAttribute(
      "aria-describedby",
      message.id,
    );
    expect(screen.queryByText("Firm settings saved.")).not.toBeInTheDocument();
  });

  it("shows a generic server error in an alert and keeps the edits", async () => {
    updateFirm.mockRejectedValueOnce(apiError(500, "Something went wrong."));
    const { user } = await renderReady();
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.getByLabelText("Firm name")).toHaveValue("Demo CA Associates LLP");
  });

  it("after a partial failure, a retry only re-sends the unsaved part", async () => {
    updateSettings.mockRejectedValueOnce(apiError(500, "Something went wrong."));
    const { user } = await renderReady();
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.selectOptions(screen.getByLabelText("Financial year starts in"), "7");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(updateFirm).toHaveBeenCalledTimes(1);

    await user.click(saveButton());
    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
    expect(updateFirm).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledTimes(2);
  });

  it("handles a 403 from the API gracefully", async () => {
    updateFirm.mockRejectedValueOnce(
      apiError(403, "You do not have permission to perform this action", {
        code: "FORBIDDEN",
      }),
    );
    const { user } = await renderReady();
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the owner can change firm settings.",
    );
  });

  it("disables the button while saving", async () => {
    const pending = deferred<FirmProfile>();
    updateFirm.mockReturnValue(pending.promise);
    const { user } = await renderReady();
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.click(saveButton());

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    pending.resolve({ ...savedProfile, name: "Demo CA Associates LLP" });
    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
  });
});

describe("SettingsView: other roles", () => {
  it.each(["manager", "employee", "viewer"] as const)(
    "is read-only for a %s",
    async (role) => {
      await renderReady(role);
      expect(
        screen.getByText(/Only the owner can change firm settings/),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Firm name")).toHaveValue("Demo CA Associates");
      for (const label of [
        "Firm name",
        "Address",
        "Contact email",
        "Phone",
        "Timezone",
        "Financial year starts in",
      ]) {
        expect(screen.getByLabelText(label)).toBeDisabled();
      }
      expect(
        screen.queryByRole("button", { name: "Save changes" }),
      ).not.toBeInTheDocument();
      expect(updateFirm).not.toHaveBeenCalled();
    },
  );
});
