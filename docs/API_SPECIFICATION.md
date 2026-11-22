# API Specification

Base URL: `/api/v1` (dev: `http://localhost:5000/api/v1`). Live OpenAPI docs: `http://localhost:5000/docs`
(raw JSON at `/docs/json`). The frontend must not call an endpoint until its status below is **Done**
(PRD section 14).

## Conventions

- JSON everywhere except file-upload endpoints (multipart).
- Auth: signed JWT in an **httpOnly cookie** (`access_token`). The frontend never reads or stores the token.
  Send requests with credentials (`withCredentials: true`). CORS allows only `FRONTEND_URL`.
- Firm scoping comes from the session, never from request parameters.
- JSON keys are `snake_case`. Dates are ISO 8601 (`YYYY-MM-DD` for calendar dates, UTC timestamps otherwise).
- Pagination: `?page=1&limit=20`; the response `meta` has `{ page, limit, total }`.

### Success

```json
{
  "success": true,
  "message": "Clients retrieved successfully",
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0 }
}
```

### Error

```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": [{ "field": "email", "message": "Invalid email address" }]
}
```

### Error codes

| HTTP      | `code`                                         | Meaning                                                      |
| --------- | ---------------------------------------------- | ------------------------------------------------------------ |
| 400       | `VALIDATION_ERROR` / `BAD_REQUEST`             | Invalid input; `errors[]` lists fields                       |
| 401       | `UNAUTHENTICATED`                              | Missing, invalid or expired session                          |
| 403       | `FORBIDDEN`                                    | Authenticated but role not allowed                           |
| 404       | `NOT_FOUND`                                    | Unknown route or record (also used for other firms' records) |
| 409       | `CONFLICT`                                     | Duplicate or conflicting state                               |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | Upload problems                                              |
| 429       | `RATE_LIMITED`                                 | Too many requests                                            |
| 500       | `INTERNAL_ERROR`                               | Unexpected; details are only in server logs                  |
| 503       | `SERVICE_UNAVAILABLE`                          | A dependency (e.g. database) is down                         |

## Endpoint status

Statuses: `Planned` (in the PRD, not yet specified) -> `Contract agreed` (fully specified here and in the shared packages; the
frontend may build against it with mocks) -> `Done` (implemented **and** tested; the frontend may call it for real).

| Area                          | Endpoints (PRD section 9)                                                                                                  | Phase | Status          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----- | --------------- |
| System                        | `GET /health`                                                                                                              | P0    | **Done**        |
| Auth                          | `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me`, `POST /auth/forgot-password`, `/auth/reset-password` | P1    | **Done**        |
| Auth (invitations, addition)  | `GET /auth/invitations/:token`, `POST /auth/accept-invitation`                                                             | P1    | **Done**        |
| Firms                         | `GET/PATCH /firms/current`, `GET/PATCH /firms/current/settings`                                                            | P1    | **Done**        |
| Users                         | `GET /users`, `POST /users/invite`, `GET/PATCH /users/:id`, `PATCH /users/:id/role`, `PATCH /users/:id/status`             | P1    | **Done**        |
| Invitations (addition)        | `GET /invitations`, `DELETE /invitations/:id` (revoke)                                                                     | P1    | **Done**        |
| Clients                       | CRUD, `GET /clients/:id/engagements`                                                                                       | P2    | Planned         |
| Services                      | `GET/POST /services`, `PATCH/DELETE /services/:id`                                                                         | P2    | Planned         |
| Engagements                   | CRUD, `/status`, `/assign`, `GET /engagements/overdue`                                                                     | P2    | Planned         |
| Imports                       | upload, list, detail, preview, confirm, errors, status                                                                     | P2    | Planned         |
| Invoices / Payments / Finance | see PRD 9.9                                                                                                                | P3    | Planned         |
| Dashboard                     | see PRD 9.10                                                                                                               | P3    | Planned         |
| Reports                       | see PRD 9.11                                                                                                               | P4    | Planned         |

`/health` is a P0 addition that is not in PRD section 9. The invitation endpoints are P1 additions (FR-03 requires "accept
invitations" and invitation management, but PRD section 9 does not list them).

### `GET /health` (public)

```json
{
  "success": true,
  "message": "API is healthy",
  "data": {
    "status": "ok",
    "database": "up",
    "uptime_seconds": 12,
    "timestamp": "2026-11-21T10:00:00.000Z"
  }
}
```

Returns `503` with `SERVICE_UNAVAILABLE` when PostgreSQL is unreachable.

---

## P1 contracts: authentication, firm, users, invitations

Shared types: `@ca-firm/shared-types` (`CurrentUser`, `Firm`, `FirmProfile`, `FirmSettings`, `FirmUser`, `Invitation`,
`CreatedInvitation`, `InvitationPreview`). Zod schemas: `@ca-firm/validation` (`loginSchema`, `registerSchema`,
`forgotPasswordSchema`, `resetPasswordSchema`, `acceptInvitationSchema`, `updateFirmSchema`, `updateFirmSettingsSchema`,
`listUsersQuerySchema`, `listInvitationsQuerySchema`, `updateUserSchema`, `updateUserRoleSchema`, `updateUserStatusSchema`,
`inviteUserSchema`).
Paths: `@ca-firm/api-contracts` (`endpoints.auth`, `.firms`, `.users`, `.invitations`).

### P1 decisions (apply to every endpoint below)

1. **One firm per user in P1.** A user belongs to exactly one firm (their single membership). Multi-firm switching is out of scope.
2. **Sessions.** Login/register/accept-invitation set the httpOnly `access_token` cookie (JWT: `sub`, `firm_id`, `role`).
   `app.authenticate` must re-check the user's membership in the database on **every** request (exists, `is_active`) and use the
   **database role**, not the role in the token, so deactivation and role changes take effect immediately. Failure = `401 UNAUTHENTICATED`.
3. **Emails** are trimmed and lowercased (schemas do this). **Passwords**: 8-128 chars, at least one letter and one digit; hashed with
   Argon2id (or bcrypt, cost >= 12); never logged or returned.
4. **No user enumeration on public auth endpoints**: login returns the same `401` message for unknown email, wrong password, inactive user;
   forgot-password always returns `200`. Login compares against a dummy hash for unknown users to keep timing similar.
5. **Email delivery is not in P1** (notifications are P5). Reset links and invitation links go through a small `Mailer` interface whose
   P1 implementation only logs the link to the server log in non-production (never in production logs, never in API responses, except
   `invite_url`, which is returned once to the inviting owner). Tests use a capturing mailer.
6. **Tokens** (reset, invitation): 32 random bytes, base64url; only a SHA-256 hash is stored; reset tokens expire in 1 hour and are
   single-use (a successful reset invalidates all other unused tokens of that user); invitation tokens expire in 7 days.
7. **Roles in P1**: exactly one `owner` per firm (the registrant). Ownership cannot be assigned, transferred or removed in P1.
8. **Firm settings** live in `firms.settings` (JSON): `financial_year_start_month` (default 4) and `onboarding_completed` (default false).
9. Not in P1 (parked): login rate limiting (P4), audit-log rows (P4), change-password while logged in, email change, revoking
   already-issued sessions after a password reset (JWTs stay valid until expiry; deactivation is immediate via decision 2).
10. **Free text is control-character safe.** Names (`name`, `firm_name`), `address` and the user `search` query reject control characters
    (NUL and the rest of C0/C1; `address` still allows tab, LF, CR) with `400 VALIDATION_ERROR` and a field error (PostgreSQL cannot store NUL).
    Implemented once in `@ca-firm/validation` (`noControlChars`, `noControlCharsMultiline`).
11. **Order of outcomes: 401, then 403, then 400/415, then 404/409.** Authentication and the role check run in the `onRequest` hook, which
    fires before the body is parsed, so an anonymous caller always gets `401` (never a `400` for malformed JSON or a `415` for another content
    type) and a forbidden role always gets `403`. Where the rule depends on the target (`GET/PATCH /users/:id`: employee/viewer may only use their own id)
    the service checks existence first (another firm's id is `404`), then the own-id rule (`403`). Owner-only endpoints answer a non-owner with `403`
    before any lookup, so only the owner sees `404` for another firm's id on those.
12. **Phone** = 10-15 characters of digits, `+`, `-` and a plain space only (no tab, line break or NBSP). **Timezone** = an IANA zone name
    (`Asia/Kolkata`, `UTC`); fixed offsets such as `+05:30` are rejected. Whitespace-only optional firm `email` / `phone` / `address` clear the field.
13. **An empty body with a JSON content type is no body.** `Content-Type: application/json` with an empty or whitespace-only body (curl -H, axios in
    Node) is accepted as "no body": `POST /auth/logout` and `DELETE /invitations/:id` work, while routes that need fields still answer
    `400 VALIDATION_ERROR`. Malformed non-empty JSON is still `400`, an oversized body `413`, and `__proto__` / `constructor` poisoning is rejected.
14. **Secrets in URLs are not logged.** The invitation preview carries its token in the path; the request logger prints it as
    `/api/v1/auth/invitations/[REDACTED]`. Over-long path segments are a `404` in the standard envelope.

Role abbreviations below: **O** owner, **M** manager, **E** employee, **V** viewer, **Anon** unauthenticated.

### Auth

| Endpoint                       | Roles            | Body / params                                        | Success                                                                                           | Errors                                                                                             |
| ------------------------------ | ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /auth/register`          | Anon             | `registerSchema`: `name, email, password, firm_name` | `201`, `data: CurrentUser`, sets cookie                                                           | `400 VALIDATION_ERROR`, `409 CONFLICT` (email already registered; `errors[0].field = "email"`)     |
| `POST /auth/login`             | Anon             | `loginSchema`: `email, password`                     | `200`, `data: CurrentUser`, sets cookie, updates `last_login_at`                                  | `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED` ("Invalid email or password")                        |
| `POST /auth/logout`            | any (idempotent) | none                                                 | `200`, `data: null`, clears cookie                                                                | none (works with or without a valid session)                                                       |
| `GET /auth/me`                 | O M E V          | none                                                 | `200`, `data: CurrentUser`                                                                        | `401 UNAUTHENTICATED`                                                                              |
| `POST /auth/forgot-password`   | Anon             | `forgotPasswordSchema`: `email`                      | `200`, `data: null`, always the same message ("If an account exists, a reset link has been sent") | `400 VALIDATION_ERROR` (malformed email only)                                                      |
| `POST /auth/reset-password`    | Anon             | `resetPasswordSchema`: `token, password`             | `200`, `data: null` (does not log the user in)                                                    | `400 VALIDATION_ERROR`, `400 BAD_REQUEST` ("Reset link is invalid or has expired")                 |
| `GET /auth/invitations/:token` | Anon             | path `token`                                         | `200`, `data: InvitationPreview`                                                                  | `404 NOT_FOUND` (unknown / expired / revoked / already accepted; one generic message)              |
| `POST /auth/accept-invitation` | Anon             | `acceptInvitationSchema`: `token, name, password`    | `201`, `data: CurrentUser`, sets cookie                                                           | `400 VALIDATION_ERROR`, `404 NOT_FOUND` (invalid token), `409 CONFLICT` (email already registered) |

`register` is a single transaction: user + firm (defaults `timezone: Asia/Kolkata`, settings `{ financial_year_start_month: 4, onboarding_completed: false }`)

- owner membership. `accept-invitation` is a single transaction (the invitation row is locked, so two simultaneous accepts of one token give one `201` and one `404`):
  user + membership with the invited role + invitation marked `accepted` (`accepted_at`). The invited role is never `owner`.
  `CurrentUser.firm.onboarding_completed` is derived from firm settings.

```json
// POST /auth/login  request
{ "email": "owner@example.com", "password": "Sample-pass-1" }
// 200 response
{ "success": true, "message": "Login successful",
  "data": { "id": "…", "name": "Asha Rao", "email": "owner@example.com", "role": "owner",
            "firm": { "id": "…", "name": "Demo CA Associates", "timezone": "Asia/Kolkata", "onboarding_completed": false } } }
// 401 response
{ "success": false, "message": "Invalid email or password", "code": "UNAUTHENTICATED", "errors": [] }
```

### Firm

| Endpoint                        | Roles   | Body                                                                                                                             | Success                     | Errors                                         |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------- |
| `GET /firms/current`            | O M E V | none                                                                                                                             | `200`, `data: FirmProfile`  | `401`                                          |
| `PATCH /firms/current`          | O       | `updateFirmSchema` (partial: `name, address, email, phone, timezone`; at least one field; empty string clears an optional field) | `200`, `data: FirmProfile`  | `400 VALIDATION_ERROR`, `401`, `403 FORBIDDEN` |
| `GET /firms/current/settings`   | O M E V | none                                                                                                                             | `200`, `data: FirmSettings` | `401`                                          |
| `PATCH /firms/current/settings` | O       | `updateFirmSettingsSchema` (partial: `financial_year_start_month` 1-12, `onboarding_completed`)                                  | `200`, `data: FirmSettings` | `400`, `401`, `403`                            |

The firm is always `firmIdOf(request)`; there is no firm id in any path, body or query. Unknown body keys (including `id`, `firm_id`,
`settings`, `created_at`) are stripped and ignored; a body with no recognised field is `400 VALIDATION_ERROR`. Authentication and the
role check run **before** body validation, so an anonymous or forbidden caller gets `401` / `403`, never a `400`.

Behaviour (implemented and tested in `apps/api/tests/firms.test.ts`):

- **Profile PATCH** changes only the provided fields. `name` is required when sent (1-200 chars, no control characters).
  `address` (max 500, newlines and tabs allowed), `email` (lowercased) and `phone` (10-15 of digits, `+`, `-`, space) are cleared
  by sending `""` (or whitespace) and are then returned as `null`. `timezone` must be an IANA zone (`Asia/Kolkata`, `UTC`, ...).
  Field errors name the field: `name`, `email`, `phone`, `address`, `timezone`.
- **Settings** live in `firms.settings` JSON. A missing or malformed key reads as its default (`financial_year_start_month: 4`,
  `onboarding_completed: false`), so older rows work. **Settings PATCH merges only the provided keys** (in one locked transaction, so
  concurrent PATCHes of different keys cannot overwrite each other) and never removes unknown stored keys. Unknown keys are not
  returned by GET.
- **`onboarding_completed` is true-only.** `{ "onboarding_completed": true }` is accepted (idempotent); `false` is
  `400 VALIDATION_ERROR` with `errors: [{ "field": "onboarding_completed", ... }]` and nothing in that request is applied. This is
  enforced in the service, so the shared `updateFirmSettingsSchema` still types the field as `boolean`.
- `CurrentUser.firm` (`/auth/me`, login) reads the same row, so `name`, `timezone` and `onboarding_completed` are consistent with
  these endpoints on the very next request.

### Users

| Endpoint                  | Roles                                           | Body / query                                                                                                                        | Success                                                                                                   | Errors                                                                                                                        |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /users`              | O M                                             | `listUsersQuerySchema`: `page=1, limit=20 (max 100), search (name/email contains, case-insensitive), role, status=active\|inactive` | `200`, `data: FirmUser[]`, `meta`                                                                         | `400`, `401`, `403`                                                                                                           |
| `POST /users/invite`      | O                                               | `inviteUserSchema`: `email, role` (`manager\|employee\|viewer`)                                                                     | `201`, `data: CreatedInvitation` (`invite_url` = `${FRONTEND_URL}/accept-invitation?token=…`, shown once) | `400`, `401`, `403`, `409 CONFLICT` (email is already a member of this firm, or a pending unexpired invitation exists for it) |
| `GET /users/:id`          | O M any user of the firm; E V only their own id | none                                                                                                                                | `200`, `data: FirmUser`                                                                                   | `401`, `403` (E/V asking for someone else), `404` (not in this firm)                                                          |
| `PATCH /users/:id`        | O any user of the firm; M E V only their own id | `updateUserSchema`: `name`                                                                                                          | `200`, `data: FirmUser`                                                                                   | `400`, `401`, `403`, `404`                                                                                                    |
| `PATCH /users/:id/role`   | O                                               | `updateUserRoleSchema`: `role` (never `owner`)                                                                                      | `200`, `data: FirmUser`                                                                                   | `400`, `401`, `403` (target is the owner or is yourself), `404`                                                               |
| `PATCH /users/:id/status` | O                                               | `updateUserStatusSchema`: `is_active`                                                                                               | `200`, `data: FirmUser`                                                                                   | `400`, `401`, `403` (target is the owner or is yourself), `404`                                                               |

`id` is the **user** id. A user id belonging to another firm (or a malformed id) is `404 NOT_FOUND` for every role that reaches the lookup (never a leak;
see decision 11 for owner-only routes). `search` matches `%` and `_` literally. List default sort:
`name` ascending, then `created_at`. `FirmUser.last_login_at` is `null` until first login.

### Invitations (addition)

| Endpoint                  | Roles | Query / params                                                           | Success                                      | Errors                                                                   |
| ------------------------- | ----- | ------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /invitations`        | O     | `page=1, limit=20 (max 100), status=pending\|accepted\|revoked\|expired` | `200`, `data: Invitation[]`, `meta`          | `400`, `401`, `403`                                                      |
| `DELETE /invitations/:id` | O     | path `id`                                                                | `200`, `data: Invitation` (status `revoked`) | `401`, `403`, `404` (other firm / unknown), `409 CONFLICT` (not pending) |

`Invitation.status` is derived: a `pending` row past `expires_at` is reported (and filtered) as `expired`. Default sort `created_at` descending.
The raw token is never returned by any list or detail endpoint. `POST /users/invite` runs in one transaction that locks the firm row, so two
simultaneous invites of one email give exactly one `201` and one `409`; a pending invitation past `expires_at` is marked `expired` and does not
block a new invite. The link is also handed to the `Mailer` (dev: logged only outside production). `DELETE` revokes only a pending, unexpired
invitation (`409` for accepted, revoked or expired).

```json
// POST /users/invite  request
{ "email": "staff@example.com", "role": "employee" }
// 201 response
{ "success": true, "message": "Invitation created",
  "data": { "id": "…", "email": "staff@example.com", "role": "employee", "status": "pending",
            "expires_at": "2026-11-28T10:00:00.000Z", "created_at": "2026-11-21T10:00:00.000Z",
            "invited_by": { "id": "…", "name": "Asha Rao" },
            "invite_url": "http://localhost:3000/accept-invitation?token=…" } }
// 403 response (manager calls it)
{ "success": false, "message": "You do not have permission to perform this action", "code": "FORBIDDEN", "errors": [] }
```

### Frontend pages (routes) for P1

`/login`, `/register`, `/forgot-password`, `/reset-password?token=`, `/accept-invitation?token=`, `/onboarding` (owner, shown while
`firm.onboarding_completed` is false), `/settings` (firm profile + financial-year setting, owner only), `/profile` (own name, read-only
email/role), `/employees` (team list, invite dialog, role/status actions, pending invitations; owner and manager can see, only owner acts).

## Adding an endpoint (checklist)

1. Agree the contract (path, method, body, query, response, errors, permissions) and add it to this file.
2. Add the path to `packages/api-contracts` and any shared types or Zod schemas to `packages/shared-types` / `packages/validation`.
3. Backend: route with a Zod `schema` (tags, summary, response envelopes) under `apps/api/src/modules/<module>/`,
   guarded by `onRequest: [app.authenticate, requireRole(...)]` (before body parsing: 401, 403, then 400), with every query scoped by `firmIdOf(request)`.
4. Mark the row **Done** here once implemented and tested.
