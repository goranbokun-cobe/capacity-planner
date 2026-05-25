import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseISO, isValid } from "date-fns";
import { getCurrentWeekId, addWeeks, dateToWeekId } from "@/lib/weeks";
import { fetchActiveProjects } from "@/lib/productive/projects";
import { fetchProjectBookings, type PersonWeekFte, type BookingPersonInfo } from "@/lib/productive/bookings";

/** Preview: fetch active Productive projects + existing planner projects. */
export async function GET() {
  const [remoteProjects, existingProjects, linkedDirect, linkedViaAlias] =
    await Promise.all([
      fetchActiveProjects(),
      prisma.project.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true, clientName: true },
        orderBy: { name: "asc" },
      }),
      // Projects linked via their primary productiveProjectId
      prisma.project.findMany({
        where: { productiveProjectId: { not: null }, archivedAt: null },
        select: {
          id: true,
          name: true,
          clientName: true,
          startWeekId: true,
          endWeekId: true,
          productiveProjectId: true,
        },
      }),
      // Projects linked via an alias (grouped imports)
      prisma.productiveProjectAlias.findMany({
        include: {
          plannerProject: {
            select: {
              id: true,
              name: true,
              clientName: true,
              startWeekId: true,
              endWeekId: true,
              productiveProjectId: true,
              archivedAt: true,
            },
          },
        },
      }),
    ]);

  // One entry per PLANNER project — primary ID + alias IDs combined.
  type LinkedEntry = {
    id: string;             // planner project id
    name: string;
    clientName: string | null;
    startWeekId: string;
    endWeekId: string;
    productiveProjectId: string;  // primary productive project id
    aliasIds: string[];           // additional productive project ids (grouped)
  };

  // key = planner project id
  const byPlanner = new Map<string, LinkedEntry>();

  for (const p of linkedDirect) {
    byPlanner.set(p.id, {
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      startWeekId: p.startWeekId,
      endWeekId: p.endWeekId,
      productiveProjectId: p.productiveProjectId!,
      aliasIds: [],
    });
  }
  for (const alias of linkedViaAlias) {
    if (alias.plannerProject.archivedAt) continue;
    const pid = alias.plannerProject.id;
    if (byPlanner.has(pid)) {
      byPlanner.get(pid)!.aliasIds.push(alias.productiveProjectId);
    } else {
      // project has aliases but no direct productiveProjectId (edge case)
      byPlanner.set(pid, {
        id: pid,
        name: alias.plannerProject.name,
        clientName: alias.plannerProject.clientName,
        startWeekId: alias.plannerProject.startWeekId,
        endWeekId: alias.plannerProject.endWeekId,
        productiveProjectId: alias.productiveProjectId,
        aliasIds: [],
      });
    }
  }

  const linkedPlannerProjects = [...byPlanner.values()];

  return NextResponse.json({ remoteProjects, existingProjects, linkedPlannerProjects });
}

/** Delete all projects imported from Productive project sync. */
export async function DELETE() {
  const imported = await prisma.project.findMany({
    where: { productiveProjectId: { not: null } },
    select: { id: true },
  });
  const ids = imported.map((p) => p.id);
  if (ids.length > 0) {
    await prisma.allocation.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
    // Aliases cascade-delete via onDelete: Cascade
  }
  return NextResponse.json({ deleted: ids.length });
}

// ── Import payload ───────────────────────────────────────────────────────────

interface ProjectImportRow {
  projectId: string;           // primary Productive project ID
  aliasIds: string[];          // other Productive IDs grouped into this one
  name: string;
  clientName: string | null;
  startDate: string | null;
  endDate: string | null;
  /** If set, update this existing planner project instead of creating a new one. */
  plannerProjectId: string | null;
  importBookings: boolean;     // if true, pull resource bookings and create allocations
}

interface ImportBody {
  projects: ProjectImportRow[];
  /** Planner project IDs to permanently delete (linked rows unchecked by user). */
  deleteIds?: string[];
}

