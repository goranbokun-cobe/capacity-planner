import type { PrismaClient } from "@prisma/client";
import { parseISO, isValid, getDay } from "date-fns";
import { fetchProductiveDeals } from "./deals";
import { fetchAbsenceBookings } from "./timeoff";
import {
  getCurrentWeekId,
  addWeeks,
  dateToWeekId,
  getWeeksInRange,
  weekIdToRange,
  weekIdToMonday,
} from "../weeks";

export interface SyncStats {
  deals: { created: number; updated: number; unchanged: number };
  timeOff: { created: number; updated: number };
  errors: string[];
}

function dealStatus(stageStatus: "open" | "won" | "lost"): string {
  return stageStatus === "won" ? "committed" : "pipeline";
}

function parseDateToWeekId(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = parseISO(dateStr);
  return isValid(d) ? dateToWeekId(d) : null;
}

/** Count Mon–Fri days that fall within both the ISO week and the absence range. */
function workingDaysOverlap(
  weekStart: Date,
  weekEnd: Date,
  absStart: Date,
  absEnd: Date
): number {
  const from = absStart > weekStart ? absStart : weekStart;
  const to = absEnd < weekEnd ? absEnd : weekEnd;
  if (from > to) return 0;

  let count = 0;
  const cur = new Date(from);
  while (cur <= to) {
    const dow = getDay(cur); // 0 = Sun, 6 = Sat
    if (dow >= 1 && dow <= 5) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/** Sync only absence bookings (time-off). Used by the automatic sync button. */
export async function runTimeOffSync(
  prisma: PrismaClient
): Promise<Pick<SyncStats, "timeOff" | "errors">> {
  const result: Pick<SyncStats, "timeOff" | "errors"> = {
    timeOff: { created: 0, updated: 0 },
    errors: [],
  };
  const currentWeek = getCurrentWeekId();
  // Use a rolling 4-week lookback — matches the project bookings cutoff strategy.
  // Absence bookings that ended before this date are already in the DB from prior syncs.
  const cutoff = weekIdToMonday(addWeeks(currentWeek, -4));
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  try {
    const bookings = await fetchAbsenceBookings(cutoffDate);
    const people = await prisma.person.findMany({
      where: { productiveId: { not: null } },
      select: { id: true, productiveId: true, baseCapacity: true },
    });
    const personByProductiveId = new Map(people.map((p) => [p.productiveId!, p]));

    for (const booking of bookings) {
      try {
        const person = personByProductiveId.get(booking.personProductiveId);
        if (!person) continue;
        const absStart = parseISO(booking.startedOn);
        const absEnd = parseISO(booking.endedOn);
        if (!isValid(absStart) || !isValid(absEnd)) continue;
        for (const weekId of getWeeksInRange(dateToWeekId(absStart), dateToWeekId(absEnd))) {
          const { start: weekStart, end: weekEnd } = weekIdToRange(weekId);
          const absentDays = workingDaysOverlap(weekStart, weekEnd, absStart, absEnd);
          if (absentDays === 0) continue;
          const reducedCapacity =
            Math.round(Math.max(0, person.baseCapacity * (1 - absentDays / 5)) * 10) / 10;
          const existing = await prisma.capacityOverride.findUnique({
            where: { personId_weekId: { personId: person.id, weekId } },
          });
          if (existing) {
            if (existing.source === "manual") continue;
            if (existing.capacity !== reducedCapacity) {
              await prisma.capacityOverride.update({
                where: { id: existing.id },
                data: { capacity: reducedCapacity },
              });
              result.timeOff.updated++;
            }
          } else {
            await prisma.capacityOverride.create({
              data: { personId: person.id, weekId, capacity: reducedCapacity, source: "productive" },
            });
            result.timeOff.created++;
          }
        }
      } catch (err) {
        result.errors.push(`Booking ${booking.id}: ${String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Time-off fetch failed: ${String(err)}`);
  }
  return result;
}

export async function runSync(prisma: PrismaClient): Promise<SyncStats> {
  const stats: SyncStats = {
    deals: { created: 0, updated: 0, unchanged: 0 },
    timeOff: { created: 0, updated: 0 },
    errors: [],
  };

  const currentWeek = getCurrentWeekId();
  const defaultEnd = addWeeks(currentWeek, 12);
  // Rolling 4-week lookback for absence bookings (same pattern as project bookings)
  const absenceCutoff = weekIdToMonday(addWeeks(currentWeek, -4)).toISOString().slice(0, 10);

  // ── 1. Deals → Projects ──────────────────────────────────────────
  try {
    const deals = await fetchProductiveDeals();

    for (const deal of deals) {
      try {
        const status = dealStatus(deal.stageStatus);
        const startWeekId = parseDateToWeekId(deal.startDate) ?? currentWeek;
        const endWeekId = parseDateToWeekId(deal.endDate) ?? defaultEnd;

        const existing = await prisma.project.findUnique({
          where: { productiveDealId: deal.id },
        });

        if (!existing) {
          await prisma.project.create({
            data: {
              name: deal.name,
              clientName: deal.clientName,
              status,
              probability: deal.probability,
              startWeekId,
              endWeekId,
              productiveDealId: deal.id,
            },
          });
          stats.deals.created++;
        } else {
          const changed =
            existing.name !== deal.name ||
            existing.clientName !== deal.clientName ||
            existing.status !== status ||
            existing.probability !== deal.probability ||
            existing.startWeekId !== startWeekId ||
            existing.endWeekId !== endWeekId;

          if (changed) {
            await prisma.project.update({
              where: { id: existing.id },
              data: {
                name: deal.name,
                clientName: deal.clientName,
                status,
                probability: deal.probability,
                startWeekId,
                endWeekId,
              },
            });
            stats.deals.updated++;
          } else {
            stats.deals.unchanged++;
          }
        }
      } catch (err) {
        stats.errors.push(`Deal ${deal.id}: ${String(err)}`);
      }
    }
  } catch (err) {
    stats.errors.push(`Deals fetch failed: ${String(err)}`);
  }

  // ── 2. Absence bookings → CapacityOverrides ───────────────────────
  try {
    const bookings = await fetchAbsenceBookings(absenceCutoff);

    const people = await prisma.person.findMany({
      where: { productiveId: { not: null } },
      select: { id: true, productiveId: true, baseCapacity: true },
    });
    const personByProductiveId = new Map(people.map((p) => [p.productiveId!, p]));

    for (const booking of bookings) {
      try {
        const person = personByProductiveId.get(booking.personProductiveId);
        if (!person) continue;

        const absStart = parseISO(booking.startedOn);
        const absEnd = parseISO(booking.endedOn);
        if (!isValid(absStart) || !isValid(absEnd)) continue;

        const startWid = dateToWeekId(absStart);
        const endWid = dateToWeekId(absEnd);

        for (const weekId of getWeeksInRange(startWid, endWid)) {
          const { start: weekStart, end: weekEnd } = weekIdToRange(weekId);
          const absentDays = workingDaysOverlap(weekStart, weekEnd, absStart, absEnd);
          if (absentDays === 0) continue;

          const reducedCapacity =
            Math.round(Math.max(0, person.baseCapacity * (1 - absentDays / 5)) * 10) / 10;

          const existing = await prisma.capacityOverride.findUnique({
            where: { personId_weekId: { personId: person.id, weekId } },
          });

          if (existing) {
            if (existing.source === "manual") continue;
            if (existing.capacity !== reducedCapacity) {
              await prisma.capacityOverride.update({
                where: { id: existing.id },
                data: { capacity: reducedCapacity },
              });
              stats.timeOff.updated++;
            }
          } else {
            await prisma.capacityOverride.create({
              data: {
                personId: person.id,
                weekId,
                capacity: reducedCapacity,
                source: "productive",
              },
            });
            stats.timeOff.created++;
          }
        }
      } catch (err) {
        stats.errors.push(`Booking ${booking.id}: ${String(err)}`);
      }
    }
  } catch (err) {
    stats.errors.push(`Time-off fetch failed: ${String(err)}`);
  }

  return stats;
}
