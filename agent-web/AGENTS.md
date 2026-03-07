# Agent instructions (scope: this directory and subdirectories)

## Scope and layout
- This AGENTS.md applies to `agent-web/` and below.
- Tech stack: Next.js App Router + TypeScript + SWR.
- Key paths:
  - `app/(app)/dashboard`: summary
  - `app/(app)/cards`: my cards
  - `app/(app)/team`: team members + team cards
  - `app/(app)/downlines`: level-1/2 downline + masked cards
  - `app/(app)/announcements`: active announcements
  - `app/login/page.tsx`: agent login

## Commands
- Install (from repo root): `npm install`
- Dev (from repo root): `npm run dev:agent`
- Typecheck (from repo root): `npm -w agent-web run typecheck`
- Build (from repo root): `npm -w agent-web run build`

## Frontend conventions
- Use `apiFetch` for all API calls and `SWR` for data loading.
- Authenticated pages must live under `app/(app)/` and be wrapped by `AuthGate`.
- Respect privacy semantics from backend:
  - own cards: full number
  - team/downline cards: masked number where applicable
- Do not compute commissions in frontend; render backend outputs only.

## UX conventions
- Keep current visual language (teal/amber, glass layout) consistent across pages.
- Display key numbers with stable formatting:
  - amounts: 2 decimals
  - diff rates: percentage with 2 decimals
- Explain constraints in-page where relevant (abnormal status no commission, diff to level-2 only).

## Do not
- Do not expose hidden/forbidden data via client-side joins.
- Do not bypass backend scope checks by composing unsupported query params.

