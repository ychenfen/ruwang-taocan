# Agent instructions (scope: this directory and subdirectories)

## Scope and layout
- This AGENTS.md applies to: repo root (`./`) and below.
- Current state: scaffolded backend + commission engine; this file defines architecture + domain invariants.
- Recommended high-level layout (create when you pick a tech stack):
  - `backend/` API, DB, scheduled jobs, commission engine
  - `admin-web/` Admin console UI (管理员)
  - `agent-web/` Agent portal UI (代理)
  - `shared/` Shared types/schemas (DTOs), validation, test fixtures
  - `infra/` Deployment, Docker/compose, CI
  - `docs/` Specs/ADRs/runbooks (see links below)

## Modules / subprojects

| Module | Type | Path | What it owns | How to run | Tests | Docs | AGENTS |
|--------|------|------|--------------|------------|-------|------|--------|
| backend | fastify | `backend/` | API, DB migrations, jobs | `npm run dev:backend` | (todo) | `docs/` | `backend/AGENTS.md` |
| commission-engine | typescript-lib | `shared/commission-engine/` | Commission calculation logic + tests | (n/a) | `npm test` | `docs/commission.md`, `docs/settlement-engine.md` | `shared/commission-engine/AGENTS.md` |

## Specs (read-first)
- Development plan: `docs/PLAN.md`
- Progress tracker: `docs/PROGRESS.md`
- Product requirements: `docs/PRD.md`
- Commission rules: `docs/commission.md`
- Settlement engine design: `docs/settlement-engine.md`
- Data model (DB tables + constraints): `docs/data-model.md`
- ADRs (decision records): `docs/adr/`

## Product summary (what we are building)
- A back-office ledger system with two roles:
  - Admin (管理员): configure org/team, agent levels, plans/policies, cards, and run/approve settlements.
  - Agent (代理, hierarchical): see own cards + downline (一级/二级) + team performance.
- The core complexity is periodic commission settlement with a defined algorithm and reproducible outputs.

## Settled rules (confirmed)
- Schedule: auto settlement runs on the 5th of each month for the previous month’s commissions.
- Support period: fixed 11 months (all levels same); activation month is month 1 but not commissioned; commission months in support are month 2..11.
- Stable period: valid month count is configured per agent level; after expiry the card stops earning commissions.
- Upline commission: differential commission up to 2 levels (direct upline + 2nd upline) with no overlap; same level => no diff.
- Eligibility: if any abnormal status event occurs within the month, that month earns 0 commission (even if abnormal on the last day).
- Amount: keep 2 decimals by truncation (no rounding).

## Domain model (source-of-truth entities)
Keep these concepts explicit in code and DB schema. Prefer stable IDs over names.
- User / Identity
  - Admin user and Agent user are both identities; authorization is by role + scope.
- Team (团队)
  - Team label/name is manageable; must support team membership management (add/remove members).
  - Team membership changes must be auditable (who, when, before/after).
- Agent hierarchy (代理分级/上下级)
  - An agent can have an upline agent; constrain against cycles.
  - Queries needed: downline level-1, downline level-2, and totals by subtree.
- Card (网卡)
  - Has join/activation date, plan, status (online/paused/left/abnormal...), owner agent, and team association.
  - Card status drives commission eligibility; do not infer from UI-only fields.
- Plan & Policy (套餐/政策)
  - Plan: name, monthly rent, company price/cost, etc.
  - Policy: commission rules and ratios; must be versioned (see "Policy versioning").
- Agent Level (星级/等级)
  - Level definitions include: support period length, stable period behavior, ratios by period, and settlement period rules.

## Commission engine (non-negotiable invariants)
When you implement or modify the algorithm, preserve these invariants. Add tests for each.
- Reproducible: same inputs + same policy versions + same run month => identical results.
- Idempotent: re-running settlement for the same month must not double-book entries.
- Auditable: every payout/withholding must be explainable via line items.
- Non-destructive: never delete settled records; use adjustments (reversal + new entry) if corrections are needed.

### Policy versioning (critical)
- Never hardcode commission ratios directly in business logic without an effective date/version.
- Store: policy version, effective date range, and settlement parameters used by a run.
- A commission run must record:
  - run month (e.g., 2026-02), timezone, policy versions, operator, timestamp, and status (draft/approved/posted).

### Settlement expectations (from product rules)
The product text implies rules like:
- New card with "normal/online" status starts earning commission from the next month.
- Support period (扶持期) and stable period (稳定期) depend on join date + agent level.
- Cards in paused/left/abnormal states do not earn commission.
- Team commission is based on level-difference (差价) rather than simple stacking; upline earnings depend on downline level and ratios.

Do not assume missing details. When the spec is ambiguous, implement explicit config fields and write an ADR in `docs/`.

## Cross-domain workflows (how modules connect)
- Auth & RBAC:
  - Admin pages: full access; Agent pages: restricted to self + downline scope.
  - Every API endpoint must declare required role + scope checks.
- Admin config -> commission:
  - Admin edits level/policy/plan => creates new version => future runs reference it.
  - Commission run produces a report (line items) and (optionally) posts ledger entries.
- Data ownership:
  - Backend owns truth; UIs are consumers. Do not put business rules in the frontend.

## Reporting requirements (minimal)
- Per-agent commission breakdown for a month:
  - card list, join date, plan, monthly rent, status, period (support/stable), ratio, amount, totals.
- Ability to explain "why this amount" for any line item (policy version + inputs).

## Testing expectations (global)
- Commission algorithm must have:
  - Unit tests with small fixtures (edge cases: month boundaries, status changes, level change mid-period).
  - Golden-file tests for a representative dataset (to catch accidental changes).
  - Deterministic rounding rules (define scale + rounding mode; test it).

## Do not
- Do not mutate or delete posted settlement data. Use adjustments.
- Do not allow hierarchy cycles or ambiguous ownership (a card must have exactly one current owner).
- Do not bury domain logic in UI; keep it in backend + shared schemas.
- Do not add "one-off" manual fixes without making them auditable and repeatable.

## Next: add module AGENTS.md (once modules exist)
- After you create `backend/`, `admin-web/`, `agent-web/`, add `AGENTS.md` inside each with:
  - exact run/test/build commands
  - module-specific conventions (ORM, migrations, API schema, UI routing, etc.)
