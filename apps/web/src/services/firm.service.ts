import { endpoints } from "@ca-firm/api-contracts";
import type { FirmProfile, FirmSettings } from "@ca-firm/shared-types";
import type { UpdateFirmInput, UpdateFirmSettingsInput } from "@ca-firm/validation";
import { requestData } from "@/lib/api-client";

/**
 * Firm API calls (contract: docs/API_SPECIFICATION.md, "P1 contracts > Firm").
 * The firm is always the signed-in user's firm: there is no firm id in any path or body.
 * Reads are open to every role; PATCH is owner-only (403 otherwise).
 */
export const firmService = {
  getFirm: () =>
    requestData<FirmProfile>({ method: "GET", url: endpoints.firms.current }),
  /** Partial update. An empty string clears an optional field (address, email, phone). */
  updateFirm: (input: UpdateFirmInput) =>
    requestData<FirmProfile>({
      method: "PATCH",
      url: endpoints.firms.current,
      data: input,
    }),
  getSettings: () =>
    requestData<FirmSettings>({ method: "GET", url: endpoints.firms.settings }),
  /** Partial update. `onboarding_completed` can only be set to true. */
  updateSettings: (input: UpdateFirmSettingsInput) =>
    requestData<FirmSettings>({
      method: "PATCH",
      url: endpoints.firms.settings,
      data: input,
    }),
};
