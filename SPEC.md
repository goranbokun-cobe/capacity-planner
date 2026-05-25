# COBE Capacity Planner — Build Spec

**Owner:** Goran Bokun (PM/PO, Cobe)
**Target implementer:** Claude Code
**Spec version:** 1.0 (2026-05-22)
**Stack decision:** Next.js (TypeScript) + Prisma + SQLite (local) / PostgreSQL (server) + NextAuth (Google SSO)
**Delivery model:** Local-first in v1.0; multi-user server with Google Workspace SSO in v1.1

---

## 1. Executive Summary

Build a lightweight capacity planning tool for a digital agency (~7 disciplines, multiple seniority tiers). The tool answers one question per week: **"Do we have the people to deliver what's coming, and where are we over/under?"** It is opinionated, low-administration, and built for one primary editor (the PM/PO) with read-only views for stakeholders later.

**Granularity:** Weekly buckets. 0.1 FTE resolution. No hour-level scheduling.

**Inputs:**
1. Sales pipeline deals (probability-weighted demand)
2. Committed (signed) projects
3. Running projects
4. Resource availability (people × role × seniority × capacity)

**Outputs:**
- Overview grid (week × team/role) with utilization %
- Capacity charts (stacked demand vs. supply)
- What-if simulations
- Snapshots / versioning
- Optional weekly reports

**Integrations:** Productive.io (read-only sync of deals, projects, people, bookings, time-off).

---

## 2. Goals & Non-Goals

### Goals
- One PM can keep the plan fresh in **under 15 minutes/week**.
- Show capacity gaps **6–12 weeks out** at minimum, 26 weeks ideal.
- Pull as much as possible from Productive so manual entry is the exception.
- Run on a MacBook with `npm run dev` and zero external dependencies.
- Same codebase deploys to a small server (Fly.io, Render, or self-hosted) with Google SSO restricted to `@cobeisfresh.com`.
- Edit teams, roles, seniority tiers, and capacities **without touching code**.

### Non-Goals (v1)
- Per-day or per-hour scheduling.
- Auto-assigning specific people to specific tasks.
- Replacing Productive as the source of truth for time tracking or invoicing.
- Mobile-first UI (desktop-first; mobile viewing is best-effort).
- Multi-tenant SaaS. Single-org install only.
- Writing back to Productive (read-only in v1; revisit in v2).

---

## 3. Personas

| Persona | Frequency | Needs |
|---|---|---|
| **Goran (primary editor)** | Daily / weekly | Fast data entry, weekly overview, what-if before sales calls |
| **Sales lead** | Weekly | "If this deal closes, who's free?" view |
| **Department leads** (Mobile/FE/BE/DevOps/QA/Design/PM) | Bi-weekly | Their team's load 4–8 weeks out |
| **CEO / Ops** | Monthly | Hiring signals, utilization trends |

v1 ships only the primary editor experience. Read-only role accounts arrive in v1.1 with auth.

---

## 4. Glossary

- **FTE** — Full-Time Equivalent. 1.0 FTE = a person available 100% of a standard work week.
- **Week ID** — ISO 8601 week, format `YYYY-Www` (e.g., `2026-W23`). Weeks always start Monday.
- **Capacity** — Supply side. The FTE a person/role/team can deliver in a given week.
- **Allocation** — Demand side. FTE a project consumes from a person/role/team in a given week.
- **Pipeline deal** — Unsigned opportunity with a probability % and expected start/end.
- **Committed project** — Signed but not yet running, or running with a known end date.
- **Weighted demand** — Pipeline allocation × probability.
- **100% demand** — Pipeline allocation counted at full value (worst-case planning).

---

## 5. Domain Model

### 5.1 Entity overview