function toWeekId(dateStr: string | null, fallback: string): string {
  if (!dateStr) return fallback;
  const d = parseISO(dateStr);
  return isValid(d) ? dateToWeekId(d) : fallback;
}

/** For open-ended or very long projects, cap the stored startWeekId so it doesn't predate
 *  the current planning horizon by more than one year. This keeps the allocation editor
 *  opening in a useful date range rather than years of empty history. */
function clampStartWeekId(weekId: string, currentWeek: string): string {
  const oneYearAgo = addWeeks(currentWeek, -52);
  return weekId < oneYearAgo ? oneYearAgo : weekId;
}

/** Import selected projects (create/update planner projects + optional allocations). */
export async function POST(req: Request) {
  const body: ImportBody | ProjectImportRow[] = await req.json();
  // Support both old array format and new { projects, deleteIds } format
  const rows: ProjectImportRow[] = Array.isArray(body) ? body : body.projects;
  const deleteIds: string[] = Array.isArray(body) ? [] : (body.deleteIds ?? []);

  const currentWeek = getCurrentWeekId();
  const defaultEnd = addWeeks(currentWeek, 12);
  const results = { created: 0, updated: 0, deleted: 0, allocationsWritten: 0, unmappedPersonIds: [] as string[], unmappedPersonNames: {} as Record<string, string>, errors: [] as string[] };

  // ── Delete projects that were unchecked in the linked section ────────────────
  if (deleteIds.length > 0) {
    try {
      await prisma.allocation.deleteMany({ where: { projectId: { in: deleteIds } } });
      await prisma.productiveProjectAlias.deleteMany({ where: { plannerProjectId: { in: deleteIds } } });
      const del = await prisma.project.deleteMany({ where: { id: { in: deleteIds } } });
      results.deleted = del.count;
    } catch (err) {
      results.errors.push(`Delete failed: ${String(err)}`);
    }
  }

  // ── Load the person → seniority mapping once (for allocation import) ────────
  const people = await prisma.person.findMany({
    where: { archivedAt: null, productiveId: { not: null } },
    select: { productiveId: true, seniorityId: true },
  });
  const personToSeniority = new Map(
    people.map((p) => [p.productiveId!, p.seniorityId])
  );

  // ── Collect Productive IDs that need booking data ────────────────────────────
  const rowsNeedingBookings = rows.filter((r) => r.importBookings);
  let bookingsMap: Map<string, PersonWeekFte[]> = new Map();
  let bookingPersonInfo: Map<string, BookingPersonInfo> = new Map();

  if (rowsNeedingBookings.length > 0) {
    const allProductiveIds = rowsNeedingBookings.flatMap((r) => [
      r.projectId,
      ...r.aliasIds,
    ]);
    try {
      const fetchResult = await fetchProjectBookings(allProductiveIds);
      bookingsMap = fetchResult.bookings;
      bookingPersonInfo = fetchResult.personInfo;
    } catch (err) {
      results.errors.push(`Booking fetch failed: ${String(err)}`);
    }
  }

  // ── Process each row ─────────────────────────────────────────────────────────
  for (const row of rows) {
    try {
      const startWeekId = clampStartWeekId(toWeekId(row.startDate, currentWeek), currentWeek);
      const endWeekId = toWeekId(row.endDate, defaultEnd);
      let plannerProjectId: string;

      if (row.plannerProjectId) {
        // Update existing planner project (linked section)
        await prisma.project.update({
          where: { id: row.plannerProjectId },
          data: { name: row.name, clientName: row.clientName, startWeekId, endWeekId, archivedAt: null },
        });
        plannerProjectId = row.plannerProjectId;
        results.updated++;
      } else {
        // Find by primary Productive ID or create
        const existing = await prisma.project.findUnique({
          where: { productiveProjectId: row.projectId },
        });

        if (existing) {
          // Also clears archivedAt so a previously-archived project gets restored
          await prisma.project.update({
            where: { id: existing.id },
            data: { name: row.name, clientName: row.clientName, startWeekId, endWeekId, archivedAt: null },
          });
          plannerProjectId = existing.id;
          results.updated++;
        } else {
          // Also check if any aliasId already maps to a planner project
          const aliasMapped = row.aliasIds.length > 0
            ? await prisma.productiveProjectAlias.findFirst({
                where: { productiveProjectId: { in: row.aliasIds } },
              })
            : null;

          if (aliasMapped) {
            await prisma.project.update({
              where: { id: aliasMapped.plannerProjectId },
              data: { name: row.name, clientName: row.clientName, startWeekId, endWeekId, archivedAt: null },
            });
            plannerProjectId = aliasMapped.plannerProjectId;
            results.updated++;
          } else {
            // Auto-detect internal COBE overhead projects
            const isInternal = row.clientName === "COBE" || row.clientName === "COBE GmbH";
            const created = await prisma.project.create({
              data: {
                name: row.name,
                clientName: row.clientName,
                status: isInternal ? "internal" : "running",
                startWeekId,
                endWeekId,
                productiveProjectId: row.projectId,
              },
            });
            plannerProjectId = created.id;
            results.created++;
          }
        }
      }

      // ── Upsert aliases for grouped Productive IDs ──────────────────────────
      for (const aliasId of row.aliasIds) {
        await prisma.productiveProjectAlias.upsert({
          where: { productiveProjectId: aliasId },
          update: { plannerProjectId },
          create: { plannerProjectId, productiveProjectId: aliasId },
        });
      }

      // ── Import resource bookings as allocations ────────────────────────────
      if (row.importBookings && bookingsMap.size > 0) {
        // Collect PersonWeekFte entries from primary + all aliases
        const allProductiveIds = [row.projectId, ...row.aliasIds];
        const rawEntries: { weekId: string; productivePersonId: string; fte: number }[] = [];

        for (const pid of allProductiveIds) {
          const entries = bookingsMap.get(pid);
          if (entries) rawEntries.push(...entries);
        }

        if (rawEntries.length > 0) {
          // Aggregate by (weekId, seniorityId) — multiple people, same seniority, same week → sum FTE
          const aggregated = new Map<string, number>(); // key = "weekId::seniorityId"

          for (const entry of rawEntries) {
            const seniorityId = personToSeniority.get(entry.productivePersonId);
            if (!seniorityId) {
              if (!results.unmappedPersonIds.includes(entry.productivePersonId)) {
                results.unmappedPersonIds.push(entry.productivePersonId);
                const info = bookingPersonInfo.get(entry.productivePersonId);
                if (info) results.unmappedPersonNames[entry.productivePersonId] = info.name;
              }
              continue;
            }
            const key = `${entry.weekId}::${seniorityId}`;
            aggregated.set(key, (aggregated.get(key) ?? 0) + entry.fte);
          }

          // Load existing manual allocations so we don't overwrite them
          const manualAllocs = await prisma.allocation.findMany({
            where: { projectId: plannerProjectId, source: "manual" },
            select: { weekId: true, seniorityId: true },
          });
          const manualKeys = new Set(
            manualAllocs.map((a) => `${a.weekId}::${a.seniorityId}`)
          );

          // Delete old productive-sourced allocations for this project
          await prisma.allocation.deleteMany({
            where: { projectId: plannerProjectId, source: "productive" },
          });

          // Insert new ones (skipping cells with a manual override)
          for (const [key, fte] of aggregated) {
            if (manualKeys.has(key)) continue;
            const [weekId, seniorityId] = key.split("::");
            await prisma.allocation.upsert({
              where: { projectId_weekId_seniorityId: { projectId: plannerProjectId, weekId, seniorityId } },
              update: { fte: Math.round(fte * 100) / 100, source: "productive" },
              create: { projectId: plannerProjectId, weekId, seniorityId, fte: Math.round(fte * 100) / 100, source: "productive" },
            });
            results.allocationsWritten++;
          }
        }
      }
    } catch (err) {
      results.errors.push(`Project ${row.projectId}: ${String(err)}`);
    }
  }

  return NextResponse.json(results);
}
