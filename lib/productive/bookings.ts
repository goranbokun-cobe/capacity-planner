/**
 * Fetch Productive resource bookings for a set of project IDs and return
 * weekly FTE contributions per person.
 *
 * Direct path: filter bookings by project_id (much simpler than the
 * project → budgets → services → bookings chain, which doesn't work
 * because filter[service_id] is unsupported on the bookings endpoint).
 */

import { fetchAllWithIncluded, type JsonApiResource } from "./client";
import { dateToWeekId, weekIdToMonday, getCurrentWeekId, addWeeks } from "@/lib/weeks";

export interface PersonWeekFte {
  weekId: string;
  productivePersonId: string;
  fte: number;
}

export interface BookingsDebug {
  budgetsFound: number;
  servicesFound: number;
  bookingsFound: number;
  rawEntriesFound: number;
}

function relId(r: JsonApiResource, name: string): string | null {
  const rel = (r.relationships as Record<string, unknown>)?.[name] as
    | { data?: { id: string } | null }
    | undefined;
  return rel?.data?.id ?? null;
}

/** Parse a YYYY-MM-DD string as a local midnight Date. */
function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Count Mon–Fri working days in [start, end] inclusive. */
function workingDaysInRange(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/**
 * Given a list of Productive project IDs, returns a map of
 *   productiveProjectId → PersonWeekFte[]
 * containing all resource booking contributions aggregated per person+week.
 *
 * FTE = fraction of a standard 40h week (8h/day × 5 days).
 */
export async function fetchProjectBookings(
  productiveProjectIds: string[],
  debug?: BookingsDebug
): Promise<Map<string, PersonWeekFte[]>> {
  const result = new Map<string, PersonWeekFte[]>();
  if (productiveProjectIds.length === 0) return result;

  // ── Fetch bookings directly per project (filter[project_id] is supported) ──
  // Note: filter[service_id] is NOT supported on /bookings — skip the
  //       project → budgets → services chain entirely.
  //
  // Only fetch bookings that end on or after 4 weeks ago. This avoids pulling
  // thousands of historical bookings (e.g. COBE Internal has 8000+) while
  // still capturing any long-running bookings that started before today.
  const cutoff = weekIdToMonday(addWeeks(getCurrentWeekId(), -4));
  const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  const CHUNK = 10; // stay well under rate limits
  const allBookingData: JsonApiResource[] = [];
  const bookingToProject = new Map<string, string>(); // bookingId → projectId

  for (let i = 0; i < productiveProjectIds.length; i += CHUNK) {
    const chunk = productiveProjectIds.slice(i, i + CHUNK);
    const chunkResults = await Promise.all(
      chunk.map((pid) =>
        fetchAllWithIncluded("/bookings", {
          "filter[project_id]": pid,
          // Include tentative/draft bookings — they represent planned capacity
          // and should be treated as committed for planning purposes.
          "filter[ended_on][gt_eq]": cutoffStr,
          "include": "person",
        }, Infinity).then((r) => {
          for (const b of r.data) bookingToProject.set(b.id, pid);
          return r;
        }).catch(() => ({ data: [] as JsonApiResource[], included: [] as JsonApiResource[] }))
      )
    );
    for (const r of chunkResults) allBookingData.push(...r.data);
  }

  if (debug) {
    debug.budgetsFound = -1; // not used in this path
    debug.servicesFound = -1;
    debug.bookingsFound = allBookingData.length;
  }

  if (allBookingData.length === 0) return result;

  // ── Convert bookings → weekly FTE per person ─────────────────────────────
  for (const booking of allBookingData) {
    const projectId = bookingToProject.get(booking.id);
    if (!projectId) continue;
    const personId = relId(booking, "person");
    if (!personId) continue;

    const startStr = booking.attributes.started_on as string | null;
    const endStr = booking.attributes.ended_on as string | null;
    if (!startStr || !endStr) continue;

    const bookingStart = parseLocalDate(startStr);
    const bookingEnd = parseLocalDate(endStr);
    if (bookingStart > bookingEnd) continue;

    const totalWorkingDays = workingDaysInRange(bookingStart, bookingEnd);
    if (totalWorkingDays === 0) continue;

    // Minutes per working day
    const method = (booking.attributes.booking_method_id as number) ?? 1;
    let minutesPerDay: number;
    if (method === 3) {
      // total_time (minutes) spread evenly across working days
      minutesPerDay =
        ((booking.attributes.total_time as number) ?? 0) / totalWorkingDays;
    } else if (method === 2) {
      // percentage of a standard 8h day
      minutesPerDay =
        (((booking.attributes.percentage as number) ?? 0) / 100) * 480;
    } else {
      // per-day (method === 1): `time` is already minutes/day
      minutesPerDay = (booking.attributes.time as number) ?? 0;
    }
    if (minutesPerDay <= 0) continue;

    // Walk through each ISO week that overlaps the booking
    let weekMonday = weekIdToMonday(dateToWeekId(bookingStart));
    const projectAllocs: PersonWeekFte[] = result.get(projectId) ?? [];
    if (!result.has(projectId)) result.set(projectId, projectAllocs);

    while (weekMonday <= bookingEnd) {
      const weekFriday = new Date(weekMonday);
      weekFriday.setDate(weekFriday.getDate() + 4);

      // Intersect the booking range with this week [Mon, Fri]
      const rangeStart =
        weekMonday < bookingStart ? bookingStart : weekMonday;
      const rangeEnd = weekFriday > bookingEnd ? bookingEnd : weekFriday;

      const daysInWeek = workingDaysInRange(rangeStart, rangeEnd);
      if (daysInWeek > 0) {
        const fte = (daysInWeek * minutesPerDay) / (5 * 480);
        const weekId = dateToWeekId(weekMonday);

        const existing = projectAllocs.find(
          (a) => a.weekId === weekId && a.productivePersonId === personId
        );
        if (existing) {
          existing.fte += fte;
        } else {
          projectAllocs.push({ weekId, productivePersonId: personId, fte });
        }
      }

      weekMonday = new Date(weekMonday);
      weekMonday.setDate(weekMonday.getDate() + 7);
    }
  }

  if (debug) debug.rawEntriesFound = [...result.values()].reduce((s, v) => s + v.length, 0);

  return result;
}
