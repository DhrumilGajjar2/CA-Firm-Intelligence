# Database Schema

Source of truth: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma). Initial migration:
`apps/api/prisma/migrations/20261121000000_init`. PostgreSQL via Prisma 7 (PRD section 8).

## Agreed conventions (P0 decision)

| Topic          | Rule                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Naming         | Tables are plural `snake_case`. Prisma fields are `snake_case` too, so DB column = Prisma field = API JSON key (`client_code`, `firm_id`, `due_date`). No camelCase mapping layer. |
| Keys           | UUID primary keys on every table.                                                                                                                                                  |
| Tenancy        | Every firm-owned record has `firm_id`. Every query must filter by the firm taken from the verified session, never from client input.                                               |
| Uniqueness     | Scoped per firm: `(firm_id, client_code)`, `(firm_id, name)` for services, `(firm_id, invoice_number)`.                                                                            |
| Money          | `Decimal(14,2)`. Never floats.                                                                                                                                                     |
| Time           | Timestamps are `timestamptz` (UTC). Pure calendar dates (`due_date`, `invoice_date`, `work_date`) use `date`. Display in the firm's timezone.                                      |
| Deletion       | Archive (`archived_at`) instead of deleting clients and services.                                                                                                                  |
| Derived values | Invoice paid / partially paid / overdue is computed from allocations and `due_date`, never stored. Overdue excludes completed engagements.                                         |
| Enums          | Lowercase snake_case values, e.g. `in_progress`, `under_review`.                                                                                                                   |

## Tables

| Table                   | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `firms`                 | Firm profile, timezone, settings                                       |
| `users`                 | Accounts (global unique email, `password_hash` only)                   |
| `firm_members`          | User-to-firm link with `role` and `is_active`                          |
| `invitations`           | Pending employee invites (token stored hashed)                         |
| `password_reset_tokens` | Password reset (token stored hashed). Added in P0, required by FR-01   |
| `clients`               | Firm clients                                                           |
| `services`              | Firm-configurable service categories                                   |
| `engagements`           | Client + service assignments with status, priority, due date, assignee |
| `work_logs`             | Employee hours per engagement                                          |
| `invoices`              | Invoice records                                                        |
| `payments`              | Payment records                                                        |
| `payment_allocations`   | Payment-to-invoice allocation (`UNIQUE(payment_id, invoice_id)`)       |
| `import_jobs`           | Uploaded import files and processing state                             |
| `import_rows`           | Per-row validation state for an import                                 |
| `audit_logs`            | Activity history                                                       |
| `subscriptions`         | SaaS plan state (one per firm)                                         |

## Working with migrations

```bash
npm run db:up        # start Postgres + Redis (Docker)
npm run db:migrate   # apply migrations / create a new one after editing schema.prisma
npm run db:seed      # sample data only (never real client data)
```

Schema changes always go through a migration. Do not edit an applied migration.

## Invitation rules (P1, no migration)

`invitations.token_hash` (SHA-256 of a 32-byte base64url token) is unique; the raw token is never stored. `status` is `pending`, `accepted`,
`revoked` or `expired`; a `pending` row past `expires_at` is reported as `expired`, and is marked `expired` when the same email is invited again.
"One pending invitation per (firm, email)" is enforced in the invite transaction, which locks the firm row (`SELECT ... FOR UPDATE`), rather than
by a partial unique index, so no schema migration was needed. Accepting locks the invitation row and creates the `users` row, the `firm_members`
row (invited role, never `owner`) and sets `accepted_at` in one transaction.
