# CA Firm Intelligence

Operations & business-intelligence SaaS for Indian Chartered Accountant firms (PRD v1.0).

| Area               | Owner   | Location     |
| ------------------ | ------- | ------------ |
| Frontend (Next.js) | Dhrumil | `apps/web`   |
| Backend (Fastify)  | Sampat  | `apps/api`   |
| Shared contracts   | Both    | `packages/*` |
| Docs               | Both    | `docs/`      |

## Getting started

Requires Node >= 20.19 and Docker (or your own PostgreSQL 16). Full guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

```bash
npm install
cp apps/api/.env.example apps/api/.env          # set a real JWT_SECRET (32+ chars)
cp apps/web/.env.example apps/web/.env.local

npm run db:up         # PostgreSQL + Redis via Docker
npm run db:migrate    # apply migrations
npm run dev:api       # http://localhost:5000   (Swagger: /docs)
npm run dev:web       # http://localhost:3000
```

## Scripts (run from the repo root)

| Script                    | Purpose                             |
| ------------------------- | ----------------------------------- |
| `dev:web` / `dev:api`     | Start the dev servers               |
| `build:web` / `build:api` | Production builds                   |
| `typecheck`               | TypeScript check for web and api    |
| `lint:web`                | ESLint                              |
| `test:api`                | Backend tests (Vitest)              |
| `db:up` / `db:down`       | Start / stop local Postgres + Redis |
| `db:migrate` / `db:seed`  | Prisma migrations / sample data     |
| `format`                  | Prettier (whole repo)               |

## Shared packages

- `@ca-firm/shared-types`: API envelope, roles, statuses, domain types
- `@ca-firm/validation`: Zod schemas used by forms and the API
- `@ca-firm/api-contracts`: endpoint paths from PRD section 9

Changing a shared package is a contract change: get the other developer's review (PRD sections 13-14).

## Docs

[API specification](docs/API_SPECIFICATION.md) · [Database schema](docs/DATABASE_SCHEMA.md) ·
[Development & deployment](docs/DEPLOYMENT.md)

## Git workflow (PRD section 13)

`main` <- `develop` <- `feature/frontend-*` / `feature/backend-*` / `bugfix/*`.
Never push directly to `main`, never commit `.env` files, use conventional commits (`feat:`, `fix:`, `docs:` ...).
