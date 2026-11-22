import { USER_ROLES, type FirmUser } from "@ca-firm/shared-types";
import { z } from "zod";

/** Response shape of `FirmUser` (see @ca-firm/shared-types and docs/API_SPECIFICATION.md). Never has a password hash. */
export const firmUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(USER_ROLES),
  is_active: z.boolean(),
  last_login_at: z.string().nullable(),
  created_at: z.string(),
}) satisfies z.ZodType<FirmUser>;

/** `:id` is a user id; malformed ids are a 404 from the service, not a 400. */
export const userIdParamsSchema = z.object({ id: z.string().min(1).max(100) });
