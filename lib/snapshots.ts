/**
 * Snapshot payload types and diff logic.
 * The snapshot captures the full planner state so it can be restored or diffed.
 */

// ── Payload shape ─────────────────────────────────────────────────────────────

export interface SnapshotTeam {
  id: string;
  name: string;
  displayOrder: number;
  archivedAt: string | null;
}

export interface SnapshotRole {
  id: string;
  teamId: string;
  name: string;
  displayOrder: number;
  archivedAt: string | null;
}

export interface SnapshotSeniority {
  id: string;
  roleId: string;
  name: string;
  level: number;
  defaultCapacity: number;
  archivedAt: string | null;
}

export interface SnapshotPerson {
  id: string;
  seniorityId: string;
  fullName: string;
  email: string | null;
  baseCapacity: number;
  startDate: string | null;
  endDate: string | null;
  productiveId: string | null;
  holidayCalendarId: string | null;
  archivedAt: string | null;
}

export interface SnapshotOverride {
  personId: string;
  weekId: string;
  capacity: number;
  reason: string | null;
  source: string;
}

export interface SnapshotProject {
  id: string;
  name: string;
  clientName: string | null;
  status: string;
  probability: number | null;
  pipelineCalcMode: string | null;
  startWeekId: string;
  endWeekId: string;
  productiveDealId: string | null;
  productiveProjectId: string | null;
  notes: string | null;
  archivedAt: string | null;
}

export interface SnapshotAlias {
  plannerProjectId: string;
  productiveProjectId: string;
}

export interface SnapshotAllocation {
  projectId: string;
  weekId: string;
  seniorityId: string;
  fte: number;
  source: string;
}

export interface SnapshotSettings {
  defaultCalcMode: string;
  colorBands: string;
}

export interface SnapshotPayload {
  version: 1;
  teams: SnapshotTeam[];
  roles: SnapshotRole[];
  seniorities: SnapshotSeniority[];
  people: SnapshotPerson[];
  overrides: SnapshotOverride[];
  projects: SnapshotProject[];
  aliases: SnapshotAlias[];
  allocations: SnapshotAllocation[];
  settings: SnapshotSettings | null;
}

// ── Diff types ────────────────────────────────────────────────────────────────

export interface ProjectChange {
  id: string;
  name: string;
  changes: string[]; // human-readable: "status: running → committed"
}

export interface AllocationDelta {
  projectId: string;
  projectName: string;
  /** Total FTE change across all weeks/seniorities for this project. */
  deltaFte: number;
}

export interface PersonChange {
  id: string;
  fullName: string;
  changes: string[];
}

export interface SnapshotDiff {
  projectsAdded: Pick<SnapshotProject, "id" | "name" | "status" | "probability">[];
  projectsRemoved: Pick<SnapshotProject, "id" | "name" | "status">[];
  projectsChanged: ProjectChange[];
  allocationDeltas: AllocationDelta[];  // only projects with net change
  peopleAdded: Pick<SnapshotPerson, "id" | "fullName">[];
  peopleRemoved: Pick<SnapshotPerson, "id" | "fullName">[];
  peopleChanged: PersonChange[];
  settingsChanged: string[];  // human-readable lines
  /** Quick summary numbers */
  summary: {
    projectsAdded: number;
    projectsRemoved: number;
    projectsChanged: number;
    fteChanged: number;  // absolute sum of deltaFte
    peopleAdded: number;
    peopleRemoved: number;
    peopleChanged: number;
  };
}

// ── Diff computation ──────────────────────────────────────────────────────────