```
Team (1) ──< Role (N) ──< SeniorityTier (N) ──< Person (N)
                                                   │
                                                   └──< CapacityOverride (N)  [per-week, per-person]

Project ──< Allocation (N)   [per-week, per-team/role/seniority]
   │
   ├── status: pipeline | committed | running | done | lost
   ├── probability: 0–100 (only meaningful when status=pipeline)
   └── pipelineCalcMode: weighted | full   [per-project override]

PipelineSettings (singleton)
   └── defaultCalcMode, colorThresholds[]

Snapshot ──< (frozen copies of all of the above at a point in time)

ProductiveLink (per entity)
   └── productiveId, lastSyncedAt, syncStatus
```

### 5.2 Tables (Prisma-ish)

```ts
model Team {
  id          String   @id @default(cuid())
  name        String   @unique         // "Mobile", "FE", "BE", "DevOps", "QA", "Design", "PM"
  displayOrder Int     @default(0)
  archivedAt  DateTime?
  roles       Role[]
  createdAt   DateTime @default(now())
}

model Role {
  id          String   @id @default(cuid())
  teamId      String
  team        Team     @relation(fields: [teamId], references: [id])
  name        String                       // "iOS Engineer", "Backend Engineer", etc.
  displayOrder Int     @default(0)
  archivedAt  DateTime?
  seniorities SeniorityTier[]
  @@unique([teamId, name])
}

model SeniorityTier {
  id          String   @id @default(cuid())
  roleId      String
  role        Role     @relation(fields: [roleId], references: [id])
  name        String                       // "Junior", "Medior", "Senior", "Lead"
  level       Int                          // numeric for sorting (1..N)
  defaultCapacity Float @default(1.0)      // FTE per week, default when person added
  archivedAt  DateTime?
  people      Person[]
  @@unique([roleId, name])
}

model Person {
  id            String   @id @default(cuid())
  seniorityId   String
  seniority     SeniorityTier @relation(fields: [seniorityId], references: [id])
  fullName      String
  email         String?  @unique
  baseCapacity  Float    @default(1.0)     // default FTE/week
  startDate     DateTime?
  endDate       DateTime?
  productiveId  String?  @unique
  archivedAt    DateTime?
  overrides     CapacityOverride[]
}

model CapacityOverride {
  id        String   @id @default(cuid())
  personId  String
  person    Person   @relation(fields: [personId], references: [id])
  weekId    String                          // "2026-W23"
  capacity  Float                           // 0.0–1.0 (PTO, parental leave, sick, training)
  reason    String?                         // "PTO", "Parental", "Training", free text
  source    String   @default("manual")    // "manual" | "productive"
  @@unique([personId, weekId])
}

model Project {
  id                 String   @id @default(cuid())
  name               String
  clientName         String?
  status             ProjectStatus           // pipeline | committed | running | done | lost
  probability        Int?                    // 0..100, nullable unless status=pipeline
  pipelineCalcMode   PipelineCalcMode?       // weighted | full | null=inherit settings
  startWeekId        String                  // "2026-W23"
  endWeekId          String
  productiveDealId   String?  @unique
  productiveProjectId String? @unique
  notes              String?
  colorTagOverride   String?                 // optional manual hex override
  archivedAt         DateTime?
  allocations        Allocation[]
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

enum ProjectStatus { pipeline committed running done lost }
enum PipelineCalcMode { weighted full }

model Allocation {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id])
  weekId    String
  // Demand is expressed at the seniority level — the most precise we go.
  // Roll-ups to role/team are computed.
  seniorityId String
  seniority   SeniorityTier @relation(fields: [seniorityId], references: [id])
  fte       Float                            // 0.0–N, 0.1 increments enforced in UI
  notes     String?
  @@unique([projectId, weekId, seniorityId])
}

model PipelineSettings {
  id              Int     @id @default(1)   // singleton
  defaultCalcMode PipelineCalcMode @default(weighted)
  colorBands      Json    // [{minPct: 0, maxPct: 24, color: "#..."}, ...]
}

model Snapshot {
  id          String   @id @default(cuid())
  label       String                            // "Pre Q3 planning, 2026-05-15"
  takenAt     DateTime @default(now())
  takenBy     String?                           // user email in v1.1
  payload     Json                              // full state dump
  notes       String?
}

model SyncJob {
  id         String   @id @default(cuid())
  source     String                             // "productive"
  startedAt  DateTime @default(now())
  finishedAt DateTime?
  status     String                             // "running" | "ok" | "failed"
  message    String?
  stats      Json?                              // counts per entity
}
```

