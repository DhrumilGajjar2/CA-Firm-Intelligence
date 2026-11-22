# Phase Playbook (P0 to P5)

Source: PRD v1.0 section 11. This is the single list of work the agents execute, phase by phase.
**Statuses:** `Done`, `In progress`, `Open`. The orchestrating session (`/run-phase`) updates the status table
below when a phase's exit criteria are verified. A phase starts only after the previous phase's exit criteria pass.

| Phase | Focus                                  | Status                                 |
| ----- | -------------------------------------- | -------------------------------------- |
| P0    | Planning, discovery and foundation     | Done (a few shared items open, see P0) |
| P1    | Authentication, firm setup, users      | Done (2026-11-22, see P1; uncommitted) |
| P2    | Core business modules and data import  | Open                                   |
| P3    | Finance, dashboard and analytics       | Open                                   |
| P4    | Reporting, security, QA, pilot release | Open                                   |
| P5    | SaaS launch, billing and growth        | Open                                   |

## How every phase runs

1. **Contract first.** Before any feature code, agree each endpoint (`/api-contract` skill): path, method, body, query,
   response, validation, error codes, permissions, pagination. Record it in `docs/API_SPECIFICATION.md`
   and the shared packages.
2. **Backend then frontend, in parallel where possible.** `dhrumil-backend` builds and documents the endpoints.
   `dhrumil-frontend` builds the screens against the agreed contract. The frontend must not call an endpoint
   until its row in `API_SPECIFICATION.md` is **Done** (use the contract plus mocks until then).
3. **QA gate.** `qa-engineer` runs the phase checklist (`/phase-qa`), records results in `docs/QA_TEST_PLAN.md`
   and files bugs back to the owner. Product bugs are fixed by the owning agent, not by QA.
4. **Exit criteria** below are verified with real evidence (test output, a request/response, a screenshot or
   build result), then the status table is updated.

Branches: `feature/frontend-*`, `feature/backend-*`, `bugfix/*` into `develop`; only tested releases reach `main`.
Agents commit with conventional messages on feature branches. **They never push, merge or open PRs;** a human does.

---

## P0: Planning, discovery and project foundation

Objective: scope, technical decisions and workflow in place before the main features.

**Done (2026-11-21):** monorepo and workspaces; frontend skeleton (layout, nav, base components, API client, query
provider); backend skeleton (Fastify, env validation, error and response standards, cookie-JWT auth architecture,
`requireRole`/`firmIdOf`, Swagger); Prisma schema, initial migration, seed; shared packages; API/DB/deployment docs;
`/health` endpoint and the web API-status indicator; tests for health, errors and auth architecture.

**Still open (shared):** create the `develop` branch; issue tracker / sprint board; written coding standards beyond
`CLAUDE.md`; first ER diagram image; initial dashboard wireframes and information-architecture notes (Dhrumil).

**Exit criteria:** both apps run locally; frontend reaches the backend; DB connection works; API docs available;
contracts agreed. (All verified except wireframes and the sprint board.)

---

## P1: Authentication, firm setup and user management

Objective: the complete, secure multi-tenant foundation.

**Frontend (`dhrumil-frontend`):** login page; registration page; forgot-password page; onboarding screens; dashboard shell
(exists); sidebar navigation (exists, now driven by the real role); header and user menu (wire logout); **protected route
handling**; profile settings; user management screens; invitation screens.

**Backend (`dhrumil-backend`):** registration API; login API; logout API; password hashing (Argon2 or bcrypt);
session/token management (cookie-JWT plugin exists); current-user API; firm creation; firm profile APIs; user invitation
APIs; role management; RBAC middleware; tenant isolation; authentication tests.

**APIs:**
`POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/forgot-password`,
`POST /auth/reset-password`, `GET /firms/current`, `PATCH /firms/current`, `GET /firms/current/settings`,
`PATCH /firms/current/settings`, `GET /users`, `POST /users/invite`, `GET /users/:id`, `PATCH /users/:id`,
`PATCH /users/:id/role`, `PATCH /users/:id/status`.

**Exit criteria:** users register and log in; a firm is created during onboarding; owners invite employees; roles are
enforced; users cannot access another firm's information; authentication and authorization tests pass.

**Done (2026-11-22):** all six exit criteria verified with evidence (details, test names and the live status-code run in
`docs/QA_TEST_PLAN.md`, "P1 exit verdict"). Final tree checks: `typecheck`, `lint:web`, `build:web`, `build:api` clean; API tests
786/786 (real PostgreSQL test database); web tests 679/679. Bugs P1-001 to P1-010 are all closed; no bug is open. Added beyond
the PRD API list (flagged in `API_SPECIFICATION.md`): `GET /auth/invitations/:token`, `POST /auth/accept-invitation`, `GET /invitations`,
`DELETE /invitations/:id`.

