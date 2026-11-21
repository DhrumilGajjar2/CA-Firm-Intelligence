# QA Test Plan

Maintained by the `qa-engineer` agent. Strategy follows PRD section 15. Results are recorded here per phase gate
(`/phase-qa`). **A test is only "passing" with real output; never mark a row without running it.**

## Test ownership and tools

| Type                           | Owner   | Tool                                           | Location                                   |
| ------------------------------ | ------- | ---------------------------------------------- | ------------------------------------------ |
| Frontend component/integration | Dhrumil | Vitest + React Testing Library                 | `apps/web/tests` (set up in first UI test) |
| Backend unit / API             | Dhrumil | Vitest + Fastify `inject`                      | `apps/api/tests`                           |
| Database and tenant            | Dhrumil | Vitest against a dedicated test database (P1+) | `apps/api/tests`                           |
| End-to-end                     | Shared  | Playwright                                     | `tests/e2e` (introduced in P4)             |
| API manual                     | Shared  | Swagger UI at `/docs` / Postman                | n/a                                        |
| Static                         | Both    | ESLint, Prettier, `tsc`, dependency scanning   | root scripts                               |

Commands: `npm run typecheck`, `npm run lint:web`, `npm run test:api`, `npm run build:web`, `npm run build:api`.

## Critical scenarios (PRD section 15): must hold in every release

| #   | Scenario                                                                           | First tested in | Status                             |
| --- | ---------------------------------------------------------------------------------- | --------------- | ---------------------------------- |
| 1   | A user cannot access another firm's records                                        | P1              | Open                               |
| 2   | An employee cannot view restricted financial data                                  | P3              | Open                               |
| 3   | Invalid import rows do not corrupt valid data                                      | P2              | Open                               |
| 4   | Duplicate import attempts do not create unintended duplicates                      | P2              | Open                               |
| 5   | Payments cannot be allocated beyond available balances without explicit adjustment | P3              | Open                               |
| 6   | Outstanding fee calculations stay correct after partial payments                   | P3              | Open                               |
| 7   | Completed engagements are not counted as overdue                                   | P3              | Open                               |
| 8   | Dashboard values match report values                                               | P4              | Open                               |
| 9   | CSV exports respect user permissions and filters                                   | P4              | Open                               |
| 10  | Expired or unauthorised sessions cannot access protected endpoints                 | P1              | Partial (auth plugin tested in P0) |

## Phase gates

Each gate = the phase's exit criteria (see `docs/PHASES.md`) plus the checks below. Record date, commit, commands run,
and pass/fail evidence under the phase heading.

### P0 gate: Done (2026-11-21)

- `tsc` passes for web and api; web lint passes; 9 backend tests pass (health, error standard, auth architecture).
- `/api/v1/health` returns `database: up` against the local PostgreSQL; `/docs` serves OpenAPI; CORS allows the web origin.
- Not covered: wireframes, sprint board; no frontend tests exist yet.

### P1 gate checklist

- Register creates user + firm + owner membership atomically; duplicate email rejected (409).
- Login sets an httpOnly cookie; logout clears it; `/auth/me` reflects role and firm.
- Passwords are hashed; reset tokens are stored hashed, single-use and expiring; no secrets or passwords in logs or responses.
- Invitations: owner-only, token expiry, accept flow, role assignment; managers cannot grant owner.
- RBAC matrix tested per endpoint (owner / manager / employee / viewer / anonymous).
- Tenant isolation: for every firm-scoped endpoint, user A from firm 1 gets 404 for firm 2's ids and sees none of its rows in lists.
- Frontend: protected routes redirect when logged out; nav matches role; forms validate; loading/error/empty states.

### P2 gate checklist

- Client/service/engagement CRUD, search and filter, archive instead of delete; per-firm unique client codes.
- Import: file size/format validation, mapping, preview, invalid and duplicate rows, partial-failure behaviour, re-import idempotency,
  summary counts equal DB changes; representative messy CSV/XLSX files.
- Engagement status workflow and completion date; overdue excludes completed/cancelled.

### P3 gate checklist

- Financial calculations against hand-computed fixtures (decimals, partial payments, multi-invoice allocation, over-allocation rejected).
- Dashboard numbers equal direct SQL/ORM counts; empty-data states; date and service filters; workload from real work logs.
- Employee cannot reach finance endpoints or data (403) and the UI hides it.

### P4 gate checklist

- Report values equal dashboard values; CSV export respects role and filters; audit logs written for imports, exports, role changes.
- Rate limiting, secure file handling, indexes present, backup restore rehearsed, Sentry wired.
- Playwright E2E for the main flows; responsive and accessibility pass; dependency scan; manual security review of authz.

### P5 gate checklist

- Plan limits enforced server-side; webhook signature verification; idempotent webhook handling; subscription lifecycle states.

## Bug log

| ID  | Phase | Severity | Owner | Summary | Status |
| --- | ----- | -------- | ----- | ------- | ------ |
|     |       |          |       |         |        |
