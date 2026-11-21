---
name: run-phase
description: Orchestrate one full development phase (P1-P5) of CA Firm Intelligence per docs/PHASES.md - contract first, backend and frontend agents, QA gate, exit-criteria verification. Use when the user says "run phase P1", "start P2", or asks to build a phase end to end.
argument-hint: <P1|P2|P3|P4|P5> [optional focus, e.g. "auth only"]
---

# Run a phase

You are the **orchestrator** (main session). Subagents cannot launch other subagents, so you coordinate `dhrumil-backend`, `dhrumil-frontend` and `qa-engineer`
through the Agent tool. They start with **no memory of this conversation**: every prompt you send must be self-contained (phase, exact task list, contract, files to read, rules,
what to report). Argument: `$ARGUMENTS` (phase id, optionally a focus). If no phase is given, ask which one.

## 0. Preconditions (stop and ask the human if any fail)

- The previous phase's exit criteria are verified (`docs/PHASES.md` status table). P0 counts as Done.
- Phase-specific human decisions: **P5** needs the payment-gateway choice, pricing and launch approval first. Never invent them.
- Working tree state: run `git status`. If there are uncommitted changes unrelated to the phase, tell the human before starting.
- Branches: if `develop` does not exist, say so and ask whether to create it from `main`. Agents work on `feature/backend-<topic>` and `feature/frontend-<topic>`.
  Never push, merge to `main`, or open PRs yourself unless the human explicitly says to.

## 1. Plan

Read `docs/PHASES.md` (the phase section), `docs/QA_TEST_PLAN.md` (gate), `docs/API_SPECIFICATION.md`. Break the phase into **vertical slices** (for example P1: register+login+me, then firm, then invitations+users).
Show the human a short plan: slices, endpoints per slice, which agent does what, risks. Proceed unless the human objects (they may have given a focus).

## 2. Per slice, run the loop

1. **Contract** - follow the `/api-contract` skill for every endpoint in the slice. Result: `docs/API_SPECIFICATION.md` + shared packages updated, status `Contract agreed`.
2. **Backend** - delegate to `dhrumil-backend` (subagent_type `dhrumil-backend`) with: phase, slice, endpoint list with contract location, tenant/permission rules, required tests, and "report shared-package changes".
3. **Frontend** - delegate to `dhrumil-frontend` with: phase, slice, screens, the contract, which endpoints are already Done vs contract-only (mock until Done), and "report backend requests".
   Run backend and frontend **in parallel** (one message, two Agent calls) when the frontend can build against the contract; otherwise backend first. They touch different directories; if both need a shared package, run them sequentially.
4. **Integrate** - when both are done: re-check the contract vs implementation, remove mocks, confirm the frontend uses real endpoints, run `npm run typecheck`, `npm run lint:web`, `npm run test:api`, `npm run build:web`, `npm run build:api` yourself.
5. **QA** - delegate to `qa-engineer` (the `/phase-qa` skill describes the brief) for the slice. Route each bug to the owning role agent (`dhrumil-backend` or `dhrumil-frontend`) with the repro; re-run QA on the fix. Loop until no Critical/High bugs and all tenant/permission tests pass.

## 3. Phase exit

- Verify **every exit criterion** in `docs/PHASES.md` with evidence (test output, request/response, build result). Not-verifiable items are listed as such, never ticked.
- Update the status table in `docs/PHASES.md`, endpoint statuses in `docs/API_SPECIFICATION.md`, the gate section in `docs/QA_TEST_PLAN.md`.
- Make sure no dev servers are left running (ports 3000 and 5000).
- Commit only if the human asked, using conventional commits per area.

## 4. Report to the human (short)

Phase, slices completed, exit-criteria table (criterion, evidence, status), bugs open, decisions needed, what was not verified, branches and commits, and the next phase's preconditions.
Be honest about gaps; do not claim a phase is complete while any criterion is unmet.

## Guardrails

- Do not expand scope beyond the phase list; park ideas in the report.
- Do not run destructive DB or git operations (reset, force-push, drop, migrate reset) without explicit human approval.
- Real client data never enters the repo or tests. Secrets are never printed.
- If an agent reports it is blocked, resolve the question (or ask the human) rather than letting it guess.
