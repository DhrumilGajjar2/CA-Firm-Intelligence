# CA Firm Intelligence: Product Requirements (condensed from PRD v1.0)

Operations and business-intelligence SaaS for Indian Chartered Accountant (CA) firms. Independent startup,
originally planned for two developers (Dhrumil on frontend, Sampat on backend). **Update:** Sampat is no longer assigned to the backend; **Dhrumil now owns both frontend and backend**.
This file is the working copy of the PRD for the repo and for the AI agents. If it conflicts with the
original PDF, the PDF wins; tell the humans.

## Vision and goals

A cloud, multi-tenant dashboard for small and medium CA firms to see operations, employee workload,
client engagements, fee collection and performance in one place. It works **alongside** existing tools (Excel,
Tally, GST software, ICAI PMS) and starts with manual CSV/XLSX import. Goals: central dashboard, easy spreadsheet
import, client and engagement tracking, workload and hours, invoices/payments/outstanding fees, actionable reports,
secure multi-tenancy, paid subscriptions after demand is validated.

Initial target (assumptions to validate, not limits): firms with 2-15 employees and 50-500 active clients, offering
GST, ITR, TDS, accounting and audit; users are managing partners and proprietors.

## MVP modules (priority = delivery phase)

| Module                                                                          | Phase |
| ------------------------------------------------------------------------------- | ----- |
| Authentication, Firm Management, User Management                                | P1    |
| Client Management, Service Management, Engagement Management, Import Management | P2    |
| Fee Management (invoices, payments, outstanding), Dashboard, Workload Analytics | P3    |
| Reporting (filters, CSV export), Audit Logs                                     | P4    |
| Subscription Management                                                         | P5    |

## Out of scope for the first release

GST/ITR filing, tax calculation engines, full accounting ledger, automatic government portal integrations,
AI tax advice, full document management, complex OCR/invoice extraction, automated WhatsApp, mobile apps.
Do not build these. Do not introduce AI or expensive integrations prematurely.

## Roles and permissions

| Role            | Access                                                            |
| --------------- | ----------------------------------------------------------------- |
| Owner / Partner | Full firm access: users, reports, settings, financial information |
| Manager         | Manage clients, engagements, staff, permitted reports             |
| Employee        | View assigned engagements and permitted workload information      |
| Viewer          | Read-only access to explicitly permitted information              |

Rules: every user belongs to a firm; a user must **never** access another firm's records; owners invite and
deactivate users; managers cannot change ownership or subscription settings unless explicitly permitted;
employees cannot access restricted financial information; **the backend enforces permissions independently
of the frontend**.

## Functional requirements

- **FR-01 Authentication:** register, login/logout, password hashing, password reset, session/token management,
  protected routes, secure cookie/token handling.
- **FR-02 Firm management:** create a firm at onboarding (name, address, contact, timezone), associate users,
  owners update settings, enforce tenant isolation.
- **FR-03 User management:** invite employees, assign roles, accept invitations, activate/deactivate, view team.
- **FR-04 Client management:** create, update, archive, search and filter, client codes and service
  relationships, import from CSV/XLSX.
- **FR-05 Service management:** firm-configurable service categories (GST Compliance, Income Tax Return,
  Tax Audit, Accounting, TDS Compliance, Company Compliance, Other Professional Services).
- **FR-06 Engagement management:** create, assign client/service/employee, due date, priority, status
  (Not Started, In Progress, Under Review, Completed, On Hold, Cancelled), completion date, overdue view.
- **FR-07 Import management:** upload CSV/XLSX, validate size/format, preview, map columns, identify invalid and
  duplicate rows, review errors, process valid rows, summary, history.
  Flow: upload > file validation > column mapping > preview > row validation > user confirmation > import > summary.
- **FR-08 Fee management:** record invoices and payments, allocate payments to invoices, outstanding balances,
  payment and due dates, overdue receivables, export. This is an **operational fee tracker, not an accounting ledger**.
- **FR-09 Dashboard:** active clients; total, completed, open and overdue engagements; fees invoiced, collected,
  outstanding; employee workload; service-wise and client-wise summaries.
- **FR-10 Reports:** client performance, engagement status, employee workload, invoice and collection,
  outstanding fees, service-wise, CSV export.
- **FR-11 Audit logs:** login events where appropriate, important data changes, imports, invitations and role
  changes, exports, administrative actions.

## Non-functional requirements

Security (authn, authz, tenant isolation); dashboard requests aim for under 2 s at realistic pilot data volumes
(measure, do not assume); indexes and pagination; backups and error monitoring; responsive, desktop-first UI;
modular architecture (**modular monolith, no microservices in the MVP**); transactions and validated financial
calculations; minimise personal/financial data collected; uptime monitoring; audit of important admin and
financial changes.

## Architecture principles

1. Frontend talks to the backend only through REST APIs. 2. Backend owns all business logic.
2. PostgreSQL stores structured data. 4. Uploaded files go to private object storage (S3).
3. Large imports run asynchronously when needed (Redis + BullMQ). 6. Every business record belongs to a firm.
4. Every protected endpoint validates authentication and permissions. 8. API responses use one consistent envelope.

## Execution principles

Build only what customer discovery supports; finish P0 before feature work; keep API contracts synchronized;
build the secure multi-tenant foundation before business modules; use sample data in development; **never use
real CA client information without permission and security controls**; test calculations against known expected
values; release small working increments; validate willingness to pay before expanding.
Validation targets: 20-25 customer interviews, 5 prototype testers, 3-5 pilot firms, 3 paying firms.

Project principle: build a useful operational product for CA firms, not merely a collection of dashboards and CRUD APIs.
