import { z } from "zod";
import {
  CLIENT_TYPES,
  INVITATION_STATUSES,
  USER_ROLES,
  USER_STATUS_FILTERS,
} from "@ca-firm/shared-types";

/** Zod schemas shared by the web form layer and the API. Keep in sync with API_SPECIFICATION.md. */

/**
 * Phone numbers: 10-15 characters, only digits, `+`, `-` and a plain space (U+0020). Not `\s`, which would
 * also allow line breaks, tabs, NBSP and U+2028/2029 inside the stored value.
 */
const PHONE_PATTERN = /^[0-9+\- ]{10,15}$/;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  password: z.string().min(1, "Password is required").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createClientSchema = z.object({
  client_code: z.string().min(1, "Client code is required").max(30),
  display_name: z.string().min(1, "Client name is required").max(200),
  email: z.string().email("Enter a valid email address").optional().or(z.literal("")),
  phone: z
    .string()
    .regex(PHONE_PATTERN, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
  client_type: z.enum(CLIENT_TYPES),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

// ---------- Free-text safety (P1) ----------

/**
 * Free text reaches PostgreSQL, which rejects NUL (U+0000) in text columns (a 500 if unchecked), and
 * control characters have no place in names. Single-line fields reject all C0/C1 control characters;
 * multi-line fields (address) additionally allow tab, line feed and carriage return.
 */
const SINGLE_LINE_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const MULTI_LINE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** Refinement for a single-line free-text string (names, search). */
export const noControlChars = (v: string) => !SINGLE_LINE_CONTROL.test(v);
/** Refinement for a multi-line free-text string (address). */
export const noControlCharsMultiline = (v: string) => !MULTI_LINE_CONTROL.test(v);
const CONTROL_MESSAGE = "Contains characters that are not allowed";

// ---------- Auth (P1) ----------

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254);

/** Password policy: 8-128 chars with at least one letter and one digit. */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Your name is required")
    .max(120)
    .refine(noControlChars, CONTROL_MESSAGE),
  email: emailField,
  password: passwordSchema,
  firm_name: z
    .string()
    .trim()
    .min(1, "Firm name is required")
    .max(200)
    .refine(noControlChars, CONTROL_MESSAGE),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required").max(512),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, "Invitation token is required").max(512),
  name: z
    .string()
    .trim()
    .min(1, "Your name is required")
    .max(120)
    .refine(noControlChars, CONTROL_MESSAGE),
  password: passwordSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

// ---------- Firm (P1) ----------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(noControlCharsMultiline, CONTROL_MESSAGE)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/**
 * IANA timezone name, e.g. "Asia/Kolkata" or "UTC". `Intl.DateTimeFormat` alone also accepts fixed UTC
 * offsets ("+05:30", "-08:00", "+0530", "+05"); those are not zone names, so the name must start with a letter.
 */
export const timezoneSchema = z.string().refine(
  (tz) => {
    if (!/^[A-Za-z]/.test(tz)) return false;
    try {
      new Intl.DateTimeFormat("en-IN", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Enter a valid timezone, e.g. Asia/Kolkata" },
);

/**
 * Optional contact field that can be cleared: whitespace-only or empty input becomes `null` (after
 * trimming), anything else must satisfy `inner`. `null` is accepted as "clear" too.
 */
const clearable = <T extends z.ZodType<string, string>>(inner: T) =>
  z
    .string()
    .trim()
    .pipe(z.union([z.literal("").transform(() => null), inner]))
    .nullable();

export const updateFirmSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Firm name is required")
      .max(200)
      .refine(noControlChars, CONTROL_MESSAGE),
    address: optionalText(500),
    email: clearable(
      z.string().toLowerCase().email("Enter a valid email address").max(254),
    ),
    phone: clearable(z.string().regex(PHONE_PATTERN, "Enter a valid phone number")),
    timezone: timezoneSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });
export type UpdateFirmInput = z.infer<typeof updateFirmSchema>;

export const updateFirmSettingsSchema = z
  .object({
    financial_year_start_month: z.number().int().min(1).max(12),
    onboarding_completed: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" });
export type UpdateFirmSettingsInput = z.infer<typeof updateFirmSettingsSchema>;

// ---------- Users (P1) ----------

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).refine(noControlChars, CONTROL_MESSAGE).optional(),
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUS_FILTERS).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const updateUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120)
    .refine(noControlChars, CONTROL_MESSAGE),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Ownership cannot be assigned or transferred in P1, so "owner" is excluded. */
export const updateUserRoleSchema = z.object({
  role: z.enum(USER_ROLES).exclude(["owner"]),
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

export const updateUserStatusSchema = z.object({ is_active: z.boolean() });
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const listInvitationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(INVITATION_STATUSES).optional(),
});
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;

export const inviteUserSchema = z.object({
  email: emailField,
  role: z.enum(USER_ROLES).exclude(["owner"]),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
