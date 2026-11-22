import type {
  ApiSuccess,
  CreatedInvitation,
  FirmUser,
  Invitation,
  PaginationMeta,
} from "@ca-firm/shared-types";

export function makeFirmUser(overrides: Partial<FirmUser> = {}): FirmUser {
  return {
    id: "u-1",
    name: "Meera Shah",
    email: "meera@example.com",
    role: "employee",
    is_active: true,
    last_login_at: "2026-11-20T09:30:00.000Z",
    created_at: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

export function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "inv-1",
    email: "newhire@example.com",
    role: "employee",
    status: "pending",
    expires_at: "2026-11-28T10:00:00.000Z",
    created_at: "2026-11-21T10:00:00.000Z",
    invited_by: { id: "user-1", name: "Asha Rao" },
    ...overrides,
  };
}

export function makeCreatedInvitation(
  overrides: Partial<CreatedInvitation> = {},
): CreatedInvitation {
  return {
    ...makeInvitation({ email: "staff@example.com" }),
    invite_url: "http://localhost:3000/accept-invitation?token=abc123",
    ...overrides,
  };
}

/** The full list envelope `request()` returns: data + meta. */
export function envelope<T>(
  data: T[],
  meta: Partial<PaginationMeta> = {},
): ApiSuccess<T[]> {
  return {
    success: true,
    message: "OK",
    data,
    meta: { page: 1, limit: 20, total: data.length, ...meta },
  };
}

/** The signed-in owner (id matches `makeUser()`'s "user-1") plus a few teammates. */
export const TEAM: FirmUser[] = [
  makeFirmUser({
    id: "user-1",
    name: "Asha Rao",
    email: "asha@example.com",
    role: "owner",
    last_login_at: "2026-11-21T08:00:00.000Z",
  }),
  makeFirmUser({
    id: "u-2",
    name: "Meera Shah",
    email: "meera@example.com",
    role: "manager",
  }),
  makeFirmUser({
    id: "u-3",
    name: "Karan Patel",
    email: "karan@example.com",
    role: "employee",
    last_login_at: null,
  }),
  makeFirmUser({
    id: "u-4",
    name: "Isha Verma",
    email: "isha@example.com",
    role: "viewer",
    is_active: false,
  }),
];
