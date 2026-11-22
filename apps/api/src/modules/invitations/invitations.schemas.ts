import {
  INVITATION_STATUSES,
  USER_ROLES,
  type CreatedInvitation,
  type Invitation,
  type InvitationPreview,
} from "@ca-firm/shared-types";
import { z } from "zod";

/** Response shape of `Invitation`. Never contains the token or its hash. */
export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(USER_ROLES),
  status: z.enum(INVITATION_STATUSES),
  expires_at: z.string(),
  created_at: z.string(),
  invited_by: z.object({ id: z.string(), name: z.string() }),
}) satisfies z.ZodType<Invitation>;

/** Response shape of `CreatedInvitation`: the only response that carries the raw token (inside `invite_url`). */
export const createdInvitationSchema = invitationSchema.extend({
  invite_url: z.string(),
}) satisfies z.ZodType<CreatedInvitation>;

export const invitationPreviewSchema = z.object({
  email: z.string(),
  role: z.enum(USER_ROLES),
  firm_name: z.string(),
  expires_at: z.string(),
}) satisfies z.ZodType<InvitationPreview>;

export const invitationIdParamsSchema = z.object({ id: z.string().min(1).max(100) });
