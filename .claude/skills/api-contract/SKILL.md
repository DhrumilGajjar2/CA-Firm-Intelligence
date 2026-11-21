---
name: api-contract
description: Agree and document an API endpoint contract between the frontend and backend roles (both owned by Dhrumil) before any implementation - path, method, body, query, response, validation, errors, permissions, pagination - and update the shared packages. Use before building any new or changed endpoint (PRD section 14).
argument-hint: <endpoint or module, e.g. "POST /auth/register" or "clients">
---

# Agree an API contract (PRD section 14)

Target: `$ARGUMENTS`. Do this **before** backend or frontend implementation so both can proceed in parallel and never guess shapes.

## Steps

1. Read `docs/API_SPECIFICATION.md` (conventions, error codes), the endpoint list for the phase in `docs/PHASES.md`, the DB model in `apps/api/prisma/schema.prisma`, and the FR text in `docs/PRD.md`.
2. For each endpoint, define all ten items:
   1. endpoint path (under `/api/v1`)
   2. HTTP method
   3. request body (snake_case keys)
   4. query parameters (pagination `page`, `limit`; filters)
   5. response structure (`data` shape, `meta` for lists) using the standard envelope
   6. validation rules (lengths, formats, enums; INR amounts as decimal strings or numbers - decide once and state it)
   7. error codes (which of `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, ... and when)
   8. permission requirements per role (owner / manager / employee / viewer) and whether data is firm-scoped
   9. pagination and sorting behaviour (default limit 20, max limit, default sort)
   10. loading/processing behaviour (sync, or async with a status endpoint, e.g. imports)
3. Write it into `docs/API_SPECIFICATION.md`: add or extend the endpoint section with a request example and a response example (success and the main error), and set the status row to **Contract agreed**.
   Statuses used: `Planned` -> `Contract agreed` -> `Done` (implemented and tested; only the backend agent / orchestrator sets Done).
4. Update the shared packages minimally:
   - `packages/api-contracts/src/index.ts`: the path helper.
   - `packages/shared-types/src/index.ts`: response data types and enums.
   - `packages/validation/src/index.ts`: Zod schemas shared by frontend forms and the API.
     The backend reuses the same Zod schemas for request validation where practical.
5. Check consistency: field names match `schema.prisma` (snake_case), enums match the DB enums, money/date formats match `docs/DATABASE_SCHEMA.md`, tenant rules match `CLAUDE.md`.
6. Run `npm run typecheck` so the packages still compile for both apps.
7. Summarise for the human in a table: endpoint, roles, request, response, errors. Call out anything the PRD leaves ambiguous and the decision you took (or ask when it changes product behaviour).

## Rules

- Contracts are additive. A breaking change to an existing **Done** endpoint needs the human's approval and a note in `docs/API_SPECIFICATION.md`.
- Never put `firm_id` in a request body or query for firm-scoped endpoints; it comes from the session.
- Do not design endpoints outside the PRD's list without flagging it as an addition (like `/health`).
