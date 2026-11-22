import type { FirmProfile, FirmSettings } from "@ca-firm/shared-types";

export function makeProfile(overrides: Partial<FirmProfile> = {}): FirmProfile {
  return {
    id: "firm-1",
    name: "Demo CA Associates",
    address: null,
    email: null,
    phone: null,
    timezone: "Asia/Kolkata",
    created_at: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<FirmSettings> = {}): FirmSettings {
  return {
    financial_year_start_month: 4,
    onboarding_completed: false,
    ...overrides,
  };
}
