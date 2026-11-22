import type { FirmProfile, FirmSettings } from "@ca-firm/shared-types";
import { z } from "zod";

/** Response shape of `FirmProfile` (see @ca-firm/shared-types and docs/API_SPECIFICATION.md). */
export const firmProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  timezone: z.string(),
  created_at: z.string(),
}) satisfies z.ZodType<FirmProfile>;

/** Response shape of `FirmSettings`. */
export const firmSettingsSchema = z.object({
  financial_year_start_month: z.number().int(),
  onboarding_completed: z.boolean(),
}) satisfies z.ZodType<FirmSettings>;
