import { endpoints } from "@ca-firm/api-contracts";
import type { Invitation, InvitationStatus } from "@ca-firm/shared-types";
import { request, requestData } from "@/lib/api-client";
import { cleanParams } from "@/lib/query-params";

/** Query for GET /invitations (the API defaults page=1, limit=20 and sorts newest first). */
export interface InvitationsListQuery {
  page?: number;
  limit?: number;
  status?: InvitationStatus;
}

/** Invitation management (owner only; docs/API_SPECIFICATION.md, "Invitations (addition)"). */
export const invitationsService = {
  /** Full envelope: `data` is the page of invitations, `meta` holds page/limit/total. */
  list: (query: InvitationsListQuery = {}) =>
    request<Invitation[]>({
      method: "GET",
      url: endpoints.invitations.list,
      params: cleanParams(query),
    }),
  /** Returns the invitation with status `revoked`; 409 when it is no longer pending. */
  revoke: (id: string) =>
    requestData<Invitation>({ method: "DELETE", url: endpoints.invitations.byId(id) }),
};
