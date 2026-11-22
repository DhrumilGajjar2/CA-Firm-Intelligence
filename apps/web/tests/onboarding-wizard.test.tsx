import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FirmProfile } from "@ca-firm/shared-types";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { OnboardingWizard } from "@/features/firm/onboarding-wizard";
import { firmService } from "@/services/firm.service";
import { makeProfile, makeSettings } from "./firm-fixtures";
import { router } from "./navigation-mock";
import { apiError, deferred, makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/firm.service");
const getFirm = vi.mocked(firmService.getFirm);
const getSettings = vi.mocked(firmService.getSettings);
const updateFirm = vi.mocked(firmService.updateFirm);
const updateSettings = vi.mocked(firmService.updateSettings);

const incompleteOwner = makeUser("owner", {
  firm: {
    id: "firm-1",
    name: "Demo CA Associates",
    timezone: "Asia/Kolkata",
    onboarding_completed: false,
  },
});

type Rendered = ReturnType<typeof renderWithProviders>;

beforeEach(() => {
  getFirm.mockResolvedValue(makeProfile());
  getSettings.mockResolvedValue(makeSettings());
  // The API answers with the updated profile (cleared optional fields come back as null).
  updateFirm.mockImplementation(async (patch) => {
    const next: Record<string, unknown> = { ...makeProfile(), ...patch };
    for (const key of ["address", "email", "phone"]) {
      if (next[key] === "") next[key] = null;
    }
    return next as unknown as FirmProfile;
  });
  updateSettings.mockImplementation(async (patch) => ({
    ...makeSettings(),
    ...patch,
  }));
});

async function renderReady() {
  const rendered = renderWithProviders(<OnboardingWizard />);
  rendered.queryClient.setQueryData(currentUserQueryKey, incompleteOwner);
  await screen.findByLabelText("Firm name");
  return rendered;
}

const continueButton = () => screen.getByRole("button", { name: "Continue" });
const finishButton = () => screen.getByRole("button", { name: "Finish setup" });

async function goToStep2({ user }: Rendered) {
  await user.click(continueButton());
  await screen.findByRole("heading", { name: "Financial year and next steps" });
}

describe("OnboardingWizard: loading", () => {
  it("shows a skeleton while the firm loads", () => {
    getFirm.mockReturnValue(deferred<FirmProfile>().promise);
    renderWithProviders(<OnboardingWizard />);
    expect(
      screen.getByRole("status", { name: "Loading firm details" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Firm name")).not.toBeInTheDocument();
  });

  it("shows an error with retry when the firm cannot be loaded", async () => {
    getFirm.mockRejectedValueOnce(apiError(500, "Server exploded"));
    const { user } = renderWithProviders(<OnboardingWizard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Firm name")).toHaveValue("Demo CA Associates");
    expect(getFirm).toHaveBeenCalledTimes(2);
  });
});

describe("OnboardingWizard: step 1 (firm details)", () => {
  it("prefills the firm name and defaults the timezone and month", async () => {
    await renderReady();
    expect(screen.getByLabelText("Firm name")).toHaveValue("Demo CA Associates");
    expect(screen.getByLabelText("Timezone")).toHaveValue("Asia/Kolkata");
    expect(screen.getByRole("list", { name: "Setup progress" })).toHaveTextContent(
      "Step 1 of 2",
    );
  });

  it("offers Asia/Kolkata and keeps an unusual current timezone selectable", async () => {
    getFirm.mockResolvedValue(makeProfile({ timezone: "Africa/Nairobi" }));
    await renderReady();
    const select = screen.getByLabelText("Timezone");
    expect(select).toHaveValue("Africa/Nairobi");
    expect(screen.getByRole("option", { name: /Asia\/Kolkata/ })).toBeInTheDocument();
  });

  it("validates before moving on and does not call the API", async () => {
    const { user } = await renderReady();
    await user.clear(screen.getByLabelText("Firm name"));
    await user.type(screen.getByLabelText("Contact email"), "not-an-email");
    await user.type(screen.getByLabelText("Phone"), "12");
    await user.click(continueButton());

    expect(await screen.findByText("Firm name is required")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid phone number")).toBeInTheDocument();
    expect(screen.getByLabelText("Firm name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("heading", { name: "Set up your firm" })).toBeInTheDocument();
    expect(updateFirm).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });
});

describe("OnboardingWizard: step 2 and navigation", () => {
  it("moves to step 2 with the April default and a 'what happens next' summary", async () => {
    const rendered = await renderReady();
    await goToStep2(rendered);

    expect(screen.getByLabelText("Financial year starts in")).toHaveValue("4");
    expect(screen.getByText("What happens next")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Setup progress" })).toHaveTextContent(
      "Step 2 of 2",
    );
    // Moving to step 2 saves nothing yet.
    expect(updateFirm).not.toHaveBeenCalled();
  });

  it("moves focus to the new step heading", async () => {
    const rendered = await renderReady();
    await goToStep2(rendered);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Financial year and next steps" }),
      ).toHaveFocus(),
    );
  });

  it("goes back a step and keeps what was typed", async () => {
    const rendered = await renderReady();
    await rendered.user.type(screen.getByLabelText("Phone"), "9876543210");
    await goToStep2(rendered);
    await rendered.user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      await screen.findByRole("heading", { name: "Set up your firm" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toHaveValue("9876543210");
  });

  it("lets the keyboard drive the flow: Enter in a field continues", async () => {
    const { user } = await renderReady();
    await user.type(screen.getByLabelText("Firm name"), "{Enter}");
    expect(
      await screen.findByRole("heading", { name: "Financial year and next steps" }),
    ).toBeInTheDocument();
  });
});

describe("OnboardingWizard: finishing", () => {
  it("sends one firm PATCH with only changed fields, then the settings PATCH", async () => {
    const order: string[] = [];
    updateFirm.mockImplementation(async (patch) => {
      order.push("firm");
      return { ...makeProfile(), ...patch } as unknown as FirmProfile;
    });
    updateSettings.mockImplementation(async (patch) => {
      order.push("settings");
      return { ...makeSettings(), ...patch };
    });

    const rendered = await renderReady();
    const { user, queryClient } = rendered;
    await user.type(screen.getByLabelText("Address"), "  12 MG Road, Pune ");
    await user.type(screen.getByLabelText("Contact email"), "Office@Demo-CA.example");
    await user.type(screen.getByLabelText("Phone"), "+91 98765 43210");
    await user.selectOptions(screen.getByLabelText("Timezone"), "Asia/Dubai");
    await goToStep2(rendered);
    await user.selectOptions(screen.getByLabelText("Financial year starts in"), "1");
    await user.click(finishButton());

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(order).toEqual(["firm", "settings"]);
    expect(updateFirm).toHaveBeenCalledTimes(1);
    // Name was not edited, so it is not sent.
    expect(updateFirm).toHaveBeenCalledWith({
      address: "12 MG Road, Pune",
      email: "office@demo-ca.example",
      phone: "+91 98765 43210",
      timezone: "Asia/Dubai",
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      financial_year_start_month: 1,
      onboarding_completed: true,
    });

    // The current user is updated so the guard stops redirecting to /onboarding.
    const cached = queryClient.getQueryData<typeof incompleteOwner>(currentUserQueryKey);
    expect(cached?.firm.onboarding_completed).toBe(true);
    expect(cached?.firm.timezone).toBe("Asia/Dubai");
  });

  it("skips the firm PATCH when nothing changed, and still completes onboarding", async () => {
    const rendered = await renderReady();
    await goToStep2(rendered);
    await rendered.user.click(finishButton());

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(updateFirm).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith({
      financial_year_start_month: 4,
      onboarding_completed: true,
    });
  });

  it("sends an empty string to clear an optional field that had a value", async () => {
    getFirm.mockResolvedValue(makeProfile({ address: "Old address" }));
    const rendered = await renderReady();
    await rendered.user.clear(screen.getByLabelText("Address"));
    await goToStep2(rendered);
    await rendered.user.click(finishButton());

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(updateFirm).toHaveBeenCalledWith({ address: "" });
  });

  it("disables the button and shows progress while saving", async () => {
    const pending = deferred<ReturnType<typeof makeSettings>>();
    updateSettings.mockReturnValue(pending.promise);
    const rendered = await renderReady();
    await goToStep2(rendered);
    await rendered.user.click(finishButton());

    expect(
      await screen.findByRole("button", { name: "Finishing setup…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    pending.resolve(makeSettings({ onboarding_completed: true }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
  });
});

describe("OnboardingWizard: failures", () => {
  it("retries safely after the settings call fails: details are not re-sent", async () => {
    updateSettings.mockRejectedValueOnce(apiError(500, "Something went wrong."));
    const rendered = await renderReady();
    const { user } = rendered;
    await user.type(screen.getByLabelText("Phone"), "9876543210");
    await goToStep2(rendered);
    await user.click(finishButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your firm details were saved");
    expect(alert).toHaveTextContent("Something went wrong.");
    expect(router.replace).not.toHaveBeenCalled();
    expect(updateFirm).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledTimes(1);

    // Retry: the saved details are the new baseline, so only settings is called again.
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(updateFirm).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledTimes(2);
    expect(updateSettings).toHaveBeenLastCalledWith({
      financial_year_start_month: 4,
      onboarding_completed: true,
    });
  });

  it("does not call settings when the firm PATCH fails, and retry resends the details", async () => {
    updateFirm.mockRejectedValueOnce(apiError(null, "Cannot reach the server."));
    const rendered = await renderReady();
    const { user } = rendered;
    await user.type(screen.getByLabelText("Phone"), "9876543210");
    await goToStep2(rendered);
    await user.click(finishButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot reach the server.",
    );
    expect(updateSettings).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(updateFirm).toHaveBeenCalledTimes(2);
    expect(updateFirm).toHaveBeenLastCalledWith({ phone: "9876543210" });
  });

  it("maps a server field error onto the field and returns to step 1", async () => {
    updateFirm.mockRejectedValueOnce(
      apiError(400, "Validation failed", {
        code: "VALIDATION_ERROR",
        errors: [{ field: "email", message: "Email domain is not allowed" }],
      }),
    );
    const rendered = await renderReady();
    const { user } = rendered;
    await user.type(screen.getByLabelText("Contact email"), "office@blocked.example");
    await goToStep2(rendered);
    await user.click(finishButton());

    const message = await screen.findByText("Email domain is not allowed");
    expect(screen.getByRole("heading", { name: "Set up your firm" })).toBeInTheDocument();
    expect(screen.getByLabelText("Contact email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Contact email")).toHaveAttribute(
      "aria-describedby",
      message.id,
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("shows a settings field error on step 2", async () => {
    updateSettings.mockRejectedValueOnce(
      apiError(400, "Validation failed", {
        code: "VALIDATION_ERROR",
        errors: [{ field: "financial_year_start_month", message: "Pick another month" }],
      }),
    );
    const rendered = await renderReady();
    await goToStep2(rendered);
    await rendered.user.click(finishButton());

    expect(await screen.findByText("Pick another month")).toBeInTheDocument();
    expect(screen.getByLabelText("Financial year starts in")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("explains a 403 (not the owner) instead of failing silently", async () => {
    updateSettings.mockRejectedValueOnce(
      apiError(403, "You do not have permission", { code: "FORBIDDEN" }),
    );
    const rendered = await renderReady();
    await goToStep2(rendered);
    await rendered.user.click(finishButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the owner can change firm settings.",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
});
