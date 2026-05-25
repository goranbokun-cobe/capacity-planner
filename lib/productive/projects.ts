import { fetchAllWithIncluded, type JsonApiResource } from "./client";

export interface ProductiveProject {
  id: string;
  name: string;
  clientName: string | null;
  startDate: string | null; // from the project's budget (deal.date)
  endDate: string | null;   // from the project's budget (deal.end_date)
}

function relId(resource: JsonApiResource, name: string): string | null {
  const rel = (resource.relationships as Record<string, unknown> | undefined)?.[name] as
    | { data?: { id: string } | null }
    | undefined;
  return rel?.data?.id ?? null;
}

/**
 * Fetch non-archived Productive projects.
 * Dates come from the project's budget (deals with type=2),
 * since the project record itself carries no date fields.
 */
export async function fetchActiveProjects(): Promise<ProductiveProject[]> {
  // Fetch all projects — no unsupported filters; filter archived client-side
  const { data: projectData, included: projectIncluded } = await fetchAllWithIncluded(
    "/projects",
    { "include": "company" }
  );

  // Fetch all budgets (type=2) and their project relationship for date lookup
  const { data: budgetData } = await fetchAllWithIncluded("/deals", {
    "filter[type]": "2",
    "include": "project",
  });

  // Build projectId → { startDate, endDate } using the latest budget per project
  const budgetByProject = new Map<string, { startDate: string | null; endDate: string | null }>();
  for (const budget of budgetData) {
    const projectId = relId(budget, "project");
    if (!projectId) continue;

    const startDate = (budget.attributes.date as string | null) ?? null;
    const endDate = (budget.attributes.end_date as string | null) ?? null;

    // Keep the budget with the latest end date (most relevant for capacity planning)
    const existing = budgetByProject.get(projectId);
    if (!existing || (endDate && (!existing.endDate || endDate > existing.endDate))) {
      budgetByProject.set(projectId, { startDate, endDate });
    }
  }

  return projectData
    .filter((p) => !p.attributes.archived_at) // exclude archived projects
    .map((project) => {
      const companyId = relId(project, "company");
      const company = companyId
        ? projectIncluded.find((r) => r.type === "companies" && r.id === companyId)
        : null;

      const dates = budgetByProject.get(project.id);

      return {
        id: project.id,
        name: (project.attributes.name as string) || "Unnamed Project",
        clientName: company ? ((company.attributes.name as string) ?? null) : null,
        startDate: dates?.startDate ?? null,
        endDate: dates?.endDate ?? null,
      };
    });
}
