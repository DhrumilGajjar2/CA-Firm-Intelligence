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

| Area                          | Endpoints (PRD section 9)                                                                                                  | Phase | Status   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----- | -------- |
| System                        | `GET /health`                                                                                                              | P0    | **Done** |
| Auth                          | `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me`, `POST /auth/forgot-password`, `/auth/reset-password` | P1    | Planned  |
| Firms                         | `GET/PATCH /firms/current`, `GET/PATCH /firms/current/settings`                                                            | P1    | Planned  |
| Users                         | `GET /users`, `POST /users/invite`, `GET/PATCH /users/:id`, `PATCH /users/:id/role`, `PATCH /users/:id/status`             | P1    | Planned  |
| Clients                       | CRUD, `GET /clients/:id/engagements`                                                                                       | P2    | Planned  |
| Services                      | `GET/POST /services`, `PATCH/DELETE /services/:id`                                                                         | P2    | Planned  |
| Engagements                   | CRUD, `/status`, `/assign`, `GET /engagements/overdue`                                                                     | P2    | Planned  |
| Imports                       | upload, list, detail, preview, confirm, errors, status                                                                     | P2    | Planned  |
| Invoices / Payments / Finance | see PRD 9.9                                                                                                                | P3    | Planned  |
| Dashboard                     | see PRD 9.10                                                                                                               | P3    | Planned  |
| Reports                       | see PRD 9.11                                                                                                               | P4    | Planned  |

`/health` is a P0 addition that is not in PRD section 9.

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

## Adding an endpoint (checklist)

1. Agree the contract (path, method, body, query, response, errors, permissions) and add it to this file.
2. Add the path to `packages/api-contracts` and any shared types or Zod schemas to `packages/shared-types` / `packages/validation`.
3. Backend: route with a Zod `schema` (tags, summary, response envelopes) under `apps/api/src/modules/<module>/`,
   guarded by `app.authenticate` and `requireRole(...)`, with every query scoped by `firmIdOf(request)`.
4. Mark the row **Done** here once implemented and tested.
