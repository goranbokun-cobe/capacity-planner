import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addWeeks } from "@/lib/weeks";
import { collectPayload } from "@/lib/snapshot-payload";

interface ProjectOverride {
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
  projectOverrides?: Record<string, ProjectOverride>;
  allocationShifts?: Record<string, number>;
  addedPeople?: VirtualPerson[];
}

/**
 * POST /api/whatif/snapshot
 * Collect live payload, apply what-if patch, save as a named snapshot.
 * Body: { label: string, patch: WhatIfPatch }
 */
export async function POST(req: Request) {
  const { label, patch }: { label: string; patch: WhatIfPatch } = await req.json();

  if (!label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const payload = await collectPayload();

  const projectOverrides = patch.projectOverrides ?? {};
  const allocationShifts = patch.allocationShifts ?? {};
  const addedPeople = patch.addedPeople ?? [];

  // IDs of projects being archived in this what-if
  const archivedIds = new Set(
    Object.entries(projectOverrides)
      .filter(([, ov]) => ov.archived)
      .map(([id]) => id)
  );

  // Apply project overrides (status / probability) and filter archived
  payload.projects = payload.projects
    .filter((p) => !archivedIds.has(p.id))
    .map((p) => {
      const ov = projectOverrides[p.id];
      if (!ov) return p;
      return {
        ...p,
        status: ov.status ?? p.status,
        probability: ov.probability !== undefined ? ov.probability : p.probability,
      };
    });

  // Remove allocations for archived projects + shift remaining ones
  payload.allocations = payload.allocations
    .filter((a) => !archivedIds.has(a.projectId))
    .map((a) => {
      const shift = allocationShifts[a.projectId] ?? 0;
      return shift ? { ...a, weekId: addWeeks(a.weekId, shift) } : a;
    });

  // Add virtual people (labelled "(what-if)" so they're recognisable in the snapshot)
  for (const vp of addedPeople) {
    payload.people.push({
      id: vp.id,
      seniorityId: vp.seniorityId,
      fullName: `${vp.fullName} (what-if)`,
      email: null,
      baseCapacity: vp.baseCapacity,
      startDate: null,
      endDate: null,
      productiveId: null,
      holidayCalendarId: null,
      archivedAt: null,
    });
  }

  const changeCount =
    Object.keys(projectOverrides).length +
    Object.keys(allocationShifts).length +
    addedPeople.length;

  const snapshot = await prisma.snapshot.create({
    data: {
      label: label.trim(),
      notes: `What-if snapshot — ${changeCount} change${changeCount !== 1 ? "s" : ""} applied`,
      payload: JSON.stringify(payload),
    },
    select: { id: true, label: true, takenAt: true, notes: true },
  });

  return NextResponse.json(snapshot, { status: 201 });
}
