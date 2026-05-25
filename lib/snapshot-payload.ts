/**
 * Collect the full planner state into a SnapshotPayload.
 * Lives in /lib so it can be imported by multiple API routes without
 * violating Next.js's restriction that route files may only export HTTP methods.
 */

import { prisma } from "@/lib/db";
import type { SnapshotPayload } from "@/lib/snapshots";

export async function collectPayload(): Promise<SnapshotPayload> {
  const [
    teams, roles, seniorities, people, overrides,
    projects, aliases, allocations, settings,
  ] = await Promise.all([
    prisma.team.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.role.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.seniorityTier.findMany({ orderBy: { level: "asc" } }),
    prisma.person.findMany(),
    prisma.capacityOverride.findMany(),
    prisma.project.findMany(),
    prisma.productiveProjectAlias.findMany(),
    prisma.allocation.findMany(),
    prisma.pipelineSettings.findFirst(),
  ]);

  return {
    version: 1,
    teams: teams.map((t) => ({
      id: t.id, name: t.name, displayOrder: t.displayOrder,
      archivedAt: t.archivedAt?.toISOString() ?? null,
    })),
    roles: roles.map((r) => ({
      id: r.id, teamId: r.teamId, name: r.name, displayOrder: r.displayOrder,
      archivedAt: r.archivedAt?.toISOString() ?? null,
    })),
    seniorities: seniorities.map((s) => ({
      id: s.id, roleId: s.roleId, name: s.name, level: s.level,
      defaultCapacity: s.defaultCapacity,
      archivedAt: s.archivedAt?.toISOString() ?? null,
    })),
    people: people.map((p) => ({
      id: p.id, seniorityId: p.seniorityId, fullName: p.fullName,
      email: p.email ?? null, baseCapacity: p.baseCapacity,
      startDate: p.startDate?.toISOString() ?? null,
      endDate: p.endDate?.toISOString() ?? null,
      productiveId: p.productiveId ?? null,
      holidayCalendarId: p.holidayCalendarId ?? null,
      archivedAt: p.archivedAt?.toISOString() ?? null,
    })),
    overrides: overrides.map((o) => ({
      personId: o.personId, weekId: o.weekId, capacity: o.capacity,
      reason: o.reason ?? null, source: o.source,
    })),
    projects: projects.map((p) => ({
      id: p.id, name: p.name, clientName: p.clientName ?? null,
      status: p.status, probability: p.probability ?? null,
      pipelineCalcMode: p.pipelineCalcMode ?? null,
      startWeekId: p.startWeekId, endWeekId: p.endWeekId,
      productiveDealId: p.productiveDealId ?? null,
      productiveProjectId: p.productiveProjectId ?? null,
      notes: p.notes ?? null,
      archivedAt: p.archivedAt?.toISOString() ?? null,
    })),
    aliases: aliases.map((a) => ({
      plannerProjectId: a.plannerProjectId,
      productiveProjectId: a.productiveProjectId,
    })),
    allocations: allocations.map((a) => ({
      projectId: a.projectId, weekId: a.weekId, seniorityId: a.seniorityId,
      fte: a.fte, source: a.source,
    })),
    settings: settings
      ? { defaultCalcMode: settings.defaultCalcMode, colorBands: settings.colorBands }
      : null,
  };
}
