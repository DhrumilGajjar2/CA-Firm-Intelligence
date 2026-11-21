---
name: phase-qa
description: Run the QA gate for a CA Firm Intelligence phase (P1-P5) - delegate to the qa-engineer agent, verify exit criteria and PRD critical scenarios with evidence, record results in docs/QA_TEST_PLAN.md and route bugs to owners. Use when a phase or slice is implemented and needs verification.
argument-hint: <P1|P2|P3|P4|P5> [slice]
---

# Phase QA gate

Phase/slice: `$ARGUMENTS`. If no phase is given, ask.

## 1. Gather context

Read the phase section in `docs/PHASES.md` and its gate checklist in `docs/QA_TEST_PLAN.md`. Run `git log --oneline -10` and `git status` to know what is being tested (record the commit hash).

## 2. Delegate to `qa-engineer`

Send a self-contained brief (it has no memory of this chat): the phase and slice, the exit criteria, the gate checklist items, the endpoints/screens in scope (from `docs/API_SPECIFICATION.md`),
the critical scenarios that apply, the commit under test, how to run things (`CLAUDE.md` commands), and the reporting format (verdict, evidence table, bugs with severity and owner, what was not verified).
Remind it: it writes tests and QA docs only; it never changes product code and never weakens a failing test.

## 3. Handle the result

- **Bugs:** for each, delegate the fix to the owner with the repro: backend bugs to `dhrumil-backend`, frontend bugs to `dhrumil-frontend`. Then re-run `qa-engineer` on the affected checklist items.
- **Critical/High open, or any failing tenant-isolation or permission test:** the verdict is FAIL; the phase cannot exit.
- Independently re-run the headline commands yourself before trusting a PASS: `npm run typecheck`, `npm run lint:web`, `npm run test:api`, `npm run build:web`, `npm run build:api`.
- Ensure no dev servers remain running (ports 3000, 5000).

## 4. Report

A table: exit criterion / checklist item, evidence (test names and counts, command output, request/response), status. Then bugs (ID, severity, owner, status), items not verified (and why), and the verdict.
Update nothing in `docs/PHASES.md` status yourself unless the verdict is PASS and the human asked you to close the phase (`/run-phase` does that).
