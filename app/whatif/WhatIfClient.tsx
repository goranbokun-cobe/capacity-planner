"use client";

import { useState, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  UserPlus,
  CalendarArrowUp,
  Camera,
  RotateCcw,
  X,
  Check,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { effectiveDemand, calcUtilization, heatmapColor } from "@/lib/capacity";
import { upcomingWeeks, weekIdToMonday, addWeeks } from "@/lib/weeks";

// ── Layout constants ──────────────────────────────────────────
const LABEL_W = 160;
const CELL_W = 52;

// ── Heatmap colour map ────────────────────────────────────────
const HEATMAP: Record<string, { bg: string; text: string }> = {
  green:   { bg: "bg-green-50",  text: "text-green-700"  },
  neutral: { bg: "bg-white",     text: "text-gray-600"   },
  yellow:  { bg: "bg-yellow-50", text: "text-yellow-700" },
  red:     { bg: "bg-red-100",   text: "text-red-700"    },
};

// ── Types ─────────────────────────────────────────────────────
type Horizon = 12 | 26 | 52;
type Axis = "team" | "role" | "seniority";

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

// ── Patch types ───────────────────────────────────────────────
interface WhatIfProjectOverride {
  status?: string;
  probability?: number;
  archived?: boolean;
}

interface VirtualPerson {
  id: string;
  seniorityId: string;
  fullName: string;
  baseCapacity: number;
}

interface WhatIfPatch {
  projectOverrides: Record<string, WhatIfProjectOverride>;
  allocationShifts: Record<string, number>;
  addedPeople: VirtualPerson[];
}

const EMPTY_PATCH: WhatIfPatch = {
  projectOverrides: {},
  allocationShifts: {},
  addedPeople: [],
};

interface Props {
  people: PersonForClient[];
  projects: ProjectForClient[];
  seniorities: SeniorityForClient[];
  defaultCalcMode: "weighted" | "full";
  currentWeek: string;
  holidayLookup: Record<string, number>;
}

// ── Pure helpers ──────────────────────────────────────────────

function personCap(
  person: PersonForClient,
  weekId: string,
  holidayLookup: Record<string, number>
): number {
  if (person.startWeekId && weekId < person.startWeekId) return 0;
  if (person.endWeekId && weekId > person.endWeekId) return 0;

  const ov = person.overrides.find((o) => o.weekId === weekId);
  const holidayDays = person.holidayCalendarId
    ? (holidayLookup[`${person.holidayCalendarId}:${weekId}`] ?? 0)
    : 0;

  if (holidayDays === 0) return ov !== undefined ? ov.capacity : person.baseCapacity;

  const base = person.baseCapacity;
  if (base <= 0) return 0;
  const ptoDays = ov
    ? Math.min(5, Math.max(0, Math.round((1 - ov.capacity / base) * 5)))
    : 0;
  const totalAbsentDays = Math.min(5, ptoDays + holidayDays);
  return Math.max(0, Math.round(base * (1 - totalAbsentDays / 5) * 10) / 10);
}

function personBucketId(p: PersonForClient, axis: Axis): string {
  if (axis === "team") return p.seniority.role.team.id;
  if (axis === "role") return p.seniority.role.id;
  return p.seniorityId;
}

function senBucketId(s: SeniorityForClient, axis: Axis): string {
  if (axis === "team") return s.role.team.id;
  if (axis === "role") return s.role.id;
  return s.id;
}

function weekToMonthKey(weekId: string): string {
  const d = weekIdToMonday(weekId);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function weekToMonthLabel(weekId: string, startYear: number): string {
  const d = weekIdToMonday(weekId);
  const mon = d.toLocaleString("en-US", { month: "short" });
  return d.getFullYear() !== startYear
    ? `${mon} '${String(d.getFullYear()).slice(2)}`
    : mon;
}

// ── Hire modal ────────────────────────────────────────────────

function HireModal({
  seniorities,
  onAdd,
  onClose,
}: {
  seniorities: SeniorityForClient[];
  onAdd: (p: VirtualPerson) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [seniorityId, setSeniorityId] = useState(seniorities[0]?.id ?? "");
  const [capacity, setCapacity] = useState("1.0");

  function submit() {
    if (!name.trim() || !seniorityId) return;
    onAdd({
      id: `whatif-${Date.now()}`,
      seniorityId,
      fullName: name.trim(),
      baseCapacity: Math.max(0.1, Math.min(1.0, parseFloat(capacity) || 1.0)),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-4 font-semibold text-gray-900">Add virtual person</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Future Hire"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Seniority</label>
            <select
              value={seniorityId}
              onChange={(e) => setSeniorityId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {seniorities.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.role.team.name} · {s.role.name} · {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Capacity (FTE)
            </label>
            <input
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              min="0.1"
              max="1.0"
              step="0.1"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Add person
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Push modal ────────────────────────────────────────────────

function PushModal({
  projects,
  alreadyShifted,
  onPush,
  onClose,
}: {
  projects: ProjectForClient[];
  alreadyShifted: Set<string>;
  onPush: (projectId: string, weeks: number) => void;
  onClose: () => void;
}) {
  const activeProjects = projects.filter(
    (p) => p.status === "pipeline" || p.status === "committed" || p.status === "running"
  );

  const [projectId, setProjectId] = useState(activeProjects[0]?.id ?? "");
  const [weeks, setWeeks] = useState("4");

  function submit() {
    if (!projectId) return;
    onPush(projectId, parseInt(weeks) || 4);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-4 font-semibold text-gray-900">Push project</h3>
        {activeProjects.length === 0 ? (
          <p className="text-sm text-gray-500">No active projects to push.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {alreadyShifted.has(p.id) ? "↩ " : ""}
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Shift by (weeks)
              </label>
              <input
                type="number"
                value={weeks}
                onChange={(e) => setWeeks(e.target.value)}
                min="1"
                max="26"
                step="1"
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          {activeProjects.length > 0 && (
            <button
              onClick={submit}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
            >
              Push project
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Save modal ────────────────────────────────────────────────

function SaveModal({
  changeCount,
  onSave,
  onClose,
}: {
  changeCount: number;
  onSave: (label: string) => Promise<void>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit() {
    if (!label.trim()) return;
    setSaving(true);
    try {
      await onSave(label.trim());
      setSaved(true);
      setTimeout(onClose, 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 font-semibold text-gray-900">Save what-if snapshot</h3>
        <p className="mb-4 text-xs text-gray-500">
          Applies {changeCount} change{changeCount !== 1 ? "s" : ""} to a live copy and saves it as
          a snapshot you can diff or restore later.
        </p>
        {saved ? (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            <Check className="h-4 w-4" />
            Snapshot saved!
          </div>
        ) : (
          <>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Win top 3 + hire 2"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!label.trim() || saving}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save snapshot"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function WhatIfClient({
  people,
  projects,
  seniorities,
  defaultCalcMode,
  currentWeek,
  holidayLookup,
}: Props) {
  const [patch, setPatch] = useState<WhatIfPatch>(EMPTY_PATCH);
  const [horizon, setHorizon] = useState<Horizon>(12);
  const [axis, setAxis] = useState<Axis>("team");
  const [saveModal, setSaveModal] = useState(false);
  const [hireModal, setHireModal] = useState(false);
  const [pushModal, setPushModal] = useState(false);

  // ── Weeks / month headers ───────────────────────────────────

  const weeks = useMemo(() => upcomingWeeks(horizon, currentWeek), [horizon, currentWeek]);

  const startYear = useMemo(
    () =>
      weeks.length > 0 ? weekIdToMonday(weeks[0]).getFullYear() : new Date().getFullYear(),
    [weeks]
  );

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

  const monthBoundaries = useMemo(() => {
    const set = new Set<string>();
    let lastKey = "";
    for (const w of weeks) {
      const key = weekToMonthKey(w);
      if (key !== lastKey) {
        set.add(w);
        lastKey = key;
      }
    }
    return set;
  }, [weeks]);

  // ── Lookups ─────────────────────────────────────────────────

  const projectNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of projects) m[p.id] = p.name;
    return m;
  }, [projects]);

  const seniorityById = useMemo(() => {
    const m: Record<string, SeniorityForClient> = {};
    for (const s of seniorities) m[s.id] = s;
    return m;
  }, [seniorities]);

  // ── Patched data ────────────────────────────────────────────

  const patchedProjects = useMemo(() => {
    return projects
      .filter((p) => !patch.projectOverrides[p.id]?.archived)
      .map((p) => {
        const ov = patch.projectOverrides[p.id];
        const shift = patch.allocationShifts[p.id] ?? 0;
        let result = { ...p };
        if (ov) {
          result = {
            ...result,
            status: ov.status ?? p.status,
            probability:
              ov.probability !== undefined ? ov.probability : p.probability,
          };
        }
        if (shift !== 0) {
          result = {
            ...result,
            allocations: p.allocations.map((a) => ({
              ...a,
              weekId: addWeeks(a.weekId, shift),
            })),
          };
        }
        return result;
      });
  }, [projects, patch.projectOverrides, patch.allocationShifts]);

  const patchedPeople = useMemo((): PersonForClient[] => {
    const virtual = patch.addedPeople
      .map((vp) => {
        const sen = seniorityById[vp.seniorityId];
        if (!sen) return null;
        return {
          id: vp.id,
          fullName: vp.fullName,
          baseCapacity: vp.baseCapacity,
          startWeekId: null as string | null,
          endWeekId: null as string | null,
          seniorityId: vp.seniorityId,
          seniority: sen,
          overrides: [] as Array<{ weekId: string; capacity: number }>,
          holidayCalendarId: null as string | null,
        };
      })
      .filter(Boolean) as PersonForClient[];
    return [...people, ...virtual];
  }, [people, patch.addedPeople, seniorityById]);

  // ── Derived counts ──────────────────────────────────────────

  const changeCount = useMemo(
    () =>
      Object.keys(patch.projectOverrides).length +
      Object.keys(patch.allocationShifts).length +
      patch.addedPeople.length,
    [patch]
  );

  const shiftedProjectIds = useMemo(
    () => new Set(Object.keys(patch.allocationShifts)),
    [patch.allocationShifts]
  );

  // ── Top-3 pipeline for presets ──────────────────────────────

  const top3Pipeline = useMemo(() => {
    return projects
      .filter((p) => {
        const effectiveStatus = patch.projectOverrides[p.id]?.status ?? p.status;
        return effectiveStatus === "pipeline" && !patch.projectOverrides[p.id]?.archived;
      })
      .map((p) => ({
        ...p,
        totalFte: p.allocations
          .filter((a) => weeks.includes(a.weekId))
          .reduce((s, a) => s + a.fte, 0),
      }))
      .sort((a, b) => b.totalFte - a.totalFte)
      .slice(0, 3);
  }, [projects, patch.projectOverrides, weeks]);

  // ── Axis buckets ────────────────────────────────────────────

  const buckets = useMemo(() => {
    if (axis === "team") {
      const seen = new Map<string, { id: string; label: string; order: number }>();
      for (const s of seniorities) {
        const t = s.role.team;
        if (!seen.has(t.id)) seen.set(t.id, { id: t.id, label: t.name, order: t.displayOrder });
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
      return [...seen.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    }
    return seniorities
      .map((s) => ({
        id: s.id,
        label: `${s.role.team.name} · ${s.role.name} · ${s.name}`,
        order: s.role.team.displayOrder,
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [axis, seniorities]);

  // ── Pivot: base + patched per (bucket, week) ────────────────

  const pivot = useMemo(() => {
    return buckets.map((bucket) => {
      const cells = weeks.map((week) => {
        // Base
        const baseSupply = people.reduce(
          (sum, p) =>
            personBucketId(p, axis) === bucket.id
              ? sum + personCap(p, week, holidayLookup)
              : sum,
          0
        );
        const baseDemand = projects.reduce(
          (sum, proj) =>
            sum +
            proj.allocations
              .filter((a) => a.weekId === week)
              .reduce((s, a) => {
                const sen = seniorityById[a.seniorityId];
                if (!sen || senBucketId(sen, axis) !== bucket.id) return s;
                return s + effectiveDemand(a.fte, proj, defaultCalcMode);
              }, 0),
          0
        );
        const base = calcUtilization(baseDemand, baseSupply);

        // Patched
        const patchedSupply = patchedPeople.reduce(
          (sum, p) =>
            personBucketId(p, axis) === bucket.id
              ? sum + personCap(p, week, holidayLookup)
              : sum,
          0
        );
        const patchedDemand = patchedProjects.reduce(
          (sum, proj) =>
            sum +
            proj.allocations
              .filter((a) => a.weekId === week)
              .reduce((s, a) => {
                const sen = seniorityById[a.seniorityId];
                if (!sen || senBucketId(sen, axis) !== bucket.id) return s;
                return s + effectiveDemand(a.fte, proj, defaultCalcMode);
              }, 0),
          0
        );
        const patched = calcUtilization(patchedDemand, patchedSupply);

        return { week, base, patched };
      });
      return { bucket, cells };
    });
  }, [
    buckets,
    weeks,
    people,
    projects,
    patchedPeople,
    patchedProjects,
    seniorityById,
    axis,
    defaultCalcMode,
    holidayLookup,
  ]);

  const gridWidth = LABEL_W + weeks.length * CELL_W;

  // ── Handlers ────────────────────────────────────────────────

  function applyWinTop3() {
    if (top3Pipeline.length === 0) return;
    setPatch((prev) => ({
      ...prev,
      projectOverrides: {
        ...prev.projectOverrides,
        ...Object.fromEntries(
          top3Pipeline.map((p) => [
            p.id,
            { ...prev.projectOverrides[p.id], status: "committed", probability: 100 },
          ])
        ),
      },
    }));
  }

  function applyLoseTop3() {
    if (top3Pipeline.length === 0) return;
    setPatch((prev) => ({
      ...prev,
      projectOverrides: {
        ...prev.projectOverrides,
        ...Object.fromEntries(
          top3Pipeline.map((p) => [p.id, { ...prev.projectOverrides[p.id], archived: true }])
        ),
      },
    }));
  }

  function addVirtualPerson(vp: VirtualPerson) {
    setPatch((prev) => ({ ...prev, addedPeople: [...prev.addedPeople, vp] }));
  }

  function pushProject(projectId: string, weekShift: number) {
    setPatch((prev) => ({
      ...prev,
      allocationShifts: { ...prev.allocationShifts, [projectId]: weekShift },
    }));
  }

  function removeProjectOverride(id: string) {
    setPatch((prev) => {
      const next = { ...prev.projectOverrides };
      delete next[id];
      return { ...prev, projectOverrides: next };
    });
  }

  function removeAllocationShift(id: string) {
    setPatch((prev) => {
      const next = { ...prev.allocationShifts };
      delete next[id];
      return { ...prev, allocationShifts: next };
    });
  }

  function removeVirtualPerson(id: string) {
    setPatch((prev) => ({
      ...prev,
      addedPeople: prev.addedPeople.filter((p) => p.id !== id),
    }));
  }

  async function saveSnapshot(label: string) {
    await fetch("/api/whatif/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, patch }),
    });
  }

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* Modals */}
      {hireModal && (
        <HireModal
          seniorities={seniorities}
          onAdd={addVirtualPerson}
          onClose={() => setHireModal(false)}
        />
      )}
      {pushModal && (
        <PushModal
          projects={patchedProjects}
          alreadyShifted={shiftedProjectIds}
          onPush={pushProject}
          onClose={() => setPushModal(false)}
        />
      )}
      {saveModal && (
        <SaveModal
          changeCount={changeCount}
          onSave={saveSnapshot}
          onClose={() => setSaveModal(false)}
        />
      )}

      {/* Top bar */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-indigo-500" />
            <h1 className="text-xl font-semibold text-gray-900">What-if sandbox</h1>
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            Explore scenarios without changing live data. Changes are local to this tab.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          {changeCount > 0 && (
            <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
              {changeCount} change{changeCount !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={() => setSaveModal(true)}
            disabled={changeCount === 0}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Camera className="h-3.5 w-3.5" />
            Save snapshot
          </button>
          <button
            onClick={() => setPatch(EMPTY_PATCH)}
            disabled={changeCount === 0}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Discard
          </button>
        </div>
      </div>

      {/* Two-column body */}
      <div className="flex gap-5">
        {/* ── Left: controls + grid ─────────────────────────── */}
        <div className="min-w-0 flex-1">
          {/* Controls */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
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
            {/* Axis */}
            <div className="flex items-center gap-1">
              <span className="mr-1 text-xs text-gray-500">Axis</span>
              {(["team", "role", "seniority"] as Axis[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setAxis(a)}
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
            {changeCount > 0 && (
              <>
                <div className="h-4 w-px bg-gray-200" />
                <span className="text-xs font-medium text-indigo-600">
                  ⚗️ {changeCount} change{changeCount !== 1 ? "s" : ""} active
                </span>
              </>
            )}
          </div>

          {/* Grid */}
          <div className="overflow-x-auto">
            <div
              style={{ minWidth: gridWidth }}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
            >
              <table className="border-collapse text-xs">
                <thead>
                  {/* Month row */}
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
                  {/* Week row */}
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="sticky left-0 z-10 w-[160px] min-w-[160px] border-r border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500">
                      {axis.charAt(0).toUpperCase() + axis.slice(1)}
                    </th>
                    {weeks.map((w) => (
                      <th
                        key={w}
                        className={cn(
                          "w-[52px] min-w-[52px] px-1 py-1.5 text-center font-medium text-gray-500",
                          monthBoundaries.has(w)
                            ? "border-l border-gray-200"
                            : "border-l border-gray-100"
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
                        No data. Add people and projects to get started.
                      </td>
                    </tr>
                  ) : (
                    pivot.map(({ bucket, cells }) => (
                      <tr
                        key={bucket.id}
                        className="border-b border-gray-100 last:border-0 hover:brightness-[0.98]"
                      >
                        <td className="sticky left-0 z-10 w-[160px] min-w-[160px] max-w-[160px] truncate border-r border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-800">
                          {bucket.label}
                        </td>
                        {cells.map(({ week, base, patched }) => {
                          const empty =
                            patched.supply === 0 && patched.demand === 0;
                          const color = empty
                            ? "neutral"
                            : heatmapColor(patched.utilPct);
                          const { bg, text } = HEATMAP[color];

                          // Delta in percentage points (what-if − base)
                          const baseUtilPct = isFinite(base.utilPct)
                            ? Math.round(base.utilPct * 100)
                            : null;
                          const patchedUtilPct = isFinite(patched.utilPct)
                            ? Math.round(patched.utilPct * 100)
                            : null;
                          const delta =
                            baseUtilPct !== null && patchedUtilPct !== null
                              ? patchedUtilPct - baseUtilPct
                              : null;
                          const hasDelta =
                            delta !== null && Math.abs(delta) >= 2;

                          return (
                            <td
                              key={week}
                              className={cn(
                                "px-1 py-1 text-center",
                                monthBoundaries.has(week)
                                  ? "border-l border-gray-300"
                                  : "border-l border-gray-100",
                                bg
                              )}
                            >
                              {empty ? (
                                <span className="text-gray-300">—</span>
                              ) : (
                                <div
                                  className={cn(
                                    "tabular-nums leading-tight",
                                    text
                                  )}
                                >
                                  <div className="font-semibold">
                                    {patched.demand.toFixed(1)}
                                  </div>
                                  <div className="text-[10px] opacity-60">
                                    /{patched.supply.toFixed(1)}
                                  </div>
                                  <div className="text-[10px] font-medium">
                                    {patchedUtilPct !== null
                                      ? patchedUtilPct + "%"
                                      : "∞"}
                                  </div>
                                  {hasDelta && (
                                    <div
                                      className={cn(
                                        "mt-0.5 text-[9px] font-semibold leading-none",
                                        delta! > 0
                                          ? "text-red-500"
                                          : "text-emerald-600"
                                      )}
                                    >
                                      {delta! > 0 ? "+" : ""}
                                      {delta}%
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {/* Legend */}
              <div className="flex items-center gap-4 border-t border-gray-100 bg-gray-50 px-3 py-2 text-[10px] text-gray-500">
                <span>
                  demand / supply / util%{" "}
                  <span className="text-[9px] text-indigo-500">
                    · coloured Δ = change vs base
                  </span>
                </span>
                {[
                  { cls: "bg-green-50", label: "≤69%" },
                  { cls: "bg-white border border-gray-200", label: "70–89%" },
                  { cls: "bg-yellow-50", label: "90–110%" },
                  { cls: "bg-red-100", label: ">110%" },
                ].map(({ cls, label }) => (
                  <span key={label} className="flex items-center gap-1">
                    <span
                      className={cn("inline-block h-3 w-3 rounded-sm", cls)}
                    />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: presets + changes ──────────────────────── */}
        <div className="w-72 shrink-0 space-y-4">
          {/* Presets card */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Presets
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={applyWinTop3}
                disabled={top3Pipeline.length === 0}
                className="flex flex-col items-start gap-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-left transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-medium text-emerald-800">Win top 3</span>
                <span className="text-[10px] text-emerald-600 leading-tight">
                  pipeline → committed
                </span>
              </button>
              <button
                onClick={applyLoseTop3}
                disabled={top3Pipeline.length === 0}
                className="flex flex-col items-start gap-1 rounded-lg border border-red-200 bg-red-50 p-3 text-left transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <TrendingDown className="h-4 w-4 text-red-500" />
                <span className="text-xs font-medium text-red-800">Lose top 3</span>
                <span className="text-[10px] text-red-500 leading-tight">
                  archive pipeline
                </span>
              </button>
              <button
                onClick={() => setHireModal(true)}
                className="flex flex-col items-start gap-1 rounded-lg border border-blue-200 bg-blue-50 p-3 text-left transition-colors hover:bg-blue-100"
              >
                <UserPlus className="h-4 w-4 text-blue-600" />
                <span className="text-xs font-medium text-blue-800">Hire 1 person</span>
                <span className="text-[10px] text-blue-500 leading-tight">
                  add virtual FTE
                </span>
              </button>
              <button
                onClick={() => setPushModal(true)}
                disabled={patchedProjects.length === 0}
                className="flex flex-col items-start gap-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CalendarArrowUp className="h-4 w-4 text-amber-600" />
                <span className="text-xs font-medium text-amber-800">Push project</span>
                <span className="text-[10px] text-amber-600 leading-tight">
                  shift allocations
                </span>
              </button>
            </div>
            {top3Pipeline.length > 0 && (
              <p className="mt-2.5 text-[10px] text-gray-400">
                Top {top3Pipeline.length} by FTE:{" "}
                {top3Pipeline.map((p) => p.name).join(", ")}
              </p>
            )}
          </div>

          {/* Changes card */}
          {changeCount > 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Changes ({changeCount})
                </h3>
                <button
                  onClick={() => setPatch(EMPTY_PATCH)}
                  className="text-[10px] text-gray-400 transition-colors hover:text-red-500"
                >
                  Clear all
                </button>
              </div>
              <ul className="space-y-2">
                {/* Project overrides */}
                {Object.entries(patch.projectOverrides).map(([id, ov]) => {
                  const name = projectNameById[id] ?? id;
                  const orig = projects.find((p) => p.id === id);
                  const desc = ov.archived
                    ? "archived"
                    : ov.status
                    ? `${orig?.status ?? "?"} → ${ov.status}`
                    : "modified";
                  return (
                    <li key={`ov-${id}`} className="flex items-start gap-1.5">
                      <span
                        className={cn(
                          "mt-1 h-2 w-2 shrink-0 rounded-full",
                          ov.archived ? "bg-red-400" : "bg-emerald-400"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-gray-800">
                          {name}
                        </div>
                        <div className="text-[10px] text-gray-500">{desc}</div>
                      </div>
                      <button
                        onClick={() => removeProjectOverride(id)}
                        className="shrink-0 text-gray-300 transition-colors hover:text-red-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  );
                })}

                {/* Allocation shifts */}
                {Object.entries(patch.allocationShifts).map(([id, shift]) => (
                  <li key={`shift-${id}`} className="flex items-start gap-1.5">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-gray-800">
                        {projectNameById[id] ?? id}
                      </div>
                      <div className="text-[10px] text-gray-500">pushed +{shift}wk</div>
                    </div>
                    <button
                      onClick={() => removeAllocationShift(id)}
                      className="shrink-0 text-gray-300 transition-colors hover:text-red-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}

                {/* Virtual people */}
                {patch.addedPeople.map((vp) => {
                  const sen = seniorityById[vp.seniorityId];
                  return (
                    <li key={vp.id} className="flex items-start gap-1.5">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-gray-800">
                          {vp.fullName}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          {sen
                            ? `${sen.role.team.name} · ${sen.name} · ${vp.baseCapacity} FTE`
                            : `${vp.baseCapacity} FTE`}
                        </div>
                      </div>
                      <button
                        onClick={() => removeVirtualPerson(vp.id)}
                        className="shrink-0 text-gray-300 transition-colors hover:text-red-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 p-5 text-center">
              <FlaskConical className="mx-auto mb-2 h-6 w-6 text-gray-300" />
              <p className="text-xs text-gray-400">
                No changes yet. Use a preset above to start exploring scenarios.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