export function diffPayloads(
  snapshot: SnapshotPayload,
  current: SnapshotPayload
): SnapshotDiff {
  // ── Projects ──────────────────────────────────────────────────────────────
  const snapProjects = new Map(snapshot.projects.map((p) => [p.id, p]));
  const currProjects = new Map(current.projects.map((p) => [p.id, p]));

  const projectsAdded: SnapshotDiff["projectsAdded"] = [];
  const projectsRemoved: SnapshotDiff["projectsRemoved"] = [];
  const projectsChanged: ProjectChange[] = [];

  for (const [id, cp] of currProjects) {
    if (!snapProjects.has(id)) {
      projectsAdded.push({ id, name: cp.name, status: cp.status, probability: cp.probability });
    }
  }
  for (const [id, sp] of snapProjects) {
    if (!currProjects.has(id)) {
      projectsRemoved.push({ id, name: sp.name, status: sp.status });
    } else {
      const cp = currProjects.get(id)!;
      const changes: string[] = [];
      if (sp.name !== cp.name) changes.push(`name: "${sp.name}" → "${cp.name}"`);
      if (sp.status !== cp.status) changes.push(`status: ${sp.status} → ${cp.status}`);
      if (sp.probability !== cp.probability) changes.push(`probability: ${sp.probability ?? "—"} → ${cp.probability ?? "—"}`);
      if (sp.startWeekId !== cp.startWeekId) changes.push(`start: ${sp.startWeekId} → ${cp.startWeekId}`);
      if (sp.endWeekId !== cp.endWeekId) changes.push(`end: ${sp.endWeekId} → ${cp.endWeekId}`);
      if ((sp.archivedAt === null) !== (cp.archivedAt === null)) {
        changes.push(cp.archivedAt ? "archived" : "unarchived");
      }
      if (changes.length) projectsChanged.push({ id, name: cp.name, changes });
    }
  }

  // ── Allocations ───────────────────────────────────────────────────────────
  // Map: projectId → total FTE in that payload
  function allocTotals(allocs: SnapshotAllocation[]) {
    const m = new Map<string, number>();
    for (const a of allocs) {
      m.set(a.projectId, (m.get(a.projectId) ?? 0) + a.fte);
    }
    return m;
  }
  const snapAllocTotals = allocTotals(snapshot.allocations);
  const currAllocTotals = allocTotals(current.allocations);

  // Collect all project IDs that appear in either payload
  const allAllocProjectIds = new Set([
    ...snapAllocTotals.keys(),
    ...currAllocTotals.keys(),
  ]);

  const allocationDeltas: AllocationDelta[] = [];
  for (const pid of allAllocProjectIds) {
    const snapTotal = snapAllocTotals.get(pid) ?? 0;
    const currTotal = currAllocTotals.get(pid) ?? 0;
    const delta = Math.round((currTotal - snapTotal) * 10) / 10;
    if (Math.abs(delta) >= 0.05) {
      const name =
        currProjects.get(pid)?.name ??
        snapProjects.get(pid)?.name ??
        pid;
      allocationDeltas.push({ projectId: pid, projectName: name, deltaFte: delta });
    }
  }
  allocationDeltas.sort((a, b) => Math.abs(b.deltaFte) - Math.abs(a.deltaFte));

  // ── People ────────────────────────────────────────────────────────────────
  const snapPeople = new Map(snapshot.people.map((p) => [p.id, p]));
  const currPeople = new Map(current.people.map((p) => [p.id, p]));

  const peopleAdded: SnapshotDiff["peopleAdded"] = [];
  const peopleRemoved: SnapshotDiff["peopleRemoved"] = [];
  const peopleChanged: PersonChange[] = [];

  for (const [id, cp] of currPeople) {
    if (!snapPeople.has(id)) peopleAdded.push({ id, fullName: cp.fullName });
  }
  for (const [id, sp] of snapPeople) {
    if (!currPeople.has(id)) {
      peopleRemoved.push({ id, fullName: sp.fullName });
    } else {
      const cp = currPeople.get(id)!;
      const changes: string[] = [];
      if (sp.fullName !== cp.fullName) changes.push(`name: "${sp.fullName}" → "${cp.fullName}"`);
      if (sp.baseCapacity !== cp.baseCapacity) changes.push(`capacity: ${sp.baseCapacity} → ${cp.baseCapacity}`);
      if (sp.seniorityId !== cp.seniorityId) changes.push("seniority changed");
      if ((sp.archivedAt === null) !== (cp.archivedAt === null)) {
        changes.push(cp.archivedAt ? "archived" : "unarchived");
      }
      if (changes.length) peopleChanged.push({ id, fullName: cp.fullName, changes });
    }
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  const settingsChanged: string[] = [];
  if (snapshot.settings && current.settings) {
    if (snapshot.settings.defaultCalcMode !== current.settings.defaultCalcMode) {
      settingsChanged.push(
        `pipeline mode: ${snapshot.settings.defaultCalcMode} → ${current.settings.defaultCalcMode}`
      );
    }
  }

  const fteChanged = allocationDeltas.reduce((s, d) => s + Math.abs(d.deltaFte), 0);

  return {
    projectsAdded,
    projectsRemoved,
    projectsChanged,
    allocationDeltas,
    peopleAdded,
    peopleRemoved,
    peopleChanged,
    settingsChanged,
    summary: {
      projectsAdded: projectsAdded.length,
      projectsRemoved: projectsRemoved.length,
      projectsChanged: projectsChanged.length,
      fteChanged: Math.round(fteChanged * 10) / 10,
      peopleAdded: peopleAdded.length,
      peopleRemoved: peopleRemoved.length,
      peopleChanged: peopleChanged.length,
    },
  };
}
