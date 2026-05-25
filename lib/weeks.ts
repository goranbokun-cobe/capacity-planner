import {
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  endOfISOWeek,
  addWeeks as dateFnsAddWeeks,
  parseISO,
  format,
  isValid,
} from "date-fns";

/** Parse a YYYY-Www string into { year, week }. Throws on invalid input. */
export function parseWeekId(weekId: string): { year: number; week: number } {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!match) throw new Error(`Invalid weekId: "${weekId}"`);
  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);
  if (week < 1 || week > 53) throw new Error(`Invalid week number: ${week}`);
  return { year, week };
}

/** Format { year, week } into a YYYY-Www string (zero-padded week). */
export function formatWeekId(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Return the ISO week ID for today. */
export function getCurrentWeekId(): string {
  const now = new Date();
  return formatWeekId(getISOWeekYear(now), getISOWeek(now));
}

/** Return the Monday Date for a given week ID. */
export function weekIdToMonday(weekId: string): Date {
  const { year, week } = parseWeekId(weekId);
  // Jan 4 is always in week 1 of its ISO year
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = startOfISOWeek(jan4);
  return dateFnsAddWeeks(startOfWeek1, week - 1);
}

/** Return { start: Monday, end: Sunday } for a week ID. */
export function weekIdToRange(weekId: string): { start: Date; end: Date } {
  const monday = weekIdToMonday(weekId);
  return { start: monday, end: endOfISOWeek(monday) };
}

/** Add n weeks to a week ID (n may be negative). */
export function addWeeks(weekId: string, n: number): string {
  const monday = weekIdToMonday(weekId);
  const shifted = dateFnsAddWeeks(monday, n);
  return formatWeekId(getISOWeekYear(shifted), getISOWeek(shifted));
}

/** Return an ordered array of week IDs from startWeekId up to and including endWeekId. */
export function getWeeksInRange(startWeekId: string, endWeekId: string): string[] {
  const weeks: string[] = [];
  let current = startWeekId;
  let guard = 0;
  while (current <= endWeekId && guard < 1000) {
    weeks.push(current);
    current = addWeeks(current, 1);
    guard++;
  }
  return weeks;
}

/** Human-readable label for a week ID, e.g. "W23 · 2–8 Jun". */
export function weekLabel(weekId: string): string {
  const { start, end } = weekIdToRange(weekId);
  const { week } = parseWeekId(weekId);
  const startFmt = format(start, "d MMM");
  const endFmt = format(end, "d MMM");
  return `W${week} · ${startFmt}–${endFmt}`;
}

/** Return the week ID for an arbitrary Date. */
export function dateToWeekId(date: Date): string {
  return formatWeekId(getISOWeekYear(date), getISOWeek(date));
}

/** Return the N upcoming week IDs starting from (and including) the current week. */
export function upcomingWeeks(n: number, fromWeekId?: string): string[] {
  const start = fromWeekId ?? getCurrentWeekId();
  return getWeeksInRange(start, addWeeks(start, n - 1));
}
