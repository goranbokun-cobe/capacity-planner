import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseISO, isValid } from "date-fns";
import { getCurrentWeekId, addWeeks, dateToWeekId } from "@/lib/weeks";

/** Delete all projects imported from Productive (those with a productiveDealId). */
export async function DELETE() {
  const imported = await prisma.project.findMany({
    where: { productiveDealId: { not: null } },
    select: { id: true },
  });
  const ids = imported.map((p) => p.id);
  if (ids.length > 0) {
    await prisma.allocation.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
  }
  return NextResponse.json({ deleted: ids.length });
}

export interface ImportRow {
  dealId: string;
  name: string;
  clientName: string | null;
  probability: number;
  stageStatus: "open" | "won" | "lost";
  startDate: string | null;
  endDate: string | null;
  /** If set, link this deal to an existing project instead of creating a new one. */
  linkToProjectId: string | null;
}

function toWeekId(dateStr: string | null, fallback: string): string {
  if (!dateStr) return fallback;
  const d = parseISO(dateStr);
  return isValid(d) ? dateToWeekId(d) : fallback;
}

/** Import selected deals. */
export async function POST(req: Request) {
  const rows: ImportRow[] = await req.json();
  const currentWeek = getCurrentWeekId();
  const defaultEnd = addWeeks(currentWeek, 12);
  const results = { created: 0, linked: 0, errors: [] as string[] };

  for (const row of rows) {
    try {
      if (row.linkToProjectId) {
        // Clear any existing productiveDealId on this project first, then link
        await prisma.project.update({
          where: { id: row.linkToProjectId },
          data: { productiveDealId: row.dealId },
        });
        results.linked++;
      } else {
        const status = row.stageStatus === "won" ? "committed" : "pipeline";
        const startWeekId = toWeekId(row.startDate, currentWeek);
        const endWeekId = toWeekId(row.endDate, defaultEnd);

        const existing = await prisma.project.findUnique({
          where: { productiveDealId: row.dealId },
        });

        if (existing) {
          await prisma.project.update({
            where: { id: existing.id },
            data: { name: row.name, clientName: row.clientName, status, probability: row.probability, startWeekId, endWeekId },
          });
          results.created++;
        } else {
          await prisma.project.create({
            data: { name: row.name, clientName: row.clientName, status, probability: row.probability, startWeekId, endWeekId, productiveDealId: row.dealId },
          });
          results.created++;
        }
      }
    } catch (err) {
      results.errors.push(`Deal ${row.dealId}: ${String(err)}`);
    }
  }

  return NextResponse.json(results);
}
