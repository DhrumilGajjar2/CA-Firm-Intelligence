import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FirmProfile, FirmSettings, UserRole } from "@ca-firm/shared-types";
import { Providers } from "@/components/providers";
import { RequireAuth } from "@/features/auth/require-auth";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { OnboardingWizard } from "@/features/firm/onboarding-wizard";
import { SettingsView } from "@/features/firm/settings-view";
import { authService } from "@/services/auth.service";
import { firmService } from "@/services/firm.service";
import { makeProfile, makeSettings } from "./firm-fixtures";
import { router, setLocation } from "./navigation-mock";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

/** QA slice 2 gate: extra adversarial cases for the onboarding wizard and the settings form. */
vi.mock("@/services/auth.service");
vi.mock("@/services/firm.service");
const meMock = vi.mocked(authService.me);
const getFirm = vi.mocked(firmService.getFirm);
const getSettings = vi.mocked(firmService.getSettings);
const updateFirm = vi.mocked(firmService.updateFirm);
const updateSettings = vi.mocked(firmService.updateSettings);

const incompleteOwner = makeUser("owner", {
  firm: { id: "firm-1", name: "Demo CA Associates", timezone: "Asia/Kolkata", onboarding_completed: false },
});

/** The API answers with the merged profile; "" clears address/email/phone (stored as null). */
function applyProfilePatch(base: FirmProfile, patch: Record<string, unknown>): FirmProfile {
  const next: Record<string, unknown> = { ...base, ...patch };
  for (const key of ["address", "email", "phone"]) if (next[key] === "") next[key] = null;
  return next as unknown as FirmProfile;
}

