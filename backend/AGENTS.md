# Agent instructions (scope: this directory and subdirectories)

## Scope and layout
- This AGENTS.md applies to: `backend/` and below.
- Key paths:
  - `src/server.ts`: Fastify server entrypoint
  - `src/config.ts`: env validation
  - `migrations/`: SQL migrations (applied by `scripts/migrate.ts`)
  - `scripts/migrate.ts`: migration runner

## Commands
- Install (from repo root): `npm install`
- Dev server (from repo root): `npm run dev:backend`
- Migrate (from repo root):
  - `DATABASE_URL=... npm run migrate`

## DB conventions
- PostgreSQL is the source of truth.
- Use SQL migrations for schema changes (create a new `migrations/NNN_*.sql` file; never edit applied migrations).
- Ensure idempotency via:
  - unique indexes on settlement runs/items
  - DRAFT vs POSTED behavior (POSTED must be immutable; adjustments only)

## Job conventions
- Monthly auto settlement: every month on day 5 (timezone `Asia/Shanghai`).
- If backend runs multiple instances, add a DB lock before running the job (advisory lock) to avoid double execution.

## Do not
- Do not change posted settlement rows in-place.
- Do not compute money with floating rounding rules that differ from the confirmed truncation rule.

