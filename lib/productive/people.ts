import { fetchAll } from "./client";

export interface ProductivePerson {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  title: string | null;
  status: number; // 1=active, 2=deactivated
  personType: number; // 1=user, 2=contact, 3=placeholder
}

/** Fetch all active users (person_type=1, status=1) from Productive. */
export async function fetchProductivePeople(): Promise<ProductivePerson[]> {
  const resources = await fetchAll("/people", {
    "filter[status]": "1",
    "filter[person_type]": "1",
  });

  return resources.map((r) => ({
    id: r.id,
    firstName: (r.attributes.first_name as string) ?? "",
    lastName: (r.attributes.last_name as string) ?? "",
    fullName: [r.attributes.first_name, r.attributes.last_name]
      .filter(Boolean)
      .join(" "),
    email: (r.attributes.email as string | null) ?? null,
    title: (r.attributes.title as string | null) ?? null,
    status: (r.attributes.status as number) ?? 1,
    personType: (r.attributes.person_type as number) ?? 1,
  }));
}
