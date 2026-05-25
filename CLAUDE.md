# Claude Code — Bootstrap

You are implementing the **COBE Capacity Planner**. The complete spec is in `SPEC.md`. Read it before doing anything else.

## What you are building
A lightweight capacity planning tool for a digital agency. Weekly granularity, 0.1 FTE resolution, pulls from Productive.io, local-first on Mac (SQLite) with a server mode (Postgres + Google SSO) planned for v1.1.

## Stack (decided, do not re-litigate)
- Next.js 14+ App Router, TypeScript strict
- Prisma + SQLite (local) / Postgres (server)
- NextAuth (Google provider, server mode only)
- Tailwind + shadcn/ui + lucide-react
- Recharts for charts
- Vitest + Playwright

## How to proceed
1. Read `SPEC.md` end-to-end.
2. Load the `productive-api` skill when you reach the Productive integration phase — not before.
3. Follow the phased plan in §11. Ship each phase end-to-end (UI + DB + tests) before starting the next.
4. Before Phase 4 (Productive sync), confirm the open questions in §17 with Goran.
5. Don't skip tests for `/lib/capacity` and `/lib/weeks`. The math is the product.

## What's already decided
- Tech stack (above).
- v1.0 = local-first, no auth. v1.1 = server + Google Workspace SSO restricted to `@cobeisfresh.com`.
- Productive integration is **read-only** in v1.
- Allocations live at seniority level, not person level (rationale in spec §5.3).

## What requires Goran's input
See `SPEC.md` §17 — flag rather than guess.

## Communication
- Goran prefers concise updates. Match length to task.
- When you finish a phase, post a short demo summary + what's next.
- Surprises/decisions → flag explicitly; don't bury them.
