import type { LightMyRequestResponse } from "fastify";
import type { UserRole } from "../../src/generated/prisma/client.js";
import { createMember, registerOwner, type TestApp } from "../db-helpers.js";
import { call, cookieFor, firmWithAllRoles, type FirmFixture } from "./firms.js";

export const USERS = "/api/v1/users";
export const INVITE = "/api/v1/users/invite";
export const INVITATIONS = "/api/v1/invitations";
export const PREVIEW = (token: string) =>
  `/api/v1/auth/invitations/${encodeURIComponent(token)}`;
export const ACCEPT = "/api/v1/auth/accept-invitation";
export const LOGIN = "/api/v1/auth/login";
export const ME = "/api/v1/auth/me";
export const FIRM_URL = "/api/v1/firms/current";
export const SETTINGS_URL = "/api/v1/firms/current/settings";
export const NO_ONE = "00000000-0000-4000-8000-000000000000";
export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;

export const ERROR_KEYS = ["code", "errors", "message", "success"];
export const FORBIDDEN_MESSAGE = "You do not have permission to perform this action";

export type Identity = UserRole | "anonymous";
export const IDENTITIES: Identity[] = ["owner", "manager", "employee", "viewer", "anonymous"];

/** Sends an arbitrary raw body with an explicit content type (to hit the parser, not the schema). */
export const rawCall = (
  t: Pick<TestApp, "app">,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  cookie: string | undefined,
  body: string,
  contentType = "application/json",
) =>
  t.app.inject({
    method,
    url,
    headers: { ...(cookie ? { cookie } : {}), "content-type": contentType },
    payload: body,
  });

export const cookieOfIdentity = (f: FirmFixture, who: Identity): string | undefined =>
  who === "anonymous" ? undefined : f.cookies[who];

/** The token inside a 201 invite response. */
export const tokenOf = (res: LightMyRequestResponse): string =>
  new URL(res.json().data.invite_url).searchParams.get("token")!;

/** Exact error envelope: only success/message/code/errors, no stack, SQL or internals. */
export function expectEnvelope(res: LightMyRequestResponse, status: number, code: string) {
  const body = res.json();
  if (res.statusCode !== status) {
    throw new Error(`expected ${status} ${code}, got ${res.statusCode}: ${res.body.slice(0, 300)}`);
  }
  if (Object.keys(body).sort().join() !== ERROR_KEYS.join()) {
    throw new Error(`error envelope keys were ${Object.keys(body).join()}`);
  }
  if (body.success !== false || body.code !== code || !Array.isArray(body.errors)) {
    throw new Error(`unexpected envelope ${res.body.slice(0, 300)}`);
  }
  if (/prisma|postgres|stack|at\s+\S+\s+\(|SELECT |INSERT /i.test(res.body)) {
    throw new Error(`error body leaks internals: ${res.body.slice(0, 300)}`);
  }
}

export interface TwoFirms {
  a: FirmFixture;
  b: FirmFixture;
}

/** Two complete firms (all four roles each). */
export async function twoFirms(t: TestApp): Promise<TwoFirms> {
  const a = await firmWithAllRoles(t, "Firm A Associates");
  const b = await firmWithAllRoles(t, "Firm B Associates");
  return { a, b };
}

/** Invites through the real endpoint and returns the raw token and invitation id. */
export async function inviteVia(
  t: TestApp,
  cookie: string,
  email: string,
  role: "manager" | "employee" | "viewer" = "employee",
) {
  const res = await call(t, "POST", INVITE, cookie, { email, role });
  if (res.statusCode !== 201) throw new Error(`invite failed: ${res.statusCode} ${res.body}`);
  return { token: tokenOf(res), id: res.json().data.id as string, res };
}

export { call, cookieFor, createMember, firmWithAllRoles, registerOwner };
