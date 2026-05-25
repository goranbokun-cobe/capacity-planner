import { prisma } from "@/lib/db";
import { WhatIfClient } from "./WhatIfClient";
import { DEFAULT_COLOR_BANDS } from "@/lib/projects";
import { getCurrentWeekId, dateToWeekId } from "@/lib/weeks";

export const dynamic = "force-dynamic";

export default async function WhatIfPage() {
  const [people, projects, seniorities, settings, rawHolidays] = await Promise.all([
    prisma.person.findMany({
      where: {
        archivedAt: null,
        seniority: { role: { archivedAt: null, team: { archivedAt: null } } },
      },
      include: {
        seniority: { include: { role: { include: { team: true } } } },
        overrides: { select: { weekId: true, capacity: true }, orderBy: { weekId: "asc" } },
      },
    }),
    prisma.project.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        probability: true,
        pipelineCalcMode: true,
        allocations: { select: { seniorityId: true, weekId: true, fte: true } },
      },
    }),
    prisma.seniorityTier.findMany({
      where: { archivedAt: null, role: { archivedAt: null, team: { archivedAt: null } } },
      select: {
        id: true,
        name: true,
        role: {
          select: {
            id: true,
            name: true,
            team: { select: { id: true, name: true, displayOrder: true } },
          },
        },
      },
    }),
    prisma.pipelineSettings.findFirst(),
    prisma.holiday.findMany({ select: { calendarId: true, date: true } }),
  ]);

  const defaultCalcMode = (settings?.defaultCalcMode ?? "weighted") as "weighted" | "full";

  const holidayLookup: Record<string, number> = {};
  for (const h of rawHolidays) {
    const weekId = dateToWeekId(h.date);
    const key = `${h.calendarId}:${weekId}`;
    holidayLookup[key] = (holidayLookup[key] ?? 0) + 1;
  }

  const serializedPeople = people.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    baseCapacity: p.baseCapacity,
    startWeekId: p.startDate ? dateToWeekId(p.startDate) : null,
    endWeekId: p.endDate ? dateToWeekId(p.endDate) : null,
    seniorityId: p.seniorityId,
    seniority: p.seniority,
    overrides: p.overrides,
    holidayCalendarId: p.holidayCalendarId ?? null,
  }));

  return (
    <div className="p-6">
      <WhatIfClient
        people={serializedPeople}
        projects={projects}
        seniorities={seniorities}
        defaultCalcMode={defaultCalcMode}
        currentWeek={getCurrentWeekId()}
        holidayLookup={holidayLookup}
      />
    </div>
  );
}