### 5.3 Why allocations live at seniority level, not person level

Allocations against **specific people** create administrative overhead (the user's #1 stated pain). Instead:
- **Demand** is at `(project, week, seniorityTier)`.
- **Supply** rolls up from people → seniority → role → team.
- The grid shows utilization at whichever axis the user picks.

If a future need emerges to pin a project to a specific person, add a nullable `personId` to `Allocation`.

---

## 6. Calculation Rules

### 6.1 Weekly grain
- All math is keyed on `weekId = ISO YYYY-Www`.
- A person's capacity for week W = `baseCapacity − sum(CapacityOverride.capacity for that week)` if override.source treats override as a *replacement*. Simpler rule: **override fully replaces** baseCapacity when present.
- Time-off, PTO, parental, training, sick → all stored as `CapacityOverride` with `capacity` set to the *remaining* capacity (often 0).

### 6.2 FTE resolution
- UI snaps to 0.1 FTE in all inputs (steppers, sliders).
- DB stores `Float`. Round display to 1 decimal.

### 6.3 Pipeline demand math

For a pipeline project P with probability `p` (0–100) and `pipelineCalcMode`:
- `effectiveCalcMode = P.pipelineCalcMode ?? PipelineSettings.defaultCalcMode`
- If `effectiveCalcMode = full`: demand = allocation.fte (count at 100%)
- If `effectiveCalcMode = weighted`: demand = allocation.fte × (p / 100)

Committed and running projects always count at 100%, regardless of mode.

### 6.4 Utilization
For any (week, axis-bucket) cell:
```
demand   = Σ allocations.fte (with pipeline math applied per project)
supply   = Σ people.effectiveCapacity for that bucket
util %   = demand / supply  (∞ if supply=0 and demand>0)
gap FTE  = supply − demand  (negative = shortfall)
```

### 6.5 Pipeline color coding (default bands)
The default `colorBands` (editable in settings):
| Probability | Color | Meaning |
|---|---|---|
| 0–24% | `#C7C7CC` (cool gray) | Long shot |
| 25–49% | `#A5C8FF` (pale blue) | Possible |
| 50–74% | `#FFD27F` (amber) | Likely |
| 75–99% | `#FF9F70` (orange) | Hot |
| 100% / committed | `#34C759` (green) | Won/committed |
| Running | `#0A84FF` (blue) | In flight |
| Lost / done | gray, struck through | Closed |

Color is applied to:
- Project row in the editor list.
- Cells in the overview grid (background tint, lighter = lower probability).
- Bars in the demand chart (stacked, colored per project status/probability).

### 6.6 Utilization color (cell heatmap)
| Utilization % | Background |
|---|---|
| 0–69% | green tint (under-utilized) |
| 70–89% | neutral (healthy) |
| 90–110% | yellow (tight) |
| > 110% | red (over-committed) |

These thresholds are editable in Settings.

---

## 7. Productive.io Integration (read-only, v1)

**Mode:** Pull-only. Productive remains the source of truth for what it tracks; the planner overlays pipeline what-if on top.

### 7.1 Auth
- Personal API token stored in `.env` (`PRODUCTIVE_API_TOKEN`, `PRODUCTIVE_ORG_ID`).
- See the `productive-api` skill for endpoint reference; the implementing agent should load it.

### 7.2 Entities to sync (priority order)
1. **People** → `Person` (match by email, fall back to `productiveId`).
2. **Time-off** → `CapacityOverride` with `source="productive"`, capacity=0, reason copied from Productive.
3. **Bookings (committed/running)** → optional in v1: when present, can pre-fill `Allocation` for committed/running projects. Behind a feature flag; default OFF in v1 because Productive bookings are typically at person-level and we plan at seniority-level.
4. **Deals (pipeline)** → `Project` with `status=pipeline`, probability from the deal.
5. **Projects (committed/running)** → `Project` with `status=committed` or `running`, matched by `productiveProjectId`.

### 7.3 Sync cadence
- Manual "Sync now" button on the dashboard (primary path in v1).
- Optional nightly cron via a `/api/cron/sync` route, protected by a shared secret.

### 7.4 Conflict rules
- Productive-sourced fields (status, dates, probability) are **suggested** on sync; the planner shows a diff banner. User clicks "Apply" to accept.
- Time-off overrides with `source="productive"` are auto-applied (no diff prompt) because they're operationally important.
- Manual edits to a Productive-linked entity flag it as "drifted" until the next sync resolves.

### 7.5 What we explicitly do NOT sync in v1
- Tasks / sub-tasks.
- Invoices, budgets, financials.
- Time entries (we use bookings or our own allocations as demand).

---

## 8. UI / UX Specification

### 8.1 Information architecture

```
/                       → Overview (week grid + chart)
/projects               → Project list (pipeline / committed / running tabs)
/projects/[id]          → Project editor (allocations grid)
/teams                  → Teams, roles, seniority editor
/people                 → People list + per-person capacity overrides
/whatif                 → What-if mode (clone current state, edit, compare)
/snapshots              → List + restore + diff vs current
/settings               → Pipeline calc default, color bands, util thresholds, Productive sync
/sync                   → Sync status & history
```

### 8.2 Overview (`/`)

**Layout:** Top: filter bar. Middle: stacked bar chart (52-week horizon, demand vs. supply). Bottom: pivot grid.

**Filter bar:**
- Horizon: 12 / 26 / 52 weeks (default 12).
- Start week: defaults to current ISO week, picker for jump-to.
- Axis: Team / Role / Seniority (toggle — drives the row grouping).
- Status filter: pipeline / committed / running checkboxes.
- Pipeline mode override: Default | Force weighted | Force 100% (preview only, doesn't persist).

**Pivot grid:**
- Rows: groups (Team or Role or Seniority depending on axis toggle), with optional expand to drill into children.
- Columns: weeks.
- Cells: show `demand / supply` with util % below; background color from utilization heatmap.
- Hover: tooltip lists contributing projects with their per-cell FTE.
- Click cell → side panel with allocations for that bucket-week.

**Chart:**
- Stacked bars per week, segmented by project status + probability band.
- Line overlay = supply (capacity).
- Click a bar segment → filter the grid to that project.

### 8.3 Project editor

- Header: name, client, status, dates, probability slider, calc mode toggle (Default / Weighted / Full 100%).
- Color preview chip reflecting current calc.
- Allocations grid: rows = seniority tiers (filterable by team/role), columns = weeks within project span. Cells = FTE stepper (0.1 increments).
- "Copy week →" bulk-fill button.
- "Linear ramp" helper: pick start FTE, end FTE, weeks count → fills evenly.

### 8.4 Teams editor
- Drag-to-reorder teams, roles within team, seniority tiers within role.
- Add/edit/archive (soft delete — preserves history).
- Per-seniority `defaultCapacity` field.
- Archived items hidden by default; toggle to show.

### 8.5 People editor
- Table: name, team, role, seniority, base capacity, productive link status.
- Inline edit base capacity.
- Per-person calendar strip showing the next 26 weeks; click a week to add an override.
- Bulk PTO entry (pick weeks, set capacity).

### 8.6 What-if mode (`/whatif`)
- "Start what-if from current" → clones live data into a session-only sandbox (not persisted to main tables until "Save as snapshot").
- Diff badge in the top bar shows # of changes vs. main.
- Side-by-side view: current overview vs. what-if overview.
- Common simulations to surface as one-click presets:
  - "Win the top-3 pipeline deals" (force their probability to 100).
  - "Lose the top-3 pipeline deals" (set to 0 / archive).
  - "Hire 1 Senior BE starting in [week]".
  - "Push project X by N weeks".

### 8.7 Snapshots / versioning
- Manual "Take snapshot" with label and notes (e.g., "Pre Q3 plan, 2026-05-15").
- Auto-snapshot weekly (Monday 06:00 local) if enabled in Settings.
- View past snapshot in read-only mode.
- Diff a snapshot against current: shows added/removed projects, allocation deltas per cell.
- Restore a snapshot (with confirmation; takes a fresh snapshot of current first).

### 8.8 Reports (v1.1 nice-to-have, scaffold in v1)
- Weekly PDF/Markdown export of the current overview + top 5 risks (over-committed weeks).
- Per-team breakdown for department leads.

---

## 9. Authentication & Deployment

### 9.1 Local mode (v1.0)
- `npm run dev` → SQLite file at `./prisma/dev.db`.
- No auth. Single-user assumption.
- Designed to run on the user's Mac with no exposed ports.

### 9.2 Server mode (v1.1)
- Postgres connection string in `DATABASE_URL`.
- `AUTH_MODE=google` enables NextAuth with Google provider.
- Restrict to a domain: `AUTH_ALLOWED_DOMAIN=cobeisfresh.com` (reject any other Google account at sign-in).
- Optional `AUTH_ADMIN_EMAILS=goran.bokun@cobeisfresh.com,...` for write permissions; everyone else read-only.
- Deployable to Fly.io, Render, Railway, or a Cobe-hosted VM with Docker.

### 9.3 Migration path local → server
- Export from SQLite via a built-in `npm run export` command → JSON.
- Import into Postgres via `npm run import path/to/export.json`.
- No data loss assumed.

---

## 10. Tech Stack & Architecture

**Frontend & backend:** Next.js 14+ App Router (React Server Components where appropriate), TypeScript strict mode.
**ORM:** Prisma. Two schemas via env: SQLite for local, Postgres for server.
**Auth:** NextAuth (Auth.js) — disabled in local mode, Google provider in server mode.
**UI:** Tailwind CSS, shadcn/ui components, lucide-react icons.
**Charts:** Recharts (sufficient for stacked bars + lines; lightweight).
**Forms / state:** React Hook Form + Zod. TanStack Query for client cache against the API routes.
**Date math:** `date-fns` with ISO week helpers.
**Testing:** Vitest for unit + Playwright for one critical E2E (load app, sync Productive, view overview).
**Logging:** `pino` to stdout, structured JSON in server mode.
**Productive API client:** thin custom wrapper; load the `productive-api` skill in the implementing agent for endpoint shapes.

### 10.1 Directory layout
```
/app                  → Next.js routes
  /(overview)/page.tsx
  /projects/...
  /teams/...
  /people/...
  /whatif/...
  /snapshots/...
  /settings/...
  /api
    /productive/sync/route.ts
    /snapshots/route.ts
    /cron/sync/route.ts
/lib
  /capacity            → FTE math (pure functions, fully unit-tested)
  /productive          → API client + mappers
  /db                  → Prisma client
  /weeks               → ISO week helpers
/components
  /grid                → pivot grid
  /charts              → recharts wrappers
  /editors             → team/project/person editors
/prisma
  schema.prisma
  migrations/
/test
  /unit
  /e2e
```

### 10.2 Performance budget
- Overview with 52 weeks × 7 teams × ~50 people × ~30 projects should render in **< 200ms** server-time, < 500ms total.
- All FTE math must be pure functions; no DB round-trips inside calculation loops.
- Pre-compute cell values on the server, hydrate the grid on the client.

---

## 11. Phased Delivery Plan

### Phase 0 — Bootstrap (½ day)
- Repo scaffold, Next.js app, Tailwind, Prisma, SQLite, sample seed (the 7 Cobe teams with placeholder roles/seniorities).
- Run `npm run dev` and see a "Hello Capacity" page.

### Phase 1 — Editable foundation (2 days)
- Teams / Roles / Seniority CRUD.
- People CRUD + base capacity.
- Per-week capacity overrides.
- Per-team capacity totals visible somewhere static.

### Phase 2 — Projects + allocations (2 days)
- Project CRUD (pipeline / committed / running).
- Allocation grid per project (seniority × week).
- Pipeline calc mode toggle per project + default in settings.

### Phase 3 — Overview (2 days)
- Pivot grid (team / role / seniority axis toggle).
- Heatmap colors.
- Stacked bar chart.

### Phase 4 — Productive read-only sync (2 days)
- People + time-off sync.
- Deals + projects sync with diff/apply UI.
- Manual "Sync now" button + status page.

### Phase 5 — What-if + snapshots (2 days)
- Snapshot take / restore / diff.
- What-if sandbox mode.

### Phase 6 — Server deployment + Google SSO (1 day)
- Postgres schema parity.
- NextAuth Google provider, domain restriction.
- Dockerfile + Fly.io / Render config.
- Export/import scripts.

**Total estimate:** ~12 working days for one engineer, plus polish.

---

## 12. Acceptance Criteria

A feature is "done" when its row passes:

| Area | Criterion |
|---|---|
| Teams editor | I can add a team, add a role under it, add 3 seniority tiers, archive a role, and the overview reflects all changes within one render. |
| People | I can add a person, set base 0.8 FTE, override week 2026-W27 to 0.0 (PTO) — overview shows the dip. |
| Pipeline math | A 60% deal with 2.0 FTE/wk shows 1.2 demand in weighted mode and 2.0 in 100% mode; per-project override beats the default. |
| Color coding | Pipeline projects render with the correct color band; committed renders green; lost is hidden by default. |
| Overview axis toggle | I can switch Team / Role / Seniority and the rows re-pivot without reloading. |
| Heatmap | Cells > 110% util are red, 90–110% yellow, 70–89% neutral, < 70% green; thresholds editable in settings. |
| Productive sync | After "Sync now", new deals appear as pipeline projects with status, dates, probability filled in; existing items show a diff banner if Productive changed. |
| Time-off | Productive PTO appears as `CapacityOverride` for the right weeks with capacity=0. |
| What-if | I can flip a deal to 100%, see the overview update side-by-side, and discard without affecting main. |
| Snapshots | I take a snapshot, change an allocation, view the diff, and restore — restored state matches the snapshot. |
| Local install | Fresh clone → `npm install && npm run db:push && npm run dev` boots a working app in < 60 seconds (after `npm install`). |
| Server mode | With `AUTH_MODE=google` and `AUTH_ALLOWED_DOMAIN=cobeisfresh.com`, a non-Cobe Google account is rejected at sign-in. |

---

## 13. Non-Functional Requirements

- **Privacy:** All data stays in the org's instance. No telemetry to external services. Productive token never leaves the server process.
- **Backups (server mode):** Postgres dumps recommended daily; document a `pg_dump` cron in the README.
- **Auditability:** Snapshot system is the audit trail. Every snapshot records label, time, and (in v1.1) user.
- **Accessibility:** Keyboard navigation across the grid. Color is never the only signal (always paired with text or icon). WCAG AA color contrast on grid text.
- **i18n:** English only in v1. Strings centralized to allow translation later.
- **Browser support:** Latest Chrome, Safari, Firefox. No IE.
- **Error handling:** Productive sync errors don't break the app; surface in `/sync` with retry button.

---

## 14. Testing Guidance

Unit tests are non-negotiable for `/lib/capacity` and `/lib/weeks`:
- ISO week boundary cases (year transitions, week 53).
- Pipeline math with `probability=0`, `100`, mixed default vs override modes.
- Overrides replacing base capacity correctly.
- Roll-up from people → seniority → role → team.

Component tests for the pivot grid: empty state, single team, many teams, axis switching, heatmap thresholds.

One Playwright E2E:
1. Boot local with seed data.
2. Create a project with 3 weeks of allocations.
3. Verify overview reflects the demand.
4. Take a snapshot.
5. Change an allocation; assert diff page shows the delta.

---

## 15. Setup Instructions for Claude Code

When this spec is handed off, the implementing agent should:

1. **Read** this SPEC.md and the companion CLAUDE.md.
2. **Load** the `productive-api` and `anthropic-skills:docx`/`google-app-script` skills only if relevant — only `productive-api` is required.
3. **Confirm assumptions** flagged in Section 17 (Open Questions) with the user before Phase 4.
4. **Bootstrap** per Phase 0 and demo a hello-world before proceeding.
5. **Ship Phase 1 end-to-end** (UI + DB + tests) before starting Phase 2 — don't build all schemas first and all UIs later.
6. **Take a snapshot of state** (the snapshot model itself) once Phase 5 is complete — useful for self-testing.

Recommended commands (the implementing agent should add these to `package.json`):
```
npm run dev          # local dev with SQLite
npm run db:push      # apply Prisma schema
npm run db:seed      # seed Cobe teams + 1 sample pipeline deal
npm run sync         # manual Productive sync (CLI entry point)
npm run snapshot     # CLI snapshot for testing
npm run export       # dump SQLite to JSON
npm run import       # import JSON into Postgres
npm test             # vitest
npm run e2e          # playwright
```

---

## 16. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Productive's bookings are person-level but our plan is seniority-level → mapping is lossy | v1 doesn't sync bookings as allocations; we rely on Productive only for people, deals, projects, time-off. Revisit in v2 with explicit booking → seniority mapping. |
| Seniority taxonomy drifts (Cobe rebrands "Medior" → "Mid") | Soft-archive + rename are first-class. Allocations reference seniority IDs not names. |
| Solo editor becomes a bottleneck once team grows | Server mode + role-based reads in v1.1 with Google SSO. |
| Goran abandons it because data entry is too much | Productive sync targets the highest-frequency entities first (people, time-off, deals). Manual entry is only for what Productive can't provide. |

---

## 17. Open Questions for Goran

These can be answered during implementation; flag them rather than guess.

1. **Seniority taxonomy** — confirm the tiers per team. Are they uniform (Junior / Medior / Senior / Lead) or do some teams have custom tiers (e.g., Design might have "Principal")?
2. **Probability bands** — should the default color thresholds match how Cobe categorizes pipeline in Productive, or are these our own categories?
3. **Booking sync** — once we see how Productive bookings actually look for Cobe's projects, do we want a v2 sync that converts them into demand? (Default answer: no, but worth confirming.)
4. **Holiday calendar** — should the planner know Croatian/regional holidays so it can pre-fill 0 capacity weeks? Quick win if yes.
5. **Hiring plan** — should a "ghost person" feature exist (planned hires that contribute to capacity from a future week)? Suggested for v1.5.
6. **Currency / cost** — out of scope for v1, but confirm we don't need rate cards visible (utilization view only, no revenue projection).

---

## 18. Post-v1 Backlog

Items confirmed out of scope for v1 but queued for a follow-up release:

| Item | Notes |
|------|-------|
| Un-archive teams / roles / seniority tiers / people | Currently archive-only. Add a restore action in Teams/People editors. Archived entities should be shown in a collapsed "Archived" section with a "Restore" button. |

---

## 19. Glossary of Cobe-specific terms (to be filled by implementer)

Reserved section. The implementing agent should populate this after Phase 1 if it discovers any Cobe-internal terminology worth documenting (e.g., department names, internal status labels from Productive).

---

**End of spec.**
