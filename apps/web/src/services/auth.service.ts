import { endpoints } from "@ca-firm/api-contracts";
import type { CurrentUser, InvitationPreview } from "@ca-firm/shared-types";
import type {
  AcceptInvitationInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "@ca-firm/validation";
import { requestData } from "@/lib/api-client";

/**
 * Auth API calls (contract: docs/API_SPECIFICATION.md, "P1 contracts").
 * Login/register set the httpOnly session cookie and return the current user.
 */
export const authService = {
  register: (input: RegisterInput) =>
    requestData<CurrentUser>({
      method: "POST",
      url: endpoints.auth.register,
      data: input,
    }),
  login: (input: LoginInput) =>
    requestData<CurrentUser>({ method: "POST", url: endpoints.auth.login, data: input }),
  /** Idempotent: works with or without a valid session; clears the cookie. */
  logout: () => requestData<null>({ method: "POST", url: endpoints.auth.logout }),
  /** Current user and firm. Rejects with a 401 ApiRequestError when signed out. */
  me: () => requestData<CurrentUser>({ method: "GET", url: endpoints.auth.me }),
  /** Always succeeds for a well-formed email (no user enumeration). */
  forgotPassword: (input: ForgotPasswordInput) =>
    requestData<null>({
      method: "POST",
      url: endpoints.auth.forgotPassword,
      data: input,
    }),
  /** Does not sign the user in. */
  resetPassword: (input: ResetPasswordInput) =>
    requestData<null>({
      method: "POST",
      url: endpoints.auth.resetPassword,
      data: input,
    }),
  /** Public. 404 for an unknown, expired, revoked or already used token (one generic message). */
  getInvitation: (token: string) =>
    requestData<InvitationPreview>({
      method: "GET",
      url: endpoints.auth.invitationByToken(token),
    }),
  /** Public. Creates the user, signs them in (httpOnly cookie) and returns the current user. */
  acceptInvitation: (input: AcceptInvitationInput) =>
    requestData<CurrentUser>({
      method: "POST",
      url: endpoints.auth.acceptInvitation,
      data: input,
    }),
};
