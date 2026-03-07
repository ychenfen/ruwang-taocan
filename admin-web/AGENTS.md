# Agent instructions (scope: this directory and subdirectories)

## Scope and layout
- This AGENTS.md applies to `admin-web/` and below.
- Tech stack: Next.js App Router + TypeScript + SWR.
- Key paths:
  - `app/(app)/`: authenticated admin pages
  - `app/login/page.tsx`: admin login
  - `components/AuthGate.tsx`: auth guard
  - `components/Sidebar.tsx`: admin navigation
  - `lib/api.ts`: API client with JWT header + error normalization

## Commands
- Install (from repo root): `npm install`
- Dev (from repo root): `npm run dev:admin`
- Typecheck (from repo root): `npm -w admin-web run typecheck`
- Build (from repo root): `npm -w admin-web run build`

## Frontend conventions
- Keep business rules on backend; frontend only renders and submits explicit params.
- Use `apiFetch` for all requests; do not call `fetch` directly in pages.
- Use `SWR` for list/detail loading and `mutate` after write operations.
- All admin pages must be under `app/(app)/` and protected by `AuthGate`.
- Show backend error codes through `humanizeApiError` instead of raw JSON.

## UX conventions
- Preserve existing visual system in `app/globals.css` (glass panel + blue/teal palette).
- Use monospace (`mono` class) for IDs, card numbers, months, and amounts.
- Keep tables scannable: key business columns first, operations on the right.

## Do not
- Do not embed settlement algorithm logic in UI.
- Do not store admin token in cookies for now; use current localStorage key.
- Do not add routes outside `/(app)` for authenticated features.

