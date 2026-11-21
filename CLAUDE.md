# CA Firm Intelligence: project guide for Claude

Multi-tenant SaaS for Indian CA firms. Single owner: **Dhrumil**, who is responsible for both the frontend (`apps/web`) and the backend (`apps/api`). Work is split into two role agents for focus and clean boundaries.
Work is done **phase by phase (P0 to P5)** from `docs/PHASES.md`. Requirements: `docs/PRD.md`.

## Read first

| File                        | Use                                                      |
| --------------------------- | -------------------------------------------------------- |
| `docs/PHASES.md`            | What to build in each phase, owners, exit criteria       |
| `docs/PRD.md`               | Requirements, roles, scope limits                        |
| `docs/API_SPECIFICATION.md` | Conventions, error codes, endpoint status (the contract) |
| `docs/DATABASE_SCHEMA.md`   | DB conventions and tables                                |
| `docs/QA_TEST_PLAN.md`      | Critical scenarios, phase gates, bug log                 |
| `docs/DEPLOYMENT.md`        | Local setup and environments                             |

## Agents and skills (`.claude/`)

- Agents: `dhrumil-frontend`, `dhrumil-backend`, `qa-engineer`.
- Skills: `/run-phase <P1..P5>` (orchestrate a whole phase), `/api-contract` (agree an endpoint before coding),
  `/phase-qa <P1..P5>` (QA gate).
- Subagents cannot spawn other subagents. The **main session orchestrates** (`/run-phase`) and delegates to them.
- Subagents start with no conversation memory: every delegation must name the phase, the task list, the contract and the files.

## Repo layout

`apps/web` Next.js 16 (App Router) + shadcn/ui (Base UI) + TanStack Query. `apps/api` Fastify 5 + Prisma 7 + Zod.
`packages/shared-types`, `packages/validation`, `packages/api-contracts` are the shared contracts (a change affects both sides, so the frontend and backend agents cross-check it, and Dhrumil approves).

## Commands (repo root)

`npm run dev:web` · `dev:api` · `typecheck` · `lint:web` · `test:api` · `build:web` · `build:api` · `db:migrate` · `db:seed` · `format`.
Local DB is PostgreSQL named `CA_INTELLIGENCE_PORTAL` configured in the gitignored `apps/api/.env`. Never read secrets out loud or commit them.

## Non-negotiable rules

1. **Tenant isolation:** every business record has `firm_id`; the firm always comes from the verified session (`firmIdOf(request)`), never from client input.
   Another firm's record returns 404.
2. **Server-side authorization:** the backend enforces roles regardless of the UI. Frontend role gating is convenience only.
3. **One response envelope** (`success/message/data/meta` or `success:false/message/code/errors`). Use `AppError`, never hand-craft error bodies.
4. **Contract first:** the frontend does not call an endpoint until it is documented and marked Done in `API_SPECIFICATION.md`.
5. **snake_case** for DB columns, Prisma fields and API JSON. Money is `Decimal`, never float. Schema changes only through migrations.
6. **Scope:** only what the PRD lists for the current phase. No GST/ITR filing, ledger, OCR, WhatsApp, AI, mobile, microservices.
7. **Sample data only.** Never use or invent real client information; seed with obviously fake data.
8. **No secrets** in code, logs, responses, docs or commits. `.env` files are never committed.
9. Do not edit the other role's area without saying so (frontend agent: `apps/web`; backend agent: `apps/api`, `prisma/`).
   Shared packages: edit only as part of a contract change and report it.

## Git

`main` <- `develop` <- `feature/frontend-*` / `feature/backend-*` / `bugfix/*`. Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
Agents commit on feature branches when asked. **Never push, merge to `main`, force-push or open PRs without the human's explicit instruction.**

## Definition of done

Frontend: responsive, reusable components, no hardcoded production data, API integrated, form validation, loading/empty/error states,
permission-aware UI, no console errors, tests pass, `typecheck` + `lint:web` + `build:web` clean.
Backend: validation, migrations, authorization enforced, tenant isolation tested, standard responses, error handling,
tests passing, OpenAPI updated, nothing sensitive logged, `typecheck` + `test:api` + `build:api` clean.
"Done" requires evidence from running these, never an assumption.

## Stack gotchas

- Next.js 16 differs from older versions: check `apps/web/node_modules/next/dist/docs/` before using an unfamiliar API.
- shadcn here is the `base-nova` style on Base UI: triggers use a `render={<.../>}` prop, not `asChild`. The `cn` helper comes from the `cn` package.
- Prisma 7: client generated to `apps/api/src/generated/prisma` (gitignored; created by `npm install`); uses `@prisma/adapter-pg`.
- Do not run `tsx watch` servers and forget them: kill them (a stale server on port 5000 caused a misleading 503 before).
- npm 10.9 crashes on vitest 4/5 peers; keep vitest on 3.x until npm is upgraded.
