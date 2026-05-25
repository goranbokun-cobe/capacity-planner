/**
 * Fetch holiday calendars and their holidays from Productive.
 *
 * Holiday calendar assignment lives on the person's cost rate (salary) record,
 * exposed via the read-only `availabilities` attribute on the people resource.
 * Each availability period is a tuple: [started_on, ended_on, working_hours, holiday_calendar_id].
 * The active (current) period has ended_on = null.
 */

import { fetchAll } from "./client";

export interface ProductiveHolidayCalendar {
  id: string;
  name: string;
  country: string | null;
}

export interface ProductiveHoliday {
  id: string;       // Productive holiday record ID
  calendarId: string;
  date: string;     // YYYY-MM-DD
  name: string;
}

/** Fetch all holiday calendars configured in the organisation. */
export async function fetchHolidayCalendars(): Promise<ProductiveHolidayCalendar[]> {
  const resources = await fetchAll("/holiday_calendars", {});
  return resources.map((r) => ({
    id: r.id,
    name: (r.attributes.name as string) ?? "",
    country: (r.attributes.country as string | null) ?? null,
  }));
}

/**
 * Fetch all holidays for the given calendar IDs between fromDate and toDate (YYYY-MM-DD).
 * Filters holidays after `fromDate` and before `toDate` (Productive's `after`/`before` filters).
 */
export async function fetchHolidaysForCalendars(
  calendarIds: string[],
  fromDate: string,
  toDate: string
): Promise<ProductiveHoliday[]> {
  const all: ProductiveHoliday[] = [];
  for (const calendarId of calendarIds) {
    const resources = await fetchAll("/holidays", {
      "filter[holiday_calendar_id]": calendarId,
      "filter[after]": fromDate,
      "filter[before]": toDate,
    });
    for (const r of resources) {
      const date = (r.attributes.date as string | null) ?? "";
      if (!date) continue;
      all.push({ id: r.id, calendarId, date, name: (r.attributes.name as string) ?? "" });
    }
  }
  return all;
}

/**
 * Extract the active holiday_calendar_id from a person's `availabilities` attribute.
 * Returns null if not set or not parseable.
 *
 * Productive returns availabilities as a JSON-encoded string (not a parsed array), e.g.:
 *   "[[\"2025-11-01\", null, [4,8,8,8,4,0,0,4,8,8,8,4,0,0], 34985]]"
 *
 * Each tuple: [started_on, ended_on, working_hours_array, holiday_calendar_id]
 * The active (current) period has ended_on = null.
 * The calendar ID is an integer.
 */
export function extractCurrentCalendarId(availabilities: unknown): string | null {
  let arr: unknown = availabilities;

  // Productive returns this field as a JSON string — parse it first
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(arr)) return null;

  for (const period of arr) {
    if (!Array.isArray(period) || period.length < 4) continue;
    // index 1 = ended_on (null → active period), index 3 = holiday_calendar_id (integer)
    if (period[1] === null && period[3] != null) {
      return String(period[3]);
    }
  }
  return null;
}
