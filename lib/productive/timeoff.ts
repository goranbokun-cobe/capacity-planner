import { fetchAllWithIncluded, type JsonApiResource } from "./client";

export interface ProductiveAbsenceBooking {
  id: string;
  personProductiveId: string;
  startedOn: string; // YYYY-MM-DD
  endedOn: string;
}

function relId(resource: JsonApiResource, name: string): string | null {
  const rel = (resource.relationships as Record<string, unknown> | undefined)?.[name] as
    | { data?: { id: string } | null }
    | undefined;
  return rel?.data?.id ?? null;
}

function hasEventData(resource: JsonApiResource): boolean {
  const rel = (resource.relationships as Record<string, unknown> | undefined)?.event as
    | { data?: unknown; meta?: unknown }
    | undefined;
  // With ?include=event, absence bookings have data; project bookings have meta.included=false
  return rel?.data != null;
}

/**
 * Fetch upcoming absence bookings (PTO, sick leave, etc.) from Productive.
 * Only returns bookings for people who exist in our DB (matched via productiveId).
 *
 * @param cutoffDate YYYY-MM-DD — only fetch bookings that end on or after this date.
 *   Use a rolling ~4-week-ago cutoff to avoid pulling years of history.
 *   Long-running absences that started before the cutoff are still captured because
 *   we filter by ended_on, not started_on.
 */
export async function fetchAbsenceBookings(cutoffDate: string): Promise<ProductiveAbsenceBooking[]> {
  const { data } = await fetchAllWithIncluded("/bookings", {
    "filter[draft]": "false",
    "filter[ended_on][gt_eq]": cutoffDate,
    "include": "person,event",
  }, Infinity);

  return data
    .filter(hasEventData)
    .map((b) => ({
      id: b.id,
      personProductiveId: relId(b, "person") ?? "",
      startedOn: (b.attributes.started_on as string) ?? "",
      endedOn: (b.attributes.ended_on as string) ?? "",
    }))
    .filter((b) => b.personProductiveId && b.startedOn && b.endedOn);
}
