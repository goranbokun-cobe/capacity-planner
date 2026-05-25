import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchAll } from "@/lib/productive/client";
import {
  fetchHolidaysForCalendars,
  extractCurrentCalendarId,
} from "@/lib/productive/holidays";

/**
 * POST /api/sync/holidays
 *
 * 1. Fetches all active employees from Productive with their `availabilities` field.
 * 2. Extracts the current holiday_calendar_id from each person's active cost-rate period.
 * 3. Writes that calendar ID back to the matching Person record in the DB.
 * 4. Fetches all holidays for those calendars (current year + next year).
 * 5. Upserts holidays into the Holiday table.
 */
export async function POST() {
  const now = new Date();
  const thisYear = now.getFullYear();
  // Fetch two years so the planner always has forward coverage
  const fromDate = `${thisYear}-01-01`;
  const toDate   = `${thisYear + 1}-12-31`;

  const results = {
    peopleUpdated: 0,
    calendarsFound: 0,
    holidaysUpserted: 0,
    errors: [] as string[],
  };

  try {
    // ── 1. Read people + availabilities from Productive ──────────────────────
    const peopleResources = await fetchAll("/people", {
      "filter[status]": "1",
      "filter[person_type]": "1",
    });

    const calendarIds = new Set<string>();

    for (const person of peopleResources) {
      const calendarId = extractCurrentCalendarId(person.attributes.availabilities);
      if (!calendarId) continue;
      calendarIds.add(calendarId);

      // Update the planner Person record if we have a match
      try {
        const updated = await prisma.person.updateMany({
          where: { productiveId: person.id },
          data: { holidayCalendarId: calendarId },
        });
        results.peopleUpdated += updated.count;
      } catch (err) {
        results.errors.push(`Person ${person.id}: ${String(err)}`);
      }
    }

    // ── 2. Fetch holidays for every calendar we found ─────────────────────────
    const allCalendarIds = [...calendarIds];
    results.calendarsFound = allCalendarIds.length;

    if (allCalendarIds.length > 0) {
      const holidays = await fetchHolidaysForCalendars(allCalendarIds, fromDate, toDate);

      for (const h of holidays) {
        if (!h.date) continue;
        // Parse as local midnight to avoid UTC offset shifting the date
        const [y, m, d] = h.date.split("-").map(Number);
        const date = new Date(y, m - 1, d);

        try {
          await prisma.holiday.upsert({
            where: { productiveId: h.id },
            update: { calendarId: h.calendarId, date, name: h.name },
            create: {
              productiveId: h.id,
              calendarId: h.calendarId,
              date,
              name: h.name,
            },
          });
          results.holidaysUpserted++;
        } catch (err) {
          results.errors.push(`Holiday ${h.id}: ${String(err)}`);
        }
      }
    }
  } catch (err) {
    results.errors.push(`Sync failed: ${String(err)}`);
  }

  return NextResponse.json(results);
}
