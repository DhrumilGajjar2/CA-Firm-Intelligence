# apps/api: Fastify REST API

Owner: **Dhrumil** (backend role). Folder layout follows PRD section 7 and is a modular monolith.

| Path                              | Purpose                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/app.ts`                      | App factory: logging, CORS, Helmet, Swagger, plugins, `/api/v1` routes                                 |
| `src/server.ts`                   | Process entry: loads env, starts the server, graceful shutdown                                         |
| `src/config/env.ts`               | Zod-validated environment                                                                              |
| `src/plugins/`                    | `database` (Prisma), `authentication` (httpOnly-cookie JWT), `permissions` (`requireRole`, `firmIdOf`) |
| `src/middleware/error-handler.ts` | Maps every error to the standard envelope                                                              |
| `src/utils/`                      | `AppError`, response envelope helpers and schemas                                                      |
| `src/modules/<module>/`           | Feature modules: add `*.routes.ts` and register in `app.ts`                                            |
| `prisma/`                         | `schema.prisma`, migrations, `seed.ts`                                                                 |
| `tests/`                          | Vitest + Fastify `inject`; DB-backed suites use `TEST_DATABASE_URL` (see `docs/DEPLOYMENT.md`)         |

## Writing a protected, tenant-safe route

```ts
app.withTypeProvider<ZodTypeProvider>().get(
  "/clients",
  {
    // onRequest runs before body parsing: the order is always 401, 403, then 400/415.
    onRequest: [app.authenticate, requireRole("owner", "manager")],
    schema: {
      tags: ["Clients"],
      response: { 200: successResponseSchema(z.array(clientSchema)) },
    },
  },
  async (request) => {
    const clients = await app.prisma.client.findMany({
      where: { firm_id: firmIdOf(request) },
    });
    return success(clients, "Clients retrieved successfully");
  },
);
```

Throw `AppError.notFound()` / `AppError.forbidden()` etc. instead of crafting error bodies by hand.
See `docs/API_SPECIFICATION.md`, `docs/DATABASE_SCHEMA.md` and `docs/DEPLOYMENT.md`.
