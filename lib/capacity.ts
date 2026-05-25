/**
 * Pure FTE math — no DB calls, fully unit-tested.
 * All inputs are plain data objects; callers are responsible for fetching from DB.
 */
import { dateToWeekId } from "./weeks";

export interface PersonData {
  id: string;
  seniorityId: string;
  baseCapacity: number;
  startDate?: Date | null;
  endDate?: Date | null;
  overrides: CapacityOverrideData[];
  holidayCalendarId?: string | null;
}

/**
 * Pre-computed holiday counts keyed by "calendarId:weekId" → number of holiday days.
 * Build once per page load, pass down to all capacity functions.
 */
export type HolidayLookup = Readonly<Record<string, number>>;

export interface CapacityOverrideData {
  weekId: string;
  capacity: number;
}

export interface AllocationData {
  seniorityId: string;
  fte: number;
}

export interface ProjectData {
  status: string; // "pipeline" | "committed" | "running" | "done" | "lost"
  probability?: number | null;
  pipelineCalcMode?: string | null;
}

export type DefaultCalcMode = "weighted" | "full";

// ────────────────────────────────────────────────────────────
// Supply side
// ────────────────────────────────────────────────────────────

/**
 * Effective capacity for a person in a specific week.
 * Override (if present) replaces baseCapacity for PTO weeks.
 * Holiday days are combined with PTO days and applied to baseCapacity.
 * Returns 0 if the week falls outside the person's employment dates.
 */
export function personCapacity(
  person: PersonData,
  weekId: string,
  holidays?: HolidayLookup
): number {
  // Check employment window (compare ISO week strings — lexicographic sort works for YYYY-Www)
  if (person.startDate && weekId < dateToWeekId(person.startDate)) return 0;
  if (person.endDate && weekId > dateToWeekId(person.endDate)) return 0;

  const override = person.overrides.find((o) => o.weekId === weekId);

  // Fast path — no holiday data or no calendar assigned
  const holidayDays =
    holidays && person.holidayCalendarId
      ? (holidays[`${person.holidayCalendarId}:${weekId}`] ?? 0)
      : 0;

  if (holidayDays === 0) {
    return override !== undefined ? override.capacity : person.baseCapacity;
  }

  // Combine PTO days (inferred from override) + holiday days, then re-apply to baseCapacity.
  // This avoids double-counting when someone has PTO on the same week as a public holiday.
  const base = person.baseCapacity;
  if (base <= 0) return 0;
  const ptoDays = override
    ? Math.min(5, Math.max(0, Math.round((1 - override.capacity / base) * 5)))
    : 0;
  const totalAbsentDays = Math.min(5, ptoDays + holidayDays);
  return Math.max(0, round1(base * (1 - totalAbsentDays / 5)));
}

/**
 * Total supply FTE for a list of people in a week.
 * Optionally filtered to a specific seniorityId.
 */
export function supplyFte(
  people: PersonData[],
  weekId: string,
  seniorityId?: string,
  holidays?: HolidayLookup
): number {
  const filtered = seniorityId
    ? people.filter((p) => p.seniorityId === seniorityId)
    : people;
  return filtered.reduce((sum, p) => sum + personCapacity(p, weekId, holidays), 0);
}

// ────────────────────────────────────────────────────────────
// Demand side
// ────────────────────────────────────────────────────────────

/**
 * Effective FTE demand for a single allocation row, accounting for pipeline math.
 */
export function effectiveDemand(
  fte: number,
  project: ProjectData,
  defaultCalcMode: DefaultCalcMode
): number {
  if (project.status === "pipeline") {
    const mode = project.pipelineCalcMode ?? defaultCalcMode;
    if (mode === "weighted") {
      const prob = project.probability ?? 0;
      return fte * (prob / 100);
    }
    return fte; // "full" mode
  }
  // committed / running / internal always 100%
  if (project.status === "committed" || project.status === "running" || project.status === "internal") {
    return fte;
  }
  // done / lost → 0
  return 0;
}

/**
 * Total demand FTE for a list of allocations in a week (already filtered to that week).
 * Optionally filtered to a specific seniorityId.
 */
export function demandFte(
  allocations: (AllocationData & { project: ProjectData })[],
  seniorityId: string | undefined,
  defaultCalcMode: DefaultCalcMode
): number {
  const filtered = seniorityId
    ? allocations.filter((a) => a.seniorityId === seniorityId)
    : allocations;
  return filtered.reduce(
    (sum, a) => sum + effectiveDemand(a.fte, a.project, defaultCalcMode),
    0
  );
}

// ────────────────────────────────────────────────────────────
// Utilization
// ────────────────────────────────────────────────────────────

export interface UtilizationResult {
  demand: number;
  supply: number;
  /** 0–Infinity; Infinity when supply=0 and demand>0. */
  utilPct: number;
  /** Positive = spare capacity, negative = shortfall. */
  gapFte: number;
}

export function calcUtilization(demand: number, supply: number): UtilizationResult {
  const utilPct = supply === 0 ? (demand > 0 ? Infinity : 0) : demand / supply;
  return {
    demand: round1(demand),
    supply: round1(supply),
    utilPct,
    gapFte: round1(supply - demand),
  };
}

// ────────────────────────────────────────────────────────────
// Heatmap
// ────────────────────────────────────────────────────────────

export interface UtilThresholds {
  greenMax: number;  // default 69
  neutralMax: number; // default 89
  yellowMax: number;  // default 110
  // > yellowMax → red
}

export const DEFAULT_THRESHOLDS: UtilThresholds = {
  greenMax: 69,
  neutralMax: 89,
  yellowMax: 110,
};

export type HeatmapColor = "green" | "neutral" | "yellow" | "red";

export function heatmapColor(
  utilPct: number,
  thresholds: UtilThresholds = DEFAULT_THRESHOLDS
): HeatmapColor {
  // Round to avoid floating-point noise (e.g. 1.10 * 100 = 110.00000000000001)
  const pct = Math.round(utilPct * 10000) / 100;
  if (pct <= thresholds.greenMax) return "green";
  if (pct <= thresholds.neutralMax) return "neutral";
  if (pct <= thresholds.yellowMax) return "yellow";
  return "red";
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
