"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

// Fixed column widths — chart YAxis width and table label column must match LABEL_W;
// chart bands and table data cells must match CELL_W so weeks align vertically.
const LABEL_W = 160;
const CELL_W = 52;
import { effectiveDemand, heatmapColor, calcUtilization } from "@/lib/capacity";
import { upcomingWeeks, weekIdToMonday } from "@/lib/weeks";
import { cn } from "@/lib/utils";

// ── Serialized types ─────────────────────────────────────────────

interface PersonForClient {
  id: string;
  fullName: string;
  baseCapacity: number;
  startWeekId: string | null;
  endWeekId: string | null;
  seniorityId: string;
  seniority: {
    id: string;
    name: string;
    role: {
      id: string;
      name: string;
      team: { id: string; name: string; displayOrder: number };
    };
  };
  overrides: Array<{ weekId: string; capacity: number }>;
  holidayCalendarId: string | null;
}

interface AllocationForClient {
  seniorityId: string;
  weekId: string;
  fte: number;
}

interface ProjectForClient {
  id: string;
  name: string;
  status: string;
  probability: number | null;
  pipelineCalcMode: string | null;
  allocations: AllocationForClient[];
}

interface SeniorityForClient {
  id: string;
  name: string;
  role: {
    id: string;
    name: string;
    team: { id: string; name: string; displayOrder: number };
  };
}

interface ColorBand {
  minPct: number;
  maxPct: number;
  color: string;
  label: string;
}

type Horizon = 12 | 26 | 52;
type Axis = "team" | "role" | "seniority";
type StatusKey = "pipeline" | "committed" | "running" | "internal";

interface Props {
  people: PersonForClient[];
  projects: ProjectForClient[];
  seniorities: SeniorityForClient[];
  colorBands: ColorBand[];
  defaultCalcMode: "weighted" | "full";
  currentWeek: string;
  /** Pre-computed holiday counts keyed by "calendarId:weekId". */
  holidayLookup: Record<string, number>;
}

// ── Helpers ──────────────────────────────────────────────────────

function personCap(
  person: PersonForClient,
  weekId: string,
  holidayLookup: Record<string, number>
): number {
  if (person.startWeekId && weekId < person.startWeekId) return 0;
  if (person.endWeekId && weekId > person.endWeekId) return 0;

  const ov = person.overrides.find((o) => o.weekId === weekId);

  const holidayDays =
    person.holidayCalendarId
      ? (holidayLookup[`${person.holidayCalendarId}:${weekId}`] ?? 0)
      : 0;

  if (holidayDays === 0) {
    return ov !== undefined ? ov.capacity : person.baseCapacity;
  }

  // Combine PTO days (inferred from override) + holiday days against baseCapacity
  const base = person.baseCapacity;
  if (base <= 0) return 0;
  const ptoDays = ov
    ? Math.min(5, Math.max(0, Math.round((1 - ov.capacity / base) * 5)))
    : 0;
  const totalAbsentDays = Math.min(5, ptoDays + holidayDays);
  return Math.max(0, Math.round(base * (1 - totalAbsentDays / 5) * 10) / 10);
}

function personBucketId(person: PersonForClient, axis: Axis): string {
  if (axis === "team") return person.seniority.role.team.id;
  if (axis === "role") return person.seniority.role.id;
  return person.seniorityId;
}

function seniorityBucketId(s: SeniorityForClient, axis: Axis): string {
  if (axis === "team") return s.role.team.id;
  if (axis === "role") return s.role.id;
  return s.id;
}

// null = all selected; non-null Set = explicitly selected subset
function isActive(id: string, selected: Set<string> | null): boolean {
  return selected === null || selected.has(id);
}

const HEATMAP: Record<string, { bg: string; text: string }> = {
  green:   { bg: "bg-green-50",  text: "text-green-700"  },
  neutral: { bg: "bg-white",     text: "text-gray-600"   },
  yellow:  { bg: "bg-yellow-50", text: "text-yellow-700" },
  red:     { bg: "bg-red-100",   text: "text-red-700"    },
};

// ── Month helpers ────────────────────────────────────────────────

