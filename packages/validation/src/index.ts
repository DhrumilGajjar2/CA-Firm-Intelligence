import { z } from "zod";
import { CLIENT_TYPES, USER_ROLES } from "@ca-firm/shared-types";

/** Zod schemas shared by the web form layer and the API. Keep in sync with API_SPECIFICATION.md. */

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createClientSchema = z.object({
  client_code: z.string().min(1, "Client code is required").max(30),
  display_name: z.string().min(1, "Client name is required").max(200),
  email: z.string().email("Enter a valid email address").optional().or(z.literal("")),
  phone: z
    .string()
    .regex(/^[0-9+\-\s]{10,15}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
  client_type: z.enum(CLIENT_TYPES),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const inviteUserSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  role: z.enum(USER_ROLES).exclude(["owner"]),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
