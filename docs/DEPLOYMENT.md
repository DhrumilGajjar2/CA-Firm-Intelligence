# Development Setup & Deployment

## Local development

Requirements: Node >= 20.19, Docker (for PostgreSQL and Redis), or your own PostgreSQL 16.

```bash
npm install                                   # installs all workspaces and generates the Prisma client
cp apps/api/.env.example apps/api/.env        # then set a real JWT_SECRET (32+ chars)
cp apps/web/.env.example apps/web/.env.local

npm run db:up                                 # PostgreSQL :5432 + Redis :6379
npm run db:migrate                            # applies prisma/migrations
npm run db:seed                               # optional sample firm and services

npm run dev:api                               # http://localhost:5000  (docs at /docs)
npm run dev:web                               # http://localhost:3000
```

Without Docker, point `DATABASE_URL` in `apps/api/.env` at any PostgreSQL instance.

### Test database (backend tests)

DB-backed API tests (auth, and later tenant isolation and RBAC) run against a **dedicated PostgreSQL database**, never the dev one.

```bash
# one-time: create it (use your own PostgreSQL credentials)
psql -U postgres -c 'CREATE DATABASE "CA_INTELLIGENCE_PORTAL_TEST"'
# add to apps/api/.env (see .env.example); the database name MUST contain "test"
TEST_DATABASE_URL=postgresql://<user>:<password>@localhost:5432/CA_INTELLIGENCE_PORTAL_TEST?schema=public

npm run test:api        # applies migrations to the test DB automatically (prisma migrate deploy), then runs the suite
```

Test helpers (`apps/api/tests/db-helpers.ts`): `makeTestApp()`, `registerOwner()`, `createMember()`, `loginCookie()` and `resetDb()`,
which truncates all tables between tests and refuses to run unless the connected database name contains `test`.
If `TEST_DATABASE_URL` is unset, DB-backed tests are skipped with a warning.

### Demo data

`npm run db:seed` (development only; refuses `NODE_ENV=production`) adds the "Demo CA Associates" firm with four fake users:
`owner@example.com`, `manager@example.com`, `employee@example.com`, `viewer@example.com`, all with the fake dev password `Demo-pass-123`.
In development the "forgot password" link is printed to the API log instead of being emailed (never in production).

### Verify the setup (P0 exit criteria)

- `http://localhost:5000/api/v1/health` returns `"database": "up"`.
- `http://localhost:5000/docs` shows the Swagger UI.
- The web header shows a green **API online** indicator.
- `npm run typecheck`, `npm run lint:web` and `npm run test:api` pass.

## Environment variables

Backend (`apps/api/.env`): see `apps/api/.env.example`. Required: `DATABASE_URL`, `JWT_SECRET`.
The server refuses to start with a clear message if the configuration is invalid (values are never printed).
Frontend (`apps/web/.env.local`): `NEXT_PUBLIC_API_URL` only. Never put secrets in `NEXT_PUBLIC_*` variables.
Never commit `.env` files.

## Environments (PRD section 17)

|                      | Frontend                            | Backend                                     | Database           |
| -------------------- | ----------------------------------- | ------------------------------------------- | ------------------ |
| Development          | `localhost:3000`                    | `localhost:5000`                            | local PostgreSQL   |
| Staging / Production | to be decided in P4 (Vercel or AWS) | to be decided in P4 (AWS Mumbai or managed) | managed PostgreSQL |

Production notes for the backend: set `NODE_ENV=production` (secure cookies, no pretty logs, Swagger off unless
`ENABLE_DOCS=true`), run `npm run prisma:migrate:deploy` for migrations, build with `npm run build:api`
and start with `npm run start --workspace @ca-firm/api`.