/** Unique key for the calendar month that contains a week's Monday. */
function weekToMonthKey(weekId: string): string {
  const d = weekIdToMonday(weekId);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/** Short month label; appends abbreviated year when it differs from startYear. */
function weekToMonthLabel(weekId: string, startYear: number): string {
  const d = weekIdToMonday(weekId);
  const mon = d.toLocaleString("en-US", { month: "short" });
  return d.getFullYear() !== startYear ? `${mon} '${String(d.getFullYear()).slice(2)}` : mon;
}

// ── Helpers ──────────────────────────────────────────────────────

function axisPlural(axis: Axis): string {
  return axis === "seniority" ? "seniorities" : `${axis}s`;
}

// ── Bucket multi-select dropdown ─────────────────────────────────

function BucketFilter({
  axis,
  buckets,
  selected,
  onChange,
  seniorities,
}: {
  axis: Axis;
  buckets: { id: string; label: string }[];
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
  seniorities: SeniorityForClient[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const plural = axisPlural(axis);
  const isFiltered = selected !== null && selected.size < buckets.length;
  const label = !isFiltered
    ? `All ${plural}`
    : selected!.size === 0
    ? `No ${plural}`
    : `${selected!.size} of ${buckets.length} ${plural}`;

  function toggle(id: string) {
    if (selected === null) {
      const next = new Set(buckets.map((b) => b.id));
      next.delete(id);
      onChange(next);
    } else {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange(next);
    }
  }

  function toggleGroup(ids: string[]) {
    const someUnselected = ids.some((id) => !isActive(id, selected));
    if (someUnselected) {
      if (selected === null) return; // all already selected
      const next = new Set(selected);
      ids.forEach((id) => next.add(id));
      onChange(next.size === buckets.length ? null : next);
    } else {
      const base = selected === null
        ? new Set(buckets.map((b) => b.id))
        : new Set(selected);
      ids.forEach((id) => base.delete(id));
      onChange(base);
    }
  }

  function selectByLevel(name: string) {
    onChange(new Set(seniorities.filter((s) => s.name === name).map((s) => s.id)));
  }

  function selectAll() { onChange(null); }
  function selectNone() { onChange(new Set()); }

  // Grouped structure for seniority axis: team → role → tiers
  const grouped = useMemo(() => {
    if (axis !== "seniority") return null;
    const teams = new Map<string, {
      team: SeniorityForClient["role"]["team"];
      roles: Map<string, { role: SeniorityForClient["role"]; tiers: SeniorityForClient[] }>;
    }>();
    for (const s of seniorities) {
      if (!teams.has(s.role.team.id))
        teams.set(s.role.team.id, { team: s.role.team, roles: new Map() });
      const te = teams.get(s.role.team.id)!;
      if (!te.roles.has(s.role.id))
        te.roles.set(s.role.id, { role: s.role, tiers: [] });
      te.roles.get(s.role.id)!.tiers.push(s);
    }
    return [...teams.values()].sort((a, b) => a.team.displayOrder - b.team.displayOrder);
  }, [axis, seniorities]);

  // Unique level names in natural order (seniorities sorted by level)
  const levelNames = useMemo(() => {
    const seen: string[] = [];
    for (const s of seniorities) {
      if (!seen.includes(s.name)) seen.push(s.name);
    }
    return seen;
  }, [seniorities]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
          isFiltered
            ? "border-blue-300 bg-blue-50 text-blue-700"
            : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
        )}
      >
        {label}
        <svg className="h-3 w-3 opacity-50" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 8L2 4h8z" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-gray-200 bg-white shadow-lg">
          {/* Header row */}
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
              Filter {plural}
            </span>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-[10px] text-blue-500 hover:underline">All</button>
              <button onClick={selectNone} className="text-[10px] text-blue-500 hover:underline">None</button>
            </div>
          </div>

          {/* Level quick-select (seniority axis only) */}
          {axis === "seniority" && levelNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-3 py-2">
              <span className="text-[10px] text-gray-400">By level:</span>
              {levelNames.map((name) => (
                <button
                  key={name}
                  onClick={() => selectByLevel(name)}
                  className="rounded px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700 transition-colors"
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {/* Item list */}
          <div className="max-h-64 overflow-y-auto py-1">
            {axis === "seniority" && grouped ? (
              grouped.map(({ team, roles }) => {
                const teamIds = [...roles.values()].flatMap((r) => r.tiers.map((t) => t.id));
                const allTeam = teamIds.every((id) => isActive(id, selected));
                const someTeam = teamIds.some((id) => isActive(id, selected));
                return (
                  <div key={team.id}>
                    {/* Team header */}
                    <label className="flex cursor-pointer items-center gap-2 bg-gray-50 px-3 py-1 hover:bg-gray-100">
                      <input
                        type="checkbox"
                        ref={(el) => { if (el) el.indeterminate = someTeam && !allTeam; }}
                        checked={allTeam}
                        onChange={() => toggleGroup(teamIds)}
                        className="rounded"
                      />
                      <span className="text-[11px] font-semibold text-gray-700">{team.name}</span>
                    </label>
                    {[...roles.values()].map(({ role, tiers }) => {
                      const roleIds = tiers.map((t) => t.id);
                      const allRole = roleIds.every((id) => isActive(id, selected));
                      const someRole = roleIds.some((id) => isActive(id, selected));
                      const multiRole = roles.size > 1;
                      return (
                        <div key={role.id}>
                          {/* Role sub-header when team has multiple roles */}
                          {multiRole && (
                            <label className="flex cursor-pointer items-center gap-2 pl-6 pr-3 py-0.5 hover:bg-gray-50">
                              <input
                                type="checkbox"
                                ref={(el) => { if (el) el.indeterminate = someRole && !allRole; }}
                                checked={allRole}
                                onChange={() => toggleGroup(roleIds)}
                                className="rounded"
                              />
                              <span className="text-[10px] font-medium text-gray-500">{role.name}</span>
                            </label>
                          )}
                          {tiers.map((tier) => (
                            <label
                              key={tier.id}
                              className="flex cursor-pointer items-center gap-2 py-0.5 hover:bg-gray-50"
                              style={{ paddingLeft: multiRole ? 36 : 24, paddingRight: 12 }}
                            >
                              <input
                                type="checkbox"
                                checked={isActive(tier.id, selected)}
                                onChange={() => toggle(tier.id)}
                                className="rounded"
                              />
                              <span className="text-xs text-gray-700">{tier.name}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              buckets.map((b) => (
                <label
                  key={b.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selected === null || selected.has(b.id)}
                    onChange={() => toggle(b.id)}
                    className="rounded"
                  />
                  <span className="text-xs text-gray-700">{b.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export function OverviewClient({
  people,
  projects,
  seniorities,
  defaultCalcMode,
  currentWeek,
  holidayLookup,
}: Props) {
  const [horizon, setHorizon] = useState<Horizon>(12);
  const [startWeek, setStartWeek] = useState(currentWeek);
  const [axis, setAxis] = useState<Axis>("team");
  const [selectedBucketIds, setSelectedBucketIds] = useState<Set<string> | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<StatusKey>>(
    () => new Set(["pipeline", "committed", "running", "internal"])
  );
  const [pipelineModeOverride, setPipelineModeOverride] = useState<"weighted" | "full">(defaultCalcMode);
  // Which team rows are expanded to show role sub-rows (only relevant when axis="team")
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  const effectiveCalcMode = pipelineModeOverride;

  const weeks = useMemo(
    () => upcomingWeeks(horizon, startWeek),
    [horizon, startWeek]
  );

  const startYear = useMemo(
    () => weeks.length > 0 ? weekIdToMonday(weeks[0]).getFullYear() : new Date().getFullYear(),
    [weeks]
  );

  // Groups of consecutive weeks sharing the same calendar month — used for colspans.
  const monthGroups = useMemo(() => {
    const groups: { key: string; label: string; count: number }[] = [];
    let lastKey = "";
    for (const w of weeks) {
      const key = weekToMonthKey(w);
      if (key !== lastKey) {
        groups.push({ key, label: weekToMonthLabel(w, startYear), count: 1 });
        lastKey = key;
      } else {
        groups[groups.length - 1].count++;
      }
    }
    return groups;
  }, [weeks, startYear]);

  // Set of weekIds that are the first week of a new month — used for stronger column borders.
  const monthBoundaries = useMemo(() => {
    const set = new Set<string>();
    let lastKey = "";
    for (const w of weeks) {
      const key = weekToMonthKey(w);
      if (key !== lastKey) { set.add(w); lastKey = key; }
    }
    return set;
  }, [weeks]);

  const filteredProjects = useMemo(
    () => projects.filter((p) => statusFilter.has(p.status as StatusKey)),
    [projects, statusFilter]
  );

  const seniorityById = useMemo(() => {
    const m: Record<string, SeniorityForClient> = {};
    for (const s of seniorities) m[s.id] = s;
    return m;
  }, [seniorities]);

  // Build axis bucket list (deduplicated, sorted)
  const buckets = useMemo(() => {
    if (axis === "team") {
      const seen = new Map<string, { id: string; label: string; order: number }>();
      for (const s of seniorities) {
        const t = s.role.team;
        if (!seen.has(t.id))
          seen.set(t.id, { id: t.id, label: t.name, order: t.displayOrder });
      }
      return [...seen.values()].sort((a, b) => a.order - b.order);
    }
    if (axis === "role") {
      const seen = new Map<string, { id: string; label: string; order: number }>();
      for (const s of seniorities) {
        const r = s.role;
        if (!seen.has(r.id))
          seen.set(r.id, {
            id: r.id,
            label: `${r.team.name} · ${r.name}`,
            order: r.team.displayOrder,
          });
      }
      return [...seen.values()].sort(
        (a, b) => a.order - b.order || a.label.localeCompare(b.label)
      );
    }
    return seniorities
      .map((s) => ({
        id: s.id,
        label: `${s.role.team.name} · ${s.role.name} · ${s.name}`,
        order: s.role.team.displayOrder,
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [axis, seniorities]);

  // Pivot: bucket × week → { supply, demand, utilPct }
  const pivot = useMemo(() => {
    return buckets
      .filter((b) => isActive(b.id, selectedBucketIds))
      .map((bucket) => {
        const cells = weeks.map((week) => {
          const supply = people.reduce((sum, p) => {
            if (!isActive(personBucketId(p, axis), selectedBucketIds)) return sum;
            return personBucketId(p, axis) === bucket.id
              ? sum + personCap(p, week, holidayLookup)
              : sum;
          }, 0);

          const demand = filteredProjects.reduce((sum, project) => {
            return (
              sum +
              project.allocations
                .filter((a) => a.weekId === week)
                .reduce((s, a) => {
                  const sen = seniorityById[a.seniorityId];
                  if (!sen) return s;
                  const bid = seniorityBucketId(sen, axis);
                  if (!isActive(bid, selectedBucketIds)) return s;
                  return bid === bucket.id
                    ? s + effectiveDemand(a.fte, project, effectiveCalcMode)
                    : s;
                }, 0)
            );
          }, 0);

          const util = calcUtilization(demand, supply);
          return { week, supply: util.supply, demand: util.demand, utilPct: util.utilPct };
        });
        return { bucket, cells };
      });
  }, [
    buckets,
    selectedBucketIds,
    weeks,
    people,
    filteredProjects,
    seniorityById,
    axis,
    effectiveCalcMode,
    holidayLookup,
  ]);

  // Chart data: supply line + demand stacked by status, scoped to selected buckets
  const chartData = useMemo(() => {
    return weeks.map((week) => {
      const supply = Math.round(
        people
          .filter((p) => isActive(personBucketId(p, axis), selectedBucketIds))
          .reduce((sum, p) => sum + personCap(p, week, holidayLookup), 0) * 10
      ) / 10;

      let pipeline = 0;
      let committed = 0;
      let running = 0;
      let internal = 0;

      for (const project of filteredProjects) {
        const d = project.allocations
          .filter((a) => {
            if (a.weekId !== week) return false;
            const sen = seniorityById[a.seniorityId];
            return sen ? isActive(seniorityBucketId(sen, axis), selectedBucketIds) : false;
          })
          .reduce((s, a) => s + effectiveDemand(a.fte, project, effectiveCalcMode), 0);
        if (project.status === "pipeline") pipeline += d;
        else if (project.status === "committed") committed += d;
        else if (project.status === "running") running += d;
        else if (project.status === "internal") internal += d;
      }

      return {
        week: week.slice(5),
        supply,
        pipeline: Math.round(pipeline * 10) / 10,
        committed: Math.round(committed * 10) / 10,
        running: Math.round(running * 10) / 10,
        internal: Math.round(internal * 10) / 10,
      };
    });
  }, [weeks, people, filteredProjects, seniorityById, axis, selectedBucketIds, effectiveCalcMode, holidayLookup]);

  const totalFte = useMemo(
    () =>
      Math.round(
        people.reduce((s, p) => s + personCap(p, currentWeek, holidayLookup), 0) * 10
      ) / 10,
    [people, currentWeek, holidayLookup]
  );

  function toggleStatus(s: StatusKey) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function changeAxis(a: Axis) {
    setAxis(a);
    setSelectedBucketIds(null); // reset filter when axis changes
  }

  function toggleTeam(teamId: string) {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
      return next;
    });
  }

  // Role-level sub-rows for expanded teams (only computed when axis="team").
  // Map: teamId → [ { role, cells[] } ]
  const rolePivot = useMemo(() => {
    if (axis !== "team" || expandedTeams.size === 0) return new Map<string, { role: { id: string; label: string }; cells: { week: string; supply: number; demand: number; utilPct: number }[] }[]>();

    // Build ordered role list per team
    const teamRoles = new Map<string, { id: string; label: string }[]>();
    for (const s of seniorities) {
      const tid = s.role.team.id;
      if (!teamRoles.has(tid)) teamRoles.set(tid, []);
      const arr = teamRoles.get(tid)!;
      if (!arr.find((r) => r.id === s.role.id))
        arr.push({ id: s.role.id, label: s.role.name });
    }

    const result = new Map<string, { role: { id: string; label: string }; cells: { week: string; supply: number; demand: number; utilPct: number }[] }[]>();

    for (const teamId of expandedTeams) {
      const roles = teamRoles.get(teamId) ?? [];
      result.set(
        teamId,
        roles.map((role) => ({
          role,
          cells: weeks.map((week) => {
            const supply = people.reduce(
              (sum, p) =>
                p.seniority.role.id === role.id &&
                isActive(p.seniority.role.team.id, selectedBucketIds)
                  ? sum + personCap(p, week, holidayLookup)
                  : sum,
              0
            );
            const demand = filteredProjects.reduce(
              (sum, proj) =>
                sum +
                proj.allocations
                  .filter((a) => a.weekId === week)
                  .reduce((s, a) => {
                    const sen = seniorityById[a.seniorityId];
                    if (
                      !sen ||
                      sen.role.id !== role.id ||
                      !isActive(sen.role.team.id, selectedBucketIds)
                    )
                      return s;
                    return s + effectiveDemand(a.fte, proj, effectiveCalcMode);
                  }, 0),
              0
            );
            const util = calcUtilization(demand, supply);
            return { week, supply: util.supply, demand: util.demand, utilPct: util.utilPct };
          }),
        }))
      );
    }
    return result;
  }, [axis, expandedTeams, seniorities, weeks, people, filteredProjects, seniorityById, selectedBucketIds, effectiveCalcMode, holidayLookup]);

  // Total pixel width shared by chart and table — keeps week columns aligned.
  const chartWidth = LABEL_W + weeks.length * CELL_W;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Overview</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {currentWeek} · {people.length} people · {totalFte} FTE available
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        {/* Horizon */}
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-gray-500">Horizon</span>
          {([12, 26, 52] as Horizon[]).map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                horizon === h
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              )}
            >
              {h}w
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-gray-200" />

        {/* Start week */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">From</span>
          <input
            type="text"
            value={startWeek}
            onChange={(e) => setStartWeek(e.target.value)}
            className="w-24 rounded border border-gray-300 px-2 py-0.5 font-mono text-xs"
            placeholder="2026-W24"
          />
        </div>

        <div className="h-4 w-px bg-gray-200" />

        {/* Axis */}
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-gray-500">Axis</span>
          {(["team", "role", "seniority"] as Axis[]).map((a) => (
            <button
              key={a}
              onClick={() => changeAxis(a)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                axis === a
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              )}
            >
              {a}
            </button>
          ))}
        </div>

        {/* Bucket multi-select (contextual to current axis) */}
        <BucketFilter
          axis={axis}
          buckets={buckets}
          selected={selectedBucketIds}
          onChange={setSelectedBucketIds}
          seniorities={seniorities}
        />

        <div className="h-4 w-px bg-gray-200" />

        {/* Status filter */}
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-gray-500">Show</span>
          {(["pipeline", "committed", "running", "internal"] as StatusKey[]).map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={statusFilter.has(s)}
                onChange={() => toggleStatus(s)}
                className="rounded"
              />
              <span className="text-xs capitalize text-gray-600">{s}</span>
            </label>
          ))}
        </div>

        <div className="h-4 w-px bg-gray-200" />

        {/* Pipeline mode override */}
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-gray-500">Pipeline</span>
          {(["weighted", "full"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPipelineModeOverride(m)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                pipelineModeOverride === m
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Chart + table share one overflow-x-auto container so week columns stay aligned */}
      <div className="overflow-x-auto">

      {/* Demand vs Supply chart */}
      <div style={{ minWidth: chartWidth }} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm mb-3">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          Demand vs. Supply — {horizon} weeks from {startWeek}
          {selectedBucketIds !== null && selectedBucketIds.size < buckets.length && (
            <span className="ml-2 text-xs font-normal text-blue-600">
              ({selectedBucketIds.size === 0 ? "none" : `${selectedBucketIds.size} of ${buckets.length}`} {axisPlural(axis)})
            </span>
          )}
        </h2>
        <ComposedChart
          width={chartWidth}
          height={200}
          data={chartData}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="week" tick={{ fontSize: 10 }} tickLine={false} />
            <YAxis
              width={LABEL_W}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              unit=" FTE"
            />
            <Tooltip
              formatter={(val: number, name: string) => [
                val.toFixed(1) + " FTE",
                name.charAt(0).toUpperCase() + name.slice(1),
              ]}
            />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="internal" name="Internal" stackId="d" fill="#8B5CF6" radius={[0, 0, 0, 0]} />
            <Bar dataKey="running" name="Running" stackId="d" fill="#0A84FF" radius={[0, 0, 0, 0]} />
            <Bar dataKey="committed" name="Committed" stackId="d" fill="#34C759" radius={[0, 0, 0, 0]} />
            <Bar dataKey="pipeline" name="Pipeline" stackId="d" fill="#FFD27F" radius={[2, 2, 0, 0]} />
            <Line dataKey="supply" name="Supply" type="monotone" stroke="#374151" strokeWidth={2} dot={{ r: 3, fill: "#374151", strokeWidth: 0 }} activeDot={{ r: 5 }} />
            {weeks.map((weekId, i) => {
              if (i === 0) return null;
              if (weekToMonthKey(weekId) === weekToMonthKey(weeks[i - 1])) return null;
              const monthLabel = weekToMonthLabel(weekId, startYear);
              return (
                <ReferenceLine
                  key={weekId}
                  x={weekId.slice(5)}
                  stroke="#d1d5db"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  label={(props: { viewBox?: { x: number; y: number } }) => {
                    const vb = props.viewBox;
                    if (!vb) return <g />;
                    return (
                      <text
                        x={vb.x + 4}
                        y={vb.y + 11}
                        textAnchor="start"
                        fontSize={9}
                        fontWeight={600}
                        fill="#9ca3af"
                      >
                        {monthLabel}
                      </text>
                    );
                  }}
                />
              );
            })}
          </ComposedChart>
      </div>

      {/* Pivot grid */}
      <div style={{ minWidth: chartWidth }} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="border-collapse text-xs">
            <thead>
              {/* Month header row */}
              <tr className="border-b border-gray-100">
                <th className="sticky left-0 z-10 w-[160px] min-w-[160px] border-r border-gray-200 bg-gray-50 px-3 py-1" />
                {monthGroups.map(({ key, label, count }) => (
                  <th
                    key={key}
                    colSpan={count}
                    className="border-l border-gray-200 bg-gray-50 px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400"
                  >
                    {label}
                  </th>
                ))}
              </tr>
              {/* Week header row */}
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="sticky left-0 z-10 w-[160px] min-w-[160px] border-r border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500">
                  {axis.charAt(0).toUpperCase() + axis.slice(1)}
                </th>
                {weeks.map((w) => (
                  <th
                    key={w}
                    className={cn(
                      "w-[52px] min-w-[52px] px-1 py-1.5 text-center font-medium text-gray-500",
                      monthBoundaries.has(w) ? "border-l border-gray-200" : "border-l border-gray-100"
                    )}
                  >
                    {w.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pivot.length === 0 ? (
                <tr>
                  <td
                    colSpan={weeks.length + 1}
                    className="py-12 text-center text-sm text-gray-400"
                  >
                    No data. Add people and projects, or broaden your filter.
                  </td>
                </tr>
              ) : (
                pivot.map(({ bucket, cells }) => (
                  <React.Fragment key={bucket.id}>
                  <tr
                    className="border-b border-gray-100 last:border-0 hover:brightness-[0.98]"
                  >
                    <td className="sticky left-0 z-10 w-[160px] min-w-[160px] max-w-[160px] border-r border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-800">
                      {axis === "team" ? (
                        <button
                          onClick={() => toggleTeam(bucket.id)}
                          className="flex w-full items-center gap-1.5 text-left"
                        >
                          <svg
                            className={cn("h-3 w-3 shrink-0 text-gray-400 transition-transform", expandedTeams.has(bucket.id) && "rotate-90")}
                            viewBox="0 0 12 12" fill="currentColor"
                          >
                            <path d="M4 2l5 4-5 4V2z" />
                          </svg>
                          <span className="truncate">{bucket.label}</span>
                        </button>
                      ) : (
                        <span className="truncate block">{bucket.label}</span>
                      )}
                    </td>
                    {cells.map(({ week, supply, demand, utilPct }) => {
                      const empty = supply === 0 && demand === 0;
                      const color = empty ? "neutral" : heatmapColor(utilPct);
                      const { bg, text } = HEATMAP[color];
                      return (
                        <td
                          key={week}
                          className={cn(
                            "px-1 py-1 text-center",
                            monthBoundaries.has(week) ? "border-l border-gray-300" : "border-l border-gray-100",
                            bg
                          )}
                        >
                          {empty ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            <div className={cn("tabular-nums leading-tight", text)}>
                              <div className="font-semibold">{demand.toFixed(1)}</div>
                              <div className="text-[10px] opacity-60">/{supply.toFixed(1)}</div>
                              <div className="text-[10px] font-medium">
                                {isFinite(utilPct)
                                  ? Math.round(utilPct * 100) + "%"
                                  : "∞"}
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Role sub-rows (only when axis="team" and team is expanded) */}
                  {axis === "team" && expandedTeams.has(bucket.id) &&
                    rolePivot.get(bucket.id)?.map(({ role, cells: roleCells }) => (
                      <tr key={`role-${role.id}`} className="border-b border-gray-100 bg-gray-50/60">
                        <td className="sticky left-0 z-10 w-[160px] min-w-[160px] max-w-[160px] border-r border-gray-200 bg-gray-50/60 py-1 pr-3 pl-7 text-xs text-gray-500">
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-300">└</span>
                            <span className="truncate">{role.label}</span>
                          </div>
                        </td>
                        {roleCells.map(({ week, supply, demand, utilPct }) => {
                          const empty = supply === 0 && demand === 0;
                          const color = empty ? "neutral" : heatmapColor(utilPct);
                          const { bg, text } = HEATMAP[color];
                          return (
                            <td
                              key={week}
                              className={cn(
                                "px-1 py-1 text-center",
                                monthBoundaries.has(week) ? "border-l border-gray-300" : "border-l border-gray-100",
                                bg, "opacity-90"
                              )}
                            >
                              {empty ? (
                                <span className="text-gray-300">—</span>
                              ) : (
                                <div className={cn("tabular-nums leading-tight text-[10px]", text)}>
                                  <div className="font-semibold">{demand.toFixed(1)}</div>
                                  <div className="opacity-60">/{supply.toFixed(1)}</div>
                                  <div className="font-medium">
                                    {isFinite(utilPct) ? Math.round(utilPct * 100) + "%" : "∞"}
                                  </div>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  }
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>

        <div className="flex items-center gap-4 border-t border-gray-100 bg-gray-50 px-3 py-2 text-[10px] text-gray-500">
          <span>demand / supply / util%</span>
          {[
            { cls: "bg-green-50", label: "≤69%" },
            { cls: "bg-white border border-gray-200", label: "70–89%" },
            { cls: "bg-yellow-50", label: "90–110%" },
            { cls: "bg-red-100", label: ">110%" },
          ].map(({ cls, label }) => (
            <span key={label} className="flex items-center gap-1">
              <span className={cn("inline-block h-3 w-3 rounded-sm", cls)} />
              {label}
            </span>
          ))}
        </div>
      </div>
      </div>{/* /shared scroll container */}
    </div>
  );
}