**Not verified (needs a real browser or later phases):** visual/responsive/keyboard/screen-reader checks; real cross-origin cookie
behaviour and the `Secure` flag over HTTPS; real Next.js navigation and clipboard; email delivery (invitation and reset links are
only logged in non-production, email is P5); login/forgot-password rate limiting (P4); audit-log rows (P4); sessions issued before a password
reset stay valid until their 8 h expiry (stateless JWT, parked); the shared packages ship TypeScript source and must be compiled or bundled
before a Node 20 production deploy (P4 deployment work). The work is **not committed**: it sits uncommitted on branch `PH-1.0.0`; the
`develop` branch still does not exist (P0 shared item).

---

## P2: Core business modules and data import

Objective: the operational foundation.

**Frontend:** client listing; create/edit client forms; client details; service management pages; engagement listing;
engagement create/edit; employee assignment interface; engagement status controls; import upload page; column-mapping
interface; import preview; validation error display; import history page.

**Backend:** client model and APIs; client search and filtering; service model and APIs; engagement model and APIs;
employee assignment logic; engagement status handling; file upload processing; CSV/XLSX parsing; column mapping and
validation; duplicate detection; import preview API; import confirmation API; import error reporting; import history.

**APIs:** `/clients` (GET, POST), `/clients/:id` (GET, PATCH, DELETE = archive), `/clients/:id/engagements`;
`/services` (GET, POST), `/services/:id` (PATCH, DELETE = archive); `/engagements` (GET, POST),
`/engagements/:id` (GET, PATCH), `/engagements/:id/status`, `/engagements/:id/assign`, `/engagements/overdue`;
`POST /imports/upload`, `GET /imports`, `GET /imports/:id`, `POST /imports/:id/preview`, `POST /imports/:id/confirm`,
`GET /imports/:id/errors`, `GET /imports/:id/status`.
Client list query: `?page=1&limit=20&search=&status=&service_id=`.

**Exit criteria:** users create and manage clients; firms configure services; users create and assign engagements;
imports upload and preview; invalid records are clearly identified; confirmed imports create correct records; no
cross-firm data leakage.

---

## P3: Finance, dashboard and analytics

Objective: turn stored data into management information.

**Frontend:** invoice listing; create invoice; payment recording; outstanding-fee page; dashboard KPI cards; engagement
charts; overdue-work widget; employee workload chart; financial summary charts; client performance table; service-wise
performance table; dashboard filters; date-range selection.

**Backend:** invoice model; payment model; payment allocation logic; outstanding-fee calculations; financial summary
APIs; engagement statistics; overdue engagement calculations; work-log model and APIs; employee workload calculations;
client performance calculations; service performance calculations; dashboard aggregation queries; filtering and pagination.

**APIs:** `/invoices` (GET, POST), `/invoices/:id` (GET, PATCH), `/payments` (GET, POST), `POST /payments/:id/allocate`,
`GET /finance/summary`, `GET /finance/outstanding`, `GET /dashboard/overview`, `/dashboard/engagements`,
`/dashboard/overdue`, `/dashboard/workload`, `/dashboard/finance`, `/dashboard/services`.

**Exit criteria:** invoices and payments recordable; outstanding fees calculate correctly; dashboard metrics match
database records; workload uses actual recorded hours; date and service filters work; the dashboard handles empty data.

---

## P4: Reporting, security, QA and pilot release

Objective: reliable enough for real CA firms to test.

**Frontend:** reporting screens; CSV export controls; advanced filters; empty, error and loading states; responsive
improvements; accessibility improvements; end-to-end frontend tests (Playwright); UI bug fixing; pilot feedback improvements.

**Backend:** reporting APIs; CSV export generation; audit log implementation; import history improvements; permission
audit; database indexes; API rate limiting; secure file handling; backup configuration; API integration tests; error
monitoring (Sentry); production configuration.

**APIs:** `/reports/clients`, `/reports/engagements`, `/reports/workload`, `/reports/finance`, `/reports/services`,
`/reports/export`.

**Shared QA:** authentication, role permission, tenant isolation, client CRUD, engagement workflow, import validation,
financial calculation, dashboard calculation, CSV export and responsive UI tests; security review; backup restoration test.

**Exit criteria:** no known critical security issues; all P0 (priority-level) features pass QA; dashboard values verified;
import works with representative files; deployed to staging; 3-5 firms can test; pilot feedback documented.

---

## P5: SaaS launch, billing and growth

Objective: convert the validated pilot into a commercial product.

**Frontend:** pricing page; subscription selection; billing screens; usage and plan-limit indicators; subscription
management UI; account settings improvements; onboarding improvements; help and support pages; marketing landing page;
product analytics integration.

**Backend:** subscription models; plan and feature-limit logic; payment gateway integration; payment webhook handling;
subscription activation, renewal and cancellation; usage tracking; plan enforcement; email notifications; production
monitoring; backup and recovery checks; deployment automation.

**Shared:** pilot customer onboarding; pricing validation; customer feedback; production bug resolution; documentation;
product demonstrations; customer support workflow; release management.

**Exit criteria:** paid subscriptions can be activated; limits enforced **server-side**; payment webhooks verified
securely; customer onboarding documented; production monitoring active; commercial launch approved.
Human decisions required before P5 (gateway choice, pricing, launch approval): agents stop and ask.
