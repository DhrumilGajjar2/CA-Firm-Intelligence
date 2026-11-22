import { USER_ROLES, type CurrentUser } from "@ca-firm/shared-types";
import { z } from "zod";

/** Response shape of `CurrentUser` (see @ca-firm/shared-types and docs/API_SPECIFICATION.md). */
export const currentUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(USER_ROLES),
  firm: z.object({
    id: z.string(),
    name: z.string(),
    timezone: z.string(),
    onboarding_completed: z.boolean(),
  }),
}) satisfies z.ZodType<CurrentUser>;