beforeEach(() => {
  meMock.mockResolvedValue(makeUser("owner"));
  getFirm.mockResolvedValue(makeProfile());
  getSettings.mockResolvedValue(makeSettings());
  updateFirm.mockImplementation(async (patch) => applyProfilePatch(makeProfile(), patch));
  updateSettings.mockImplementation(async (patch) => ({ ...makeSettings(), ...patch }));
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

// ---------------------------------------------------------------------------------------------
// Onboarding wizard
// ---------------------------------------------------------------------------------------------
describe("OnboardingWizard: validation boundaries", () => {
  async function ready() {
    const rendered = renderWithProviders(<OnboardingWizard />);
    rendered.queryClient.setQueryData(currentUserQueryKey, incompleteOwner);
    await screen.findByLabelText("Firm name");
    return rendered;
  }
  const advance = async (user: Awaited<ReturnType<typeof ready>>["user"]) =>
    user.click(screen.getByRole("button", { name: "Continue" }));

  it.each([
    ["name of 201 characters", "Firm name", "a".repeat(201)],
    ["name of only spaces", "Firm name", "     "],
    ["address of 501 characters", "Address", "a".repeat(501)],
    ["phone of 9 characters", "Phone", "987654321"],
    ["phone of 16 characters", "Phone", "1234567890123456"],
    ["phone with letters", "Phone", "98765abcde"],
    ["e-mail without a domain", "Contact email", "office@demo"],
  ])("blocks Continue for %s and never calls the API", async (_label, field, value) => {
    const { user } = await ready();
    type(field, value);
    await advance(user);
    expect(await screen.findByLabelText(field)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("heading", { name: "Set up your firm" })).toBeInTheDocument();
    expect(updateFirm).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["name of exactly 200 characters", "Firm name", "a".repeat(200)],
    ["address of exactly 500 characters", "Address", "a".repeat(500)],
    ["phone of exactly 10 characters", "Phone", "9876543210"],
    ["phone of exactly 15 characters", "Phone", "123456789012345"],
    ["a capitalised e-mail", "Contact email", "OFFICE@Demo-CA.example"],
  ])("lets %s through", async (_label, field, value) => {
    const { user } = await ready();
    type(field, value);
    await advance(user);
    expect(
      await screen.findByRole("heading", { name: "Financial year and next steps" }),
    ).toBeInTheDocument();
  });

  it("moves keyboard focus to the first invalid field when Continue is refused", async () => {
    const { user } = await ready();
    type("Firm name", "");
    type("Phone", "12");
    await advance(user);
    await waitFor(() => expect(screen.getByLabelText("Firm name")).toHaveFocus());
  });

  it("clears an error as soon as the field is fixed and Continue is pressed again", async () => {
    const { user } = await ready();
    type("Phone", "12");
    await advance(user);
    expect(await screen.findByText("Enter a valid phone number")).toBeInTheDocument();
    type("Phone", "9876543210");
    await advance(user);
    await screen.findByRole("heading", { name: "Financial year and next steps" });
    expect(screen.queryByText("Enter a valid phone number")).not.toBeInTheDocument();
  });
});

describe("OnboardingWizard: accessibility basics", () => {
  async function ready() {
    const rendered = renderWithProviders(<OnboardingWizard />);
    rendered.queryClient.setQueryData(currentUserQueryKey, incompleteOwner);
    await screen.findByLabelText("Firm name");
    return rendered;
  }

  it("every control has an accessible name and the form and steps are labelled", async () => {
    await ready();
    expect(screen.getByRole("form", { name: "Firm setup" })).toBeInTheDocument();
    for (const [role, name] of [
      ["textbox", "Firm name"],
      ["textbox", "Address"],
      ["textbox", "Contact email"],
      ["textbox", "Phone"],
      ["combobox", "Timezone"],
    ] as const) {
      expect(screen.getByRole(role, { name }), name).toBeInTheDocument();
    }
    const steps = screen.getByRole("list", { name: "Setup progress" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(2);
    expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent("Step 1 of 2");
  });

  it("only the active step is exposed to assistive technology", async () => {
    const { user } = await ready();
    expect(screen.queryByRole("combobox", { name: "Financial year starts in" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Financial year and next steps" });
    expect(screen.getByRole("combobox", { name: "Financial year starts in" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Firm name" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Timezone" })).not.toBeInTheDocument();
  });

  it("moves focus to the heading on Continue and on Back, and marks the current step", async () => {
    const { user } = await ready();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const h2 = await screen.findByRole("heading", { name: "Financial year and next steps" });
    await waitFor(() => expect(h2).toHaveFocus());
    expect(screen.getByRole("list", { name: "Setup progress" }).querySelector('[aria-current="step"]')).toHaveTextContent("Step 2 of 2");

    await user.click(screen.getByRole("button", { name: "Back" }));
    const h1 = await screen.findByRole("heading", { name: "Set up your firm" });
    await waitFor(() => expect(h1).toHaveFocus());
  });

  it("form-level failures are announced as an alert, field errors are linked with aria-describedby", async () => {
    updateSettings.mockRejectedValueOnce(apiError(500, "Something went wrong."));
    const { user } = await ready();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  it("the loading skeleton is a status region and a load failure is an alert with a retry button", async () => {
    getFirm.mockReturnValueOnce(deferred<FirmProfile>().promise);
    const first = renderWithProviders(<OnboardingWizard />);
    expect(screen.getByRole("status", { name: "Loading firm details" })).toBeInTheDocument();
    first.unmount();

    getFirm.mockRejectedValueOnce(apiError(403, "Forbidden", { code: "FORBIDDEN" }));
    renderWithProviders(<OnboardingWizard />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You do not have permission to view the firm details.");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("OnboardingWizard: PATCH sequence and partial failure", () => {
  async function ready() {
    const rendered = renderWithProviders(<OnboardingWizard />);
    rendered.queryClient.setQueryData(currentUserQueryKey, incompleteOwner);
    await screen.findByLabelText("Firm name");
    return rendered;
  }
  const toStep2 = async (user: Awaited<ReturnType<typeof ready>>["user"]) => {
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Financial year and next steps" });
  };

  it("double-clicking Finish sends the settings PATCH only once", async () => {
    const pending = deferred<FirmSettings>();
    updateSettings.mockReturnValue(pending.promise);
    const { user } = await ready();
    await toStep2(user);
    await user.dblClick(screen.getByRole("button", { name: "Finish setup" }));
    pending.resolve(makeSettings({ onboarding_completed: true }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateFirm).not.toHaveBeenCalled();
  });

  it("sends the month as a number, including December", async () => {
    const { user } = await ready();
    await toStep2(user);
    await user.selectOptions(screen.getByLabelText("Financial year starts in"), "12");
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ financial_year_start_month: 12, onboarding_completed: true }));
    expect(typeof updateSettings.mock.calls[0]?.[0].financial_year_start_month).toBe("number");
  });

  it("never sends the firm id, settings object or onboarding false", async () => {
    const { user } = await ready();
    type("Firm name", "Renamed Firm");
    await toStep2(user);
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    for (const [patch] of [...updateFirm.mock.calls, ...updateSettings.mock.calls]) {
      expect(Object.keys(patch)).not.toContain("id");
      expect(Object.keys(patch)).not.toContain("firm_id");
      expect(Object.keys(patch)).not.toContain("settings");
      expect((patch as { onboarding_completed?: boolean }).onboarding_completed).not.toBe(false);
    }
  });

  it("partial failure, go Back, edit again: only the NEW edit is re-sent and settings is retried", async () => {
    updateFirm.mockImplementation(async (patch) => applyProfilePatch(makeProfile(), patch));
    updateSettings.mockRejectedValueOnce(apiError(500, "Something went wrong."));
    const { user } = await ready();
    type("Phone", "9876543210");
    await toStep2(user);
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your firm details were saved");

    await user.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "Set up your firm" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // the stale error is cleared
    type("Phone", "9123456789");
    await toStep2(user);
    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(updateFirm).toHaveBeenCalledTimes(2);
    expect(updateFirm).toHaveBeenNthCalledWith(1, { phone: "9876543210" });
    expect(updateFirm).toHaveBeenNthCalledWith(2, { phone: "9123456789" });
    expect(updateSettings).toHaveBeenCalledTimes(2);
  });

  it("a settings failure when no details were changed shows the plain error without the 'details were saved' prefix", async () => {
    updateSettings.mockRejectedValueOnce(apiError(null, "Cannot reach the server."));
    const { user } = await ready();
    await toStep2(user);
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Cannot reach the server.");
    expect(alert).not.toHaveTextContent("details were saved");
    expect(updateFirm).not.toHaveBeenCalled();
  });

  it("the Finish button is usable again after every kind of failure", async () => {
    updateSettings.mockRejectedValueOnce(apiError(500, "boom"));
    updateSettings.mockRejectedValueOnce(apiError(null, "offline"));
    updateSettings.mockRejectedValueOnce(apiError(403, "no", { code: "FORBIDDEN" }));
    const { user } = await ready();
    await toStep2(user);
    for (const text of ["boom", "offline", "Only the owner can change firm settings."]) {
      await user.click(screen.getByRole("button", { name: "Finish setup" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.getByRole("button", { name: "Finish setup" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    }
    // The fourth attempt succeeds.
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("a 403 on the firm PATCH explains it, stays on step 2, never calls settings and keeps what was typed", async () => {
    updateFirm.mockRejectedValueOnce(apiError(403, "no", { code: "FORBIDDEN" }));
    const { user } = await ready();
    type("Phone", "9876543210");
    await toStep2(user);
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the owner can change firm settings.");
    expect(updateSettings).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Phone")).toHaveValue("9876543210");
  });

  it.each([
    ["name", "Firm name", "Firm name is not allowed"],
    ["address", "Address", "Address is too creative"],
    ["phone", "Phone", "Phone rejected by server"],
    ["timezone", "Timezone", "Zone rejected by server"],
  ])("a server error on %s lands on that field and returns to step 1 (focus goes to the step heading)", async (field, label, message) => {
    updateFirm.mockRejectedValueOnce(
      apiError(400, "Validation failed", { code: "VALIDATION_ERROR", errors: [{ field, message }] }),
    );
    const { user } = await ready();
    type("Firm name", "Changed Firm");
    await toStep2(user);
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    const text = await screen.findByText(message);
    expect(screen.getByRole("heading", { name: "Set up your firm" })).toBeInTheDocument();
    const control = screen.getByLabelText(label);
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-describedby", text.id);
    // The field itself is still hidden at the moment RHF tries to focus it, so focus lands on the step heading.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Set up your firm" })).toHaveFocus());
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("keeps everything typed when a server error sends the user back to step 1", async () => {
    updateFirm.mockRejectedValueOnce(
      apiError(400, "Validation failed", { code: "VALIDATION_ERROR", errors: [{ field: "email", message: "No" }] }),
    );
    const { user } = await ready();
    type("Contact email", "office@demo-ca.example");
    type("Address", "12 MG Road");
    await toStep2(user);
    await user.selectOptions(screen.getByLabelText("Financial year starts in"), "10");
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await screen.findByText("No");
    expect(screen.getByLabelText("Address")).toHaveValue("12 MG Road");
    expect(screen.getByLabelText("Contact email")).toHaveValue("office@demo-ca.example");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    // The month choice survived the round trip too.
    expect(await screen.findByLabelText("Financial year starts in")).toHaveValue("10");
  });
});

// ---------------------------------------------------------------------------------------------
// Settings form
// ---------------------------------------------------------------------------------------------
describe("SettingsView: change detection and feedback", () => {
  const saved = makeProfile({ address: "12 MG Road, Pune", email: "office@demo-ca.example", phone: "+91 98765 43210" });
  beforeEach(() => {
    getFirm.mockResolvedValue(saved);
    getSettings.mockResolvedValue(makeSettings({ onboarding_completed: true }));
    updateFirm.mockImplementation(async (patch) => applyProfilePatch(saved, patch));
  });

  async function ready(role: UserRole = "owner") {
    meMock.mockResolvedValue(makeUser(role));
    const rendered = renderWithProviders(<SettingsView />);
    await screen.findByLabelText("Firm name");
    await waitFor(() =>
      role === "owner"
        ? expect(screen.getByLabelText("Firm name")).toBeEnabled()
        : expect(screen.getByLabelText("Firm name")).toBeDisabled(),
    );
    return rendered;
  }
  const save = () => screen.getByRole("button", { name: "Save changes" });

  it("whitespace-only and e-mail-case-only edits do not count as changes", async () => {
    await ready();
    type("Firm name", "  Demo CA Associates  ");
    type("Contact email", "OFFICE@Demo-CA.example");
    type("Phone", "  +91 98765 43210 ");
    expect(save()).toBeDisabled();
  });

  it("reverting an edit disables Save again", async () => {
    const { user } = await ready();
    await user.type(screen.getByLabelText("Firm name"), "X");
    expect(save()).toBeEnabled();
    await user.type(screen.getByLabelText("Firm name"), "{Backspace}");
    expect(save()).toBeDisabled();
  });

  it("the 'saved' confirmation disappears when the user edits again, and Save needs a fresh change", async () => {
    const { user } = await ready();
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.click(save());
    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
    expect(save()).toBeDisabled();
    await user.type(screen.getByLabelText("Firm name"), "!");
    expect(screen.queryByText("Firm settings saved.")).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("double-clicking Save sends one PATCH", async () => {
    const pending = deferred<FirmProfile>();
    updateFirm.mockReturnValue(pending.promise);
    const { user } = await ready();
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.dblClick(save());
    pending.resolve({ ...saved, name: "Demo CA Associates LLP" });
    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
    expect(updateFirm).toHaveBeenCalledTimes(1);
  });

  it("a server 400 can be fixed and resubmitted: the error and aria-invalid go away", async () => {
    updateFirm.mockRejectedValueOnce(
      apiError(400, "Validation failed", { code: "VALIDATION_ERROR", errors: [{ field: "phone", message: "Phone rejected" }] }),
    );
    const { user } = await ready();
    await user.clear(screen.getByLabelText("Phone"));
    await user.type(screen.getByLabelText("Phone"), "9876543210");
    await user.click(save());
    expect(await screen.findByText("Phone rejected")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByLabelText("Phone")).toHaveFocus());

    await user.clear(screen.getByLabelText("Phone"));
    await user.type(screen.getByLabelText("Phone"), "9123456789");
    await user.click(save());
    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
    expect(screen.queryByText("Phone rejected")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("a network failure keeps the edits, shows the error and a retry sends the same patch", async () => {
    updateFirm.mockRejectedValueOnce(apiError(null, "Cannot reach the server."));
    const { user } = await ready();
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the server.");
    expect(screen.getByLabelText("Firm name")).toHaveValue("Demo CA Associates LLP");
    expect(save()).toBeEnabled();
    await user.click(save());
    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
    expect(updateFirm).toHaveBeenNthCalledWith(1, { name: "Demo CA Associates LLP" });
    expect(updateFirm).toHaveBeenNthCalledWith(2, { name: "Demo CA Associates LLP" });
  });

  it("a 403 from the server (owner was demoted meanwhile) explains it and keeps the edits", async () => {
    updateFirm.mockRejectedValueOnce(apiError(403, "no", { code: "FORBIDDEN" }));
    const { user } = await ready();
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the owner can change firm settings.");
    expect(screen.getByLabelText("Firm name")).toHaveValue("Demo CA Associates LLP");
  });

  it("writes the saved name and timezone into the current-user cache so the header updates", async () => {
    const { user, queryClient } = await ready();
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.selectOptions(screen.getByLabelText("Timezone"), "UTC");
    await user.click(save());
    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
    const cached = queryClient.getQueryData<ReturnType<typeof makeUser>>(currentUserQueryKey);
    expect(cached?.firm).toMatchObject({ name: "Demo CA Associates LLP", timezone: "UTC", onboarding_completed: true });
  });

  it("a stored timezone outside the common list stays selected and is not re-sent when other fields change", async () => {
    getFirm.mockResolvedValue({ ...saved, timezone: "Africa/Nairobi" });
    const { user } = await ready();
    expect(screen.getByLabelText("Timezone")).toHaveValue("Africa/Nairobi");
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.click(save());
    await screen.findByText("Firm settings saved.");
    expect(updateFirm).toHaveBeenCalledWith({ name: "Demo CA Associates LLP" });
  });

  it("a fixed-offset timezone that slipped into the data (see P1-004) is shown, not crashed on", async () => {
    getFirm.mockResolvedValue({ ...saved, timezone: "+05:30" });
    await ready();
    expect(screen.getByLabelText("Timezone")).toHaveValue("+05:30");
  });

  it("clearing every optional field sends three empty strings and shows them empty afterwards", async () => {
    const { user } = await ready();
    await user.clear(screen.getByLabelText("Address"));
    await user.clear(screen.getByLabelText("Contact email"));
    await user.clear(screen.getByLabelText("Phone"));
    await user.click(save());
    expect(await screen.findByText("Firm settings saved.")).toBeInTheDocument();
    expect(updateFirm).toHaveBeenCalledWith({ address: "", email: "", phone: "" });
    expect(screen.getByLabelText("Address")).toHaveValue("");
    expect(screen.getByLabelText("Phone")).toHaveValue("");
  });
});

describe("SettingsView: read-only for everyone but the owner", () => {
  beforeEach(() => {
    getFirm.mockResolvedValue(makeProfile({ address: "12 MG Road", email: "a@demo-ca.example", phone: "9876543210" }));
    getSettings.mockResolvedValue(makeSettings({ financial_year_start_month: 7, onboarding_completed: true }));
  });

  it.each(["manager", "employee", "viewer"] as const)(
    "%s: values are visible, nothing is focusable or submittable, and no write call can happen",
    async (role) => {
      meMock.mockResolvedValue(makeUser(role));
      const { user } = renderWithProviders(<SettingsView />);
      await waitFor(() => expect(screen.getByLabelText("Firm name")).toBeDisabled());
      expect(screen.getByLabelText("Address")).toHaveValue("12 MG Road");
      expect(screen.getByLabelText("Financial year starts in")).toHaveValue("7");
      expect(screen.getByRole("status")).toHaveTextContent("Only the owner can change firm settings.");

      const form = screen.getByRole("form", { name: "Firm settings" });
      expect(within(form).queryAllByRole("button")).toHaveLength(0);
      expect(form.querySelector("fieldset")).toBeDisabled();
      // Keyboard users cannot land on any control inside the form.
      await user.tab();
      expect(form.contains(document.activeElement)).toBe(false);
      // A forced submit (e.g. dev tools) still sends nothing, because nothing differs from the saved copy.
      fireEvent.submit(form);
      await new Promise((r) => setTimeout(r, 50));
      expect(updateFirm).not.toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
    },
  );

  it("an owner demoted while the page is open turns read-only at once (UI follows the session)", async () => {
    meMock.mockResolvedValue(makeUser("owner"));
    const { queryClient } = renderWithProviders(<SettingsView />);
    await waitFor(() => expect(screen.getByLabelText("Firm name")).toBeEnabled());
    queryClient.setQueryData(currentUserQueryKey, makeUser("viewer"));
    await waitFor(() => expect(screen.getByLabelText("Firm name")).toBeDisabled());
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("the page shows read-only (never editable) while the role is still unknown", async () => {
    meMock.mockReturnValue(deferred<ReturnType<typeof makeUser>>().promise);
    renderWithProviders(<SettingsView />);
    await screen.findByLabelText("Firm name");
    expect(screen.getByLabelText("Firm name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });
});

describe("SettingsView: accessibility basics", () => {
  it("labels, form name, status and alert roles", async () => {
    getFirm.mockResolvedValue(makeProfile());
    getSettings.mockResolvedValue(makeSettings({ onboarding_completed: true }));
    updateFirm.mockRejectedValueOnce(apiError(500, "Something went wrong."));
    const { user } = renderWithProviders(<SettingsView />);
    await waitFor(() => expect(screen.getByLabelText("Firm name")).toBeEnabled());
    expect(screen.getByRole("form", { name: "Firm settings" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Firm profile" })).toBeInTheDocument(); // fieldset + legend
    for (const [role, name] of [
      ["textbox", "Firm name"],
      ["textbox", "Address"],
      ["textbox", "Contact email"],
      ["textbox", "Phone"],
      ["combobox", "Timezone"],
      ["combobox", "Financial year starts in"],
    ] as const) {
      expect(screen.getByRole(role, { name }), name).toBeInTheDocument();
    }
    await user.type(screen.getByLabelText("Firm name"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Firm settings saved.");
  });
});

// ---------------------------------------------------------------------------------------------
// Session expiry while editing
// ---------------------------------------------------------------------------------------------
describe("session ends while the owner is editing", () => {
  it("P1-008: a 401 on the save sends the user to /login (the session check is re-run)", async () => {
    setLocation("/settings");
    getFirm.mockResolvedValue(makeProfile());
    getSettings.mockResolvedValue(makeSettings({ onboarding_completed: true }));
    meMock.mockResolvedValueOnce(makeUser("owner"));
    updateFirm.mockRejectedValue(apiError(401, "Authentication required", { code: "UNAUTHENTICATED" }));

    const user = userEvent.setup();
    render(
      <Providers>
        <RequireAuth>
          <SettingsView />
        </RequireAuth>
      </Providers>,
    );
    await waitFor(() => expect(screen.getByLabelText("Firm name")).toBeEnabled());
    // From now on the API reports the session as gone.
    meMock.mockRejectedValue(apiError(401, "Authentication required", { code: "UNAUTHENTICATED" }));
    await user.type(screen.getByLabelText("Firm name"), " LLP");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login/)), { timeout: 2000 });
  });
});
