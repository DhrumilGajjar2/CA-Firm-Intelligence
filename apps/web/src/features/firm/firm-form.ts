import type { FieldError, FieldErrors, Resolver } from "react-hook-form";
import type { FirmProfile, FirmSettings } from "@ca-firm/shared-types";
import {
  updateFirmSchema,
  updateFirmSettingsSchema,
  type UpdateFirmInput,
  type UpdateFirmSettingsInput,
} from "@ca-firm/validation";
import { ApiRequestError } from "@/lib/api-client";

export const FIRM_FIELDS = ["name", "address", "email", "phone", "timezone"] as const;
export type FirmField = (typeof FIRM_FIELDS)[number];
export const MONTH_FIELD = "financial_year_start_month" as const;

/** Form state for onboarding and settings: everything is a string, as typed into inputs. */
export interface FirmFormValues {
  name: string;
  address: string;
  email: string;
  phone: string;
  timezone: string;
  financial_year_start_month: string;
}

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
export const DEFAULT_FY_START_MONTH = 4;

export const TIMEZONE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "Asia/Kolkata", label: "India (Asia/Kolkata, IST)" },
  { value: "Asia/Dubai", label: "Dubai (Asia/Dubai, GST)" },
  { value: "Asia/Singapore", label: "Singapore (Asia/Singapore)" },
  { value: "Asia/Kathmandu", label: "Nepal (Asia/Kathmandu)" },
  { value: "Asia/Colombo", label: "Sri Lanka (Asia/Colombo)" },
  { value: "Asia/Dhaka", label: "Bangladesh (Asia/Dhaka)" },
  { value: "Europe/London", label: "London (Europe/London)" },
  { value: "America/New_York", label: "New York (America/New_York)" },
  { value: "America/Los_Angeles", label: "Los Angeles (America/Los_Angeles)" },
  { value: "Australia/Sydney", label: "Sydney (Australia/Sydney)" },
  { value: "UTC", label: "UTC" },
];

/** The list, plus the firm's current timezone when it is not one of the common choices. */
export function timezoneOptionsFor(current: string) {
  if (!current || TIMEZONE_OPTIONS.some((o) => o.value === current)) {
    return TIMEZONE_OPTIONS;
  }
  return [{ value: current, label: current }, ...TIMEZONE_OPTIONS];
}

export const MONTH_OPTIONS: readonly { value: string; label: string }[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
].map((label, i) => ({ value: String(i + 1), label }));

export function toFormValues(
  profile: FirmProfile,
  settings: FirmSettings,
): FirmFormValues {
  return {
    name: profile.name,
    address: profile.address ?? "",
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    timezone: profile.timezone || DEFAULT_TIMEZONE,
    financial_year_start_month: String(
      settings.financial_year_start_month || DEFAULT_FY_START_MONTH,
    ),
  };
}

function normalized(values: FirmFormValues) {
  return {
    name: values.name.trim(),
    address: values.address.trim(),
    email: values.email.trim().toLowerCase(),
    phone: values.phone.trim(),
    timezone: values.timezone.trim(),
  };
}

/**
 * Only the firm fields that differ from the saved profile. A cleared optional field is sent as
 * an empty string (the API turns it into null). Returns `{}` when nothing changed.
 */
export function diffFirmProfile(
  profile: FirmProfile,
  values: FirmFormValues,
): UpdateFirmInput {
  const next = normalized(values);
  const patch: UpdateFirmInput = {};
  if (next.name !== profile.name.trim()) patch.name = next.name;
  if (next.address !== (profile.address ?? "").trim()) patch.address = next.address;
  if (next.email !== (profile.email ?? "").trim().toLowerCase()) patch.email = next.email;
  if (next.phone !== (profile.phone ?? "").trim()) patch.phone = next.phone;
  if (next.timezone !== profile.timezone) patch.timezone = next.timezone;
  return patch;
}

export function diffSettings(
  settings: FirmSettings,
  values: FirmFormValues,
): UpdateFirmSettingsInput {
  const month = Number(values.financial_year_start_month);
  return month === settings.financial_year_start_month
    ? {}
    : { financial_year_start_month: month };
}

export const hasKeys = (obj: object) => Object.keys(obj).length > 0;

/** Validates with the shared schemas, so the UI and the API agree on every rule. */
export const firmFormResolver: Resolver<FirmFormValues> = (values) => {
  const errors: Record<string, FieldError> = {};
  const known: readonly string[] = FIRM_FIELDS;

  const firm = updateFirmSchema.safeParse(normalized(values));
  if (!firm.success) {
    for (const issue of firm.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && known.includes(field) && !errors[field]) {
        errors[field] = { type: issue.code, message: issue.message };
      }
    }
  }

  const month = updateFirmSettingsSchema.safeParse({
    financial_year_start_month: Number(values.financial_year_start_month),
  });
  if (!month.success) {
    errors[MONTH_FIELD] = { type: "invalid", message: "Choose a month from the list" };
  }

  return Object.keys(errors).length > 0
    ? { values: {}, errors: errors as FieldErrors<FirmFormValues> }
    : { values, errors: {} };
};

export const OWNER_ONLY_MESSAGE = "Only the owner can change firm settings.";

/** True when the API refused because the signed-in user is not the owner. */
export const isForbiddenError = (error: unknown) =>
  error instanceof ApiRequestError && error.status === 403;

/** True when the error carries a message for one of the given form fields. */
export function hasFieldErrorFor(error: unknown, fields: readonly string[]) {
  return (
    error instanceof ApiRequestError &&
    error.errors.some((e) => e.field && fields.includes(e.field))
  );
}
