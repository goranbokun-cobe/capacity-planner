import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { SnapshotPayload } from "@/lib/snapshots";
import { collectPayload } from "@/lib/snapshot-payload";

/**
 * POST /api/snapshots/[id]/restore
 * 1. Auto-snapshot the current state as "Pre-restore (auto)".
 * 2. Clear all mutable planner data.
 * 3. Repopulate from the snapshot payload.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const snapshot = await prisma.snapshot.findUnique({ where: { id } });
  if (!snapshot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload: SnapshotPayload = JSON.parse(snapshot.payload);

  // ── 1. Auto-snapshot current state ──────────────────────────────────────
  const preRestorePayload = await collectPayload();
  const preRestoreSnapshot = await prisma.snapshot.create({
    data: {
      label: `Pre-restore (auto) — before restoring "${snapshot.label}"`,
      payload: JSON.stringify(preRestorePayload),
    },
    select: { id: true, label: true, takenAt: true },
  });

  // ── 2. Wipe all mutable data (children before parents) ──────────────────
  await prisma.allocation.deleteMany({});
  await prisma.capacityOverride.deleteMany({});
  await prisma.productiveProjectAlias.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.person.deleteMany({});
  await prisma.seniorityTier.deleteMany({});
  await prisma.role.deleteMany({});
  await prisma.team.deleteMany({});

  // ── 3. Repopulate from payload ───────────────────────────────────────────
  if (payload.teams.length) {
    await prisma.team.createMany({
      data: payload.teams.map((t) => ({
        id: t.id, name: t.name, displayOrder: t.displayOrder,
        archivedAt: t.archivedAt ? new Date(t.archivedAt) : null,
      })),
    });
  }
  if (payload.roles.length) {
    await prisma.role.createMany({
      data: payload.roles.map((r) => ({
        id: r.id, teamId: r.teamId, name: r.name, displayOrder: r.displayOrder,
        archivedAt: r.archivedAt ? new Date(r.archivedAt) : null,
      })),
    });
  }
  if (payload.seniorities.length) {
    await prisma.seniorityTier.createMany({
      data: payload.seniorities.map((s) => ({
        id: s.id, roleId: s.roleId, name: s.name, level: s.level,
        defaultCapacity: s.defaultCapacity,
        archivedAt: s.archivedAt ? new Date(s.archivedAt) : null,
      })),
    });
  }
  if (payload.people.length) {
    await prisma.person.createMany({
      data: payload.people.map((p) => ({
        id: p.id, seniorityId: p.seniorityId, fullName: p.fullName,
        email: p.email ?? undefined, baseCapacity: p.baseCapacity,
        startDate: p.startDate ? new Date(p.startDate) : null,
        endDate: p.endDate ? new Date(p.endDate) : null,
        productiveId: p.productiveId ?? undefined,
        holidayCalendarId: p.holidayCalendarId ?? undefined,
        archivedAt: p.archivedAt ? new Date(p.archivedAt) : null,
      })),
    });
  }
  if (payload.overrides.length) {
    await prisma.capacityOverride.createMany({
      data: payload.overrides.map((o) => ({
        personId: o.personId, weekId: o.weekId, capacity: o.capacity,
        reason: o.reason ?? undefined, source: o.source,
      })),
    });
  }
  if (payload.projects.length) {
    await prisma.project.createMany({
      data: payload.projects.map((p) => ({
        id: p.id, name: p.name, clientName: p.clientName ?? undefined,
        status: p.status, probability: p.probability ?? undefined,
        pipelineCalcMode: p.pipelineCalcMode ?? undefined,
        startWeekId: p.startWeekId, endWeekId: p.endWeekId,
        productiveDealId: p.productiveDealId ?? undefined,
        productiveProjectId: p.productiveProjectId ?? undefined,
        notes: p.notes ?? undefined,
        archivedAt: p.archivedAt ? new Date(p.archivedAt) : null,
      })),
    });
  }
  if (payload.aliases.length) {
    await prisma.productiveProjectAlias.createMany({
      data: payload.aliases.map((a) => ({
        plannerProjectId: a.plannerProjectId,
        productiveProjectId: a.productiveProjectId,
      })),
    });
  }
  if (payload.allocations.length) {
    await prisma.allocation.createMany({
      data: payload.allocations.map((a) => ({
        projectId: a.projectId, weekId: a.weekId, seniorityId: a.seniorityId,
        fte: a.fte, source: a.source,
      })),
    });
  }
  if (payload.settings) {
    await prisma.pipelineSettings.upsert({
      where: { id: 1 },
      update: {
        defaultCalcMode: payload.settings.defaultCalcMode,
        colorBands: payload.settings.colorBands,
      },
      create: {
        id: 1,
        defaultCalcMode: payload.settings.defaultCalcMode,
        colorBands: payload.settings.colorBands,
      },
    });
  }

  return NextResponse.json({
    restored: snapshot.label,
    preRestoreSnapshotId: preRestoreSnapshot.id,
    preRestoreLabel: preRestoreSnapshot.label,
  });
}
