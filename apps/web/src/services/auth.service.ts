import { endpoints } from "@ca-firm/api-contracts";
import type { CurrentUser } from "@ca-firm/shared-types";
import type { LoginInput } from "@ca-firm/validation";
import { requestData } from "@/lib/api-client";

/** Auth API calls (PRD §9.2). Endpoints are implemented by the backend in P1. */
export const authService = {
  login: (input: LoginInput) =>
    requestData<CurrentUser>({ method: "POST", url: endpoints.auth.login, data: input }),
  logout: () => requestData<null>({ method: "POST", url: endpoints.auth.logout }),
};
