# Agent instructions (scope: this directory and subdirectories)

## Scope and layout
- This AGENTS.md applies to: `shared/commission-engine/` and below.
- Key paths:
  - `src/engine.ts`: settlement computation
  - `src/month.ts`: YearMonth utilities
  - `src/money.ts`: truncation rule (no rounding)
  - `src/engine.test.ts`: golden tests for confirmed rules

## Commands
- Install (from repo root): `npm install`
- Run tests (from repo root): `npm test`
- Watch tests (from repo root): `npm run test:watch`

## Rules implemented here (must not regress)
- Support period: fixed 11 months (commission months 2..11 after activation month).
- Stable period: length comes from owner agent level `stableMonths`.
- Eligibility: if card is abnormal at any time in the month, that month earns 0.
- Differential commission: up to 2 uplines with no overlap.
- Amount: truncate to 2 decimals (no rounding).

