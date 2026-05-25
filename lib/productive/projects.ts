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
 * Fetch all non-archived Productive projects, across ALL subsidiaries.
 *
 * Strategy:
 *  1. /projects?include=company  — accessible projects (COBE d.o.o. scope)
 *     → correct clientName, since a project's company relationship is the
 *       actual end-client (e.g. BMW Group).
 *  2. /deals?filter[type]=2&include=project,company  — all budgets org-wide.
 *     → discovers projects invisible to /projects (COBE GmbH subsidiary).
 *     → provides dates (deal.date / deal.end_date) for every project.
 *
 * For projects that appear in both sources we use /projects for the name and
 * clientName (accurate), and deals for dates.
 * For cross-subsidiary projects only visible via deals the deal's company is
 * used as a best-effort clientName.
 */
export async function fetchActiveProjects(): Promise<ProductiveProject[]> {
  const [
    { data: projectData, included: projectIncluded },
    { data: budgetData, included: budgetIncluded },
  ] = await Promise.all([
    fetchAllWithIncluded("/projects", { "include": "company" }),
    fetchAllWithIncluded("/deals",    { "filter[type]": "2", "include": "project,company" }),
  ]);

  // ── Step 1: build a map of projects accessible via /projects ─────────────
  // These have the correct end-client name.
  type ProjMeta = { name: string; clientName: string | null };
  const fromProjectsEndpoint = new Map<string, ProjMeta>();

  for (const p of projectData) {
    if (p.attributes.archived_at) continue;
    const companyId = relId(p, "company");
    const company = companyId
      ? projectIncluded.find((r) => r.type === "companies" && r.id === companyId)
      : null;
    fromProjectsEndpoint.set(p.id, {
      name: (p.attributes.name as string) || "Unnamed Project",
      clientName: company ? ((company.attributes.name as string) ?? null) : null,
    });
  }

  // ── Step 2: build lookup maps from deal sideloads ────────────────────────
  const dealProjectMap = new Map<string, JsonApiResource>();
  const dealCompanyMap = new Map<string, JsonApiResource>();
  for (const inc of budgetIncluded) {
    if (inc.type === "projects") dealProjectMap.set(inc.id, inc);
    if (inc.type === "companies") dealCompanyMap.set(inc.id, inc);
  }

  // ── Step 3: collect dates per project + discover cross-subsidiary ones ───
  type Entry = {
    name: string;
    clientName: string | null;
    startDate: string | null;
    endDate: string | null;
  };
  const byProject = new Map<string, Entry>();

  for (const budget of budgetData) {
    const projectId = relId(budget, "project");
    if (!projectId) continue;

    // Must be known from at least one source and not archived
    const dealProject = dealProjectMap.get(projectId);
    if (dealProject?.attributes.archived_at) continue;
    const inProjectsEndpoint = fromProjectsEndpoint.has(projectId);
    if (!inProjectsEndpoint && !dealProject) continue;

    // clientName: prefer /projects (end-client), fall back to deal company
    let name: string;
    let clientName: string | null;

    if (inProjectsEndpoint) {
      ({ name, clientName } = fromProjectsEndpoint.get(projectId)!);
    } else {
      name = (dealProject!.attributes.name as string) || "Unnamed Project";
      const companyId = relId(budget, "company");
      const company = companyId ? dealCompanyMap.get(companyId) : null;
      clientName = company ? ((company.attributes.name as string) ?? null) : null;
    }

    const startDate = (budget.attributes.date as string | null) ?? null;
    const endDate   = (budget.attributes.end_date as string | null) ?? null;

    // Keep the budget with the latest end date when a project has multiple
    const existing = byProject.get(projectId);
    if (!existing || (endDate && (!existing.endDate || endDate > existing.endDate))) {
      byProject.set(projectId, { name, clientName, startDate, endDate });
    }
  }

  // Include projects from /projects that have no budget (no dates, still useful)
  for (const [id, meta] of fromProjectsEndpoint) {
    if (!byProject.has(id)) {
      byProject.set(id, { ...meta, startDate: null, endDate: null });
    }
  }

  return [...byProject.entries()].map(([id, entry]) => ({ id, ...entry }));
}
