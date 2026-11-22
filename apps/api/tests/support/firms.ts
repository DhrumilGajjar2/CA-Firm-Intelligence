import type { UserRole } from "../../src/generated/prisma/client.js";
import { createMember, registerOwner, type RegisteredOwner, type TestApp } from "../db-helpers.js";

export const FIRM = "/api/v1/firms/current";
export const SETTINGS = "/api/v1/firms/current/settings";
export const ME = "/api/v1/auth/me";
export const ROLES: UserRole[] = ["owner", "manager", "employee", "viewer"];

/** Sends a request with an optional cookie header and optional JSON body. */
export const call = (
  t: Pick<TestApp, "app">,
  method: "GET" | "PATCH" | "POST" | "PUT" | "DELETE",
  url: string,
  cookie?: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  t.app.inject({
    method,
    url,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

export interface FirmFixture {
  owner: RegisteredOwner;
  firmId: string;
  /** Session cookie per role (every cookie really belongs to a member of this firm). */
  cookies: Record<UserRole, string>;
  userIds: Record<UserRole, string>;
}

/**
 * One firm with an owner (registered through the real endpoint) and a manager, employee and viewer
 * (inserted directly). Sessions for the three members are minted with the app's own signer, so
 * the tests do not pay for three password verifications.
 */
export async function firmWithAllRoles(
  t: TestApp,
  firm_name = "Role Matrix & Co",
): Promise<FirmFixture> {
  const owner = await registerOwner(t, { firm_name });
  const firmId = owner.user.firm.id;
  const cookies = { owner: owner.cookie } as Record<UserRole, string>;
  const userIds = { owner: owner.user.id } as Record<UserRole, string>;
  for (const role of ["manager", "employee", "viewer"] as const) {
    const m = await createMember(t.prisma, { firm_id: firmId, role });
    userIds[role] = m.id;
    cookies[role] = cookieFor(t, m.id, firmId, role);
  }
  return { owner, firmId, cookies, userIds };
}

/** `access_token=<jwt>` for a user of a firm, signed by the app itself. */
export function cookieFor(
  t: Pick<TestApp, "app">,
  userId: string,
  firmId: string,
  role: UserRole,
): string {
  return `access_token=${t.app.jwt.sign({ sub: userId, firm_id: firmId, role })}`;
}
